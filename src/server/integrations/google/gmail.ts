import "server-only";
import { createUserClient } from "@/server/db/supabase";
import { getServerEnv } from "@/server/env";
import { deriveThreadKey, threadHash } from "./crypto";
import { GMAIL_SCOPE } from "./scopes";
import { getGoogleAccess, invalidateAccessToken } from "./token";

/**
 * Gmail "awaiting replies" metadata through the signed-in user's own read-only token (D17).
 * Only these fields ever leave this module: hashed thread id, subject (<= 150), counterpart DOMAIN,
 * last message time, who sent last, label flag. Bodies, addresses and names are never kept.
 */

export const MAX_THREADS = 50;
export const LABEL_QUERY = 'label:"Our Home/Awaiting" newer_than:60d';
export const SENT_QUERY = "in:sent newer_than:60d -in:chats";
export const SYNC_INTERVAL_MS = 10 * 60_000;
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TIMEOUT_MS = 8_000;
const CONCURRENCY = 6;

/** People, not companies. */
export const PERSONAL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "icloud.com", "outlook.com", "hotmail.com",
]);
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export interface ThreadRecord {
  thread_hash: string;
  subject: string;
  counterpart_domain: string;
  last_message_at: string;
  last_from: "me" | "them";
  label_flag: boolean;
}

export interface GmailMessage {
  id?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { headers?: { name?: string; value?: string }[] };
}
export interface GmailThread { id?: string; messages?: GmailMessage[] }

// ---- pure helpers ----------------------------------------------------------------------

export function header(m: GmailMessage, name: string): string {
  const h = m.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return typeof h?.value === "string" ? h.value : "";
}

/** Decodes RFC 2047 encoded words (=?UTF-8?B?...?= and =?UTF-8?Q?...?=). */
export function decodeMimeWords(s: string): string {
  return s
    .replace(/(\?=)\s+(=\?)/g, "$1$2")
    .replace(/=\?([\w-]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, cs: string, enc: string, text: string) => {
      try {
        const bytes =
          enc.toUpperCase() === "B"
            ? Buffer.from(text, "base64")
            : Buffer.from(
                text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))),
                "latin1",
              );
        return new TextDecoder(/^utf-?8$/i.test(cs) ? "utf-8" : "iso-8859-1").decode(bytes);
      } catch {
        return "";
      }
    });
}

/** Subject: decoded, single-line, no control characters, at most 150 characters. */
export function cleanSubject(raw: string): string {
  const s = decodeMimeWords(raw).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(s).slice(0, 150).join("");
}

/** Lowercase domains of the addresses in a From/To header. Display names are discarded. */
export function addressParts(field: string): { address: string; domain: string }[] {
  const noQuoted = field.replace(/"(?:[^"\\]|\\.)*"/g, " ");
  const angle = [...noQuoted.matchAll(/<([^<>\s]+@[^<>\s]+)>/g)].map((m) => m[1]!);
  const found = angle.length > 0 ? angle : [...noQuoted.matchAll(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]);
  const out: { address: string; domain: string }[] = [];
  for (const a of found) {
    const at = a.lastIndexOf("@");
    const domain = a.slice(at + 1).toLowerCase().replace(/^\.+|\.+$/g, "");
    if (DOMAIN_RE.test(domain) && domain.length <= 120) out.push({ address: a.toLowerCase(), domain });
  }
  return out;
}

export interface RecordContext { myEmail: string; threadKey: Buffer; labelled: boolean }

/** The metadata record for one thread, or null when it should be skipped. */
export function buildRecord(thread: GmailThread, ctx: RecordContext): ThreadRecord | null {
  const msgs = (thread.messages ?? []).filter((m) => /^\d+$/.test(m.internalDate ?? ""));
  if (!thread.id || msgs.length === 0) return null;
  const byDate = [...msgs].sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
  const first = byDate[0]!;
  const last = byDate[byDate.length - 1]!;
  const myDomain = ctx.myEmail.split("@")[1] ?? "";

  const from = addressParts(header(last, "From"));
  const fromMe = (last.labelIds ?? []).includes("SENT") || from.some((a) => a.address === ctx.myEmail);
  const candidates = fromMe ? addressParts(header(last, "To")) : from.slice(0, 1);
  const counterpart = candidates
    .map((a) => a.domain)
    .find((d) => !PERSONAL_DOMAINS.has(d) && (ctx.labelled || d !== myDomain));
  if (!counterpart) return null;

  const at = new Date(Number(last.internalDate));
  if (Number.isNaN(at.getTime())) return null;
  return {
    thread_hash: threadHash(thread.id, ctx.threadKey),
    subject: cleanSubject(header(first, "Subject")),
    counterpart_domain: counterpart,
    last_message_at: at.toISOString(),
    last_from: fromMe ? "me" : "them",
    label_flag: ctx.labelled,
  };
}

// ---- Gmail API -------------------------------------------------------------------------

export class GmailError extends Error {
  constructor(readonly code: "auth" | "http" | "timeout") {
    super(code === "auth" ? "Google no longer accepts the connection." : code === "timeout" ? "Gmail did not respond in time." : "Gmail request failed.");
    this.name = "GmailError";
  }
}

export interface GmailDeps { fetch?: typeof fetch; token: string; userId?: string }

async function get<T>(d: GmailDeps, url: string): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await (d.fetch ?? fetch)(url, { headers: { authorization: `Bearer ${d.token}` }, signal: ctl.signal, cache: "no-store" });
    if (res.status === 401) {
      if (d.userId) invalidateAccessToken(d.userId);
      throw new GmailError("auth");
    }
    if (!res.ok) throw new GmailError("http");
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof GmailError) throw e;
    throw new GmailError(e instanceof Error && e.name === "AbortError" ? "timeout" : "http");
  } finally {
    clearTimeout(t);
  }
}

async function listIds(d: GmailDeps, q: string): Promise<string[]> {
  const j = await get<{ threads?: { id?: string }[] }>(d, `${API}/threads?maxResults=${MAX_THREADS}&q=${encodeURIComponent(q)}`);
  return (j.threads ?? []).flatMap((t) => (typeof t.id === "string" && /^[0-9a-f]+$/i.test(t.id) ? [t.id] : []));
}

async function inBatches<T, R>(items: T[], fn: (x: T) => Promise<R | null>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const part = await Promise.all(items.slice(i, i + CONCURRENCY).map((x) => fn(x).catch((e) => (e instanceof GmailError && e.code === "auth" ? Promise.reject(e) : null))));
    for (const r of part) if (r) out.push(r);
  }
  return out;
}

/** Up to 50 labelled-or-sent threads from the last 60 days as safe metadata records. */
export async function collectThreadRecords(d: GmailDeps, threadKey: Buffer): Promise<ThreadRecord[]> {
  const profile = await get<{ emailAddress?: string }>(d, `${API}/profile`);
  const myEmail = (profile.emailAddress ?? "").toLowerCase();
  if (!myEmail.includes("@")) throw new GmailError("http");

  const labelled = await listIds(d, LABEL_QUERY);
  const sent = await listIds(d, SENT_QUERY);
  const flag = new Map<string, boolean>();
  for (const id of labelled) flag.set(id, true);
  for (const id of sent) if (!flag.has(id)) flag.set(id, false);
  const ids = [...flag.keys()].slice(0, MAX_THREADS); // labelled first

  const metaQs = ["Subject", "From", "To", "Date"].map((h) => `metadataHeaders=${h}`).join("&");
  const records = await inBatches(ids, async (id) => {
    const t = await get<GmailThread>(d, `${API}/threads/${id}?format=metadata&${metaQs}`);
    return buildRecord({ ...t, id }, { myEmail, threadKey, labelled: flag.get(id) ?? false });
  });
  const unique = new Map(records.map((r) => [r.thread_hash, r]));
  return [...unique.values()];
}

// ---- sync ------------------------------------------------------------------------------

export type SyncResult =
  | { status: "ok"; count: number }
  | { status: "not_connected" }
  | { status: "error"; message: string };

export interface SyncDeps {
  fetch?: typeof fetch;
  now?: () => number;
  rpc?: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  access?: { accessToken: string; userId: string } | null;
  keyB64?: string;
}

async function defaultRpc(fn: string, args?: Record<string, unknown>) {
  const db = await createUserClient();
  if (!db) return { data: null, error: new Error("unavailable") };
  return db.rpc(fn, args);
}

/** Syncs the current user's own Gmail metadata into their household (RPC enforces membership + name). */
export async function syncMyGmail(displayName: string, deps: SyncDeps = {}): Promise<SyncResult> {
  const keyB64 = deps.keyB64 ?? getServerEnv().GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!keyB64) return { status: "not_connected" };
  const access = deps.access === undefined ? await getGoogleAccess(GMAIL_SCOPE) : deps.access;
  if (!access) return { status: "not_connected" };
  try {
    const records = await collectThreadRecords(
      { fetch: deps.fetch, token: access.accessToken, userId: access.userId },
      deriveThreadKey(keyB64),
    );
    const r = await (deps.rpc ?? defaultRpc)("sync_my_email_threads", { p_member: displayName, p_threads: records });
    if (r.error) return { status: "error", message: "Could not save the synced threads." };
    return { status: "ok", count: records.length };
  } catch (e) {
    return { status: "error", message: e instanceof GmailError ? e.message : "Could not sync from Gmail." };
  }
}

/** Syncs on view at most every 10 minutes. Never throws; failures just leave the old data. */
export async function maybeAutoSync(displayName: string, deps: SyncDeps = {}): Promise<SyncResult | null> {
  try {
    const rpc = deps.rpc ?? defaultRpc;
    const last = await rpc("my_gmail_sync_at");
    const t = typeof last.data === "string" ? Date.parse(last.data) : NaN;
    const now = (deps.now ?? Date.now)();
    if (!last.error && !Number.isNaN(t) && now - t < SYNC_INTERVAL_MS) return null;
    return await syncMyGmail(displayName, deps);
  } catch {
    return null;
  }
}
