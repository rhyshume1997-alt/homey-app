import "server-only";
import { createHash } from "node:crypto";
import type {
  ApplianceDraft, ApplianceSaver, CandidateCounts, ConfirmedAppliance, ConfirmedReading, DraftList, ElectricityReading,
  EmailSource, ImportActionState, ImportKind, ReadingDraft, ReadingSaver, SaverSession,
} from "@/contracts/email-import";
import { IMPORT_LIMITS } from "@/contracts/email-import";
import { GmailError, cleanSubject, header } from "@/server/integrations/google/gmail";
import { GMAIL_SCOPE, hasScope } from "@/server/integrations/google/scopes";
import { getGoogleAccess, invalidateAccessToken, type GoogleAccess } from "@/server/integrations/google/token";
import { parseBoschEmail } from "./bosch";
import { parseEonEmail } from "./eon";
import { searchQuery, verifySender } from "./senders";
import { bodyTexts, safeText, type GmailPart } from "./text";
import { MESSAGE_ID_RE, parseApplianceForm, parseReadingForm } from "./validate";

/**
 * Email import (D18) through the CALLER's own read-only Gmail token (D17).
 *
 * - Only allowlisted, Gmail-authenticated senders are read (see senders.ts).
 * - Bodies are decoded in memory, parsed by deterministic regex parsers, and dropped. They are
 *   never stored, logged, put in an error message, returned to the browser or sent to an AI.
 * - Drafts carry only extracted, validated fields. Nothing is saved until a person presses Save;
 *   the server then re-fetches and re-parses the email by id and passes the confirmed record to
 *   an injected saver. The only identifier a saver should keep is sha256(message id).
 */

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TIMEOUT_MS = 8_000;
export const MAX_MESSAGES = 20;
const CONCURRENCY = 4;

export const IMPORT_MSG = {
  notConnected: "Connect Google in More to import from email",
  gmail: "Could not read Gmail just now. Try again later.",
  invalid: "Check the highlighted values and try again.",
  gone: "That email can no longer be read as a draft. Refresh the page.",
  needThing: "Add a model or product name before saving.",
  warrantyOrder: "Warranty end must be after the purchase date.",
  future: "Dates cannot be in the future.",
  needDate: "Add the reading date before saving.",
  needReading: "Add at least one reading before saving.",
  needUnit: "Choose the gas unit before saving.",
  saveFailed: "Could not save. Try again.",
} as const;

export interface ImportDeps {
  fetch?: typeof fetch;
  now?: () => number;
  /** Injected in tests. Defaults to the current user's own Google access (gmail.readonly). */
  access?: GoogleAccess | null;
}

/** sha256 of the Gmail message id: the only identifier of an email that may be stored. */
export function messageHash(id: string): string {
  return createHash("sha256").update(id, "utf8").digest("hex");
}

/** The caller's own token, only when it is theirs and carries gmail.readonly. */
async function ownAccess(session: SaverSession, deps: ImportDeps): Promise<GoogleAccess | null> {
  const a = deps.access === undefined ? await getGoogleAccess(GMAIL_SCOPE) : deps.access;
  if (!a || a.userId !== session.userId || !hasScope(a.scopes, GMAIL_SCOPE)) return null;
  return a;
}

async function gmailGet<T>(a: GoogleAccess, deps: ImportDeps, url: string): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await (deps.fetch ?? fetch)(url, {
      headers: { authorization: `Bearer ${a.accessToken}` },
      signal: ctl.signal,
      cache: "no-store",
    });
    if (res.status === 401) {
      invalidateAccessToken(a.userId);
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

interface FullMessage {
  id?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: { name?: string; value?: string }[] };
}

async function listIds(a: GoogleAccess, deps: ImportDeps, kind: ImportKind): Promise<string[]> {
  const j = await gmailGet<{ messages?: { id?: unknown }[] }>(
    a, deps, `${API}/messages?maxResults=${MAX_MESSAGES}&q=${encodeURIComponent(searchQuery(kind))}`,
  );
  const ids = (j.messages ?? []).flatMap((m) => (typeof m.id === "string" && MESSAGE_ID_RE.test(m.id) ? [m.id] : []));
  return [...new Set(ids)].slice(0, MAX_MESSAGES);
}

interface Verified { id: string; source: EmailSource; texts: string[]; subject: string }

/** Fetches one message and returns it only when the sender passes the allowlist and auth check. */
async function fetchVerified(a: GoogleAccess, deps: ImportDeps, kind: ImportKind, id: string): Promise<Verified | null> {
  if (!MESSAGE_ID_RE.test(id)) return null;
  const m = await gmailGet<FullMessage>(a, deps, `${API}/messages/${id}?format=full`);
  const headers = m.payload?.headers;
  const check = verifySender(headers, kind);
  if (!check.ok) return null;
  if (!/^\d{1,15}$/.test(m.internalDate ?? "")) return null;
  const at = new Date(Number(m.internalDate));
  if (Number.isNaN(at.getTime())) return null;
  const subject = safeText(cleanSubject(header({ payload: { headers } }, "Subject")), IMPORT_LIMITS.subject) ?? "";
  const { plain, html } = bodyTexts(m.payload);
  const texts = [plain, html].filter((t): t is string => typeof t === "string" && t.length > 0);
  return {
    id,
    subject,
    texts,
    source: { sender: check.sender, domain: check.domain, receivedAt: at.toISOString(), subject, messageHash: messageHash(id) },
  };
}

function toApplianceDraft(v: Verified): ApplianceDraft | null {
  // Plain text first; the HTML part only when the plain part gives nothing.
  for (const text of v.texts) {
    const p = parseBoschEmail({ subject: v.subject, text, receivedAt: v.source.receivedAt });
    if (p) return { messageId: v.id, source: v.source, kind: p.kind, fields: p.fields, found: p.found, modelOptions: p.modelOptions };
  }
  return null;
}

function toReadingDraft(v: Verified): ReadingDraft | null {
  for (const text of v.texts) {
    const p = parseEonEmail({ subject: v.subject, text, receivedAt: v.source.receivedAt });
    if (p) return { messageId: v.id, source: v.source, kind: p.kind, fields: p.fields, found: p.found };
  }
  return null;
}

async function inBatches<T, R>(items: T[], fn: (x: T) => Promise<R | null>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const part = await Promise.all(
      items.slice(i, i + CONCURRENCY).map((x) => fn(x).catch((e) => (e instanceof GmailError && e.code === "auth" ? Promise.reject(e) : null))),
    );
    for (const r of part) if (r) out.push(r);
  }
  return out;
}

async function collect<D extends { source: EmailSource }>(
  session: SaverSession,
  kind: ImportKind,
  toDraft: (v: Verified) => D | null,
  saver: { importedHashes?(s: SaverSession, h: string[]): Promise<ReadonlySet<string>> } | undefined,
  deps: ImportDeps,
): Promise<DraftList<D>> {
  const a = await ownAccess(session, deps);
  if (!a) return { status: "not_connected" };
  try {
    const ids = await listIds(a, deps, kind);
    const drafts = await inBatches(ids, async (id) => {
      const v = await fetchVerified(a, deps, kind, id);
      return v ? toDraft(v) : null;
    });
    let done: ReadonlySet<string> = new Set();
    if (saver?.importedHashes && drafts.length > 0) {
      done = await saver.importedHashes(session, drafts.map((d) => d.source.messageHash)).catch(() => new Set<string>());
    }
    const fresh = drafts.filter((d) => !done.has(d.source.messageHash));
    fresh.sort((x, y) => y.source.receivedAt.localeCompare(x.source.receivedAt));
    return { status: "ok", drafts: fresh };
  } catch (e) {
    if (e instanceof GmailError && e.code === "auth") return { status: "not_connected" };
    return { status: "error", message: IMPORT_MSG.gmail };
  }
}

export function listApplianceDrafts(session: SaverSession, deps: ImportDeps & { saver?: ApplianceSaver } = {}) {
  return collect(session, "appliances", toApplianceDraft, deps.saver, deps);
}

export function listReadingDrafts(session: SaverSession, deps: ImportDeps & { saver?: ReadingSaver } = {}) {
  return collect(session, "readings", toReadingDraft, deps.saver, deps);
}

/** Counts for Homey ("I found 2 appliance emails"). Already-imported emails are not counted. */
export async function findImportCandidates(
  session: SaverSession,
  deps: ImportDeps & { savers?: { appliance?: ApplianceSaver; reading?: ReadingSaver } } = {},
): Promise<CandidateCounts> {
  const a = await ownAccess(session, deps);
  if (!a) return { status: "not_connected" };
  const d = { ...deps, access: a };
  const [ap, rd] = await Promise.all([
    listApplianceDrafts(session, { ...d, saver: deps.savers?.appliance }),
    listReadingDrafts(session, { ...d, saver: deps.savers?.reading }),
  ]);
  if (ap.status === "not_connected" || rd.status === "not_connected") return { status: "not_connected" };
  if (ap.status !== "ok" || rd.status !== "ok") return { status: "error" };
  return { status: "ok", appliances: ap.drafts.length, readings: rd.drafts.length };
}

/** Homey's line for the counts, or null when there is nothing to say. */
export function describeCandidates(c: CandidateCounts): string | null {
  if (c.status !== "ok" || (c.appliances === 0 && c.readings === 0)) return null;
  const part = (n: number, one: string) => (n === 0 ? null : `${n} ${one} email${n === 1 ? "" : "s"}`);
  const bits = [part(c.appliances, "appliance"), part(c.readings, "meter reading")].filter(Boolean);
  return `I found ${bits.join(" and ")}.`;
}

// ---- save -------------------------------------------------------------------------------

const todayPlusOne = (now: number) => new Date(now + 86_400_000).toISOString().slice(0, 10);

async function reload<D>(
  session: SaverSession, kind: ImportKind, id: string, toDraft: (v: Verified) => D | null, deps: ImportDeps,
): Promise<{ draft: D } | { error: string }> {
  const a = await ownAccess(session, deps);
  if (!a) return { error: IMPORT_MSG.notConnected };
  try {
    const v = await fetchVerified(a, deps, kind, id);
    const draft = v ? toDraft(v) : null;
    return draft ? { draft } : { error: IMPORT_MSG.gone };
  } catch (e) {
    return { error: e instanceof GmailError && e.code === "auth" ? IMPORT_MSG.notConnected : IMPORT_MSG.gmail };
  }
}

/**
 * Save one appliance draft after a person pressed Save. The email is re-fetched and re-parsed by
 * id with the caller's own token; only the editable fields are taken from the form, re-validated.
 */
export async function saveApplianceFromEmail(
  session: SaverSession, fd: FormData, deps: ImportDeps & { saver: ApplianceSaver },
): Promise<ImportActionState> {
  const edit = parseApplianceForm(fd);
  if (!edit) return { error: IMPORT_MSG.invalid };
  const r = await reload(session, "appliances", edit.messageId, toApplianceDraft, deps);
  if ("error" in r) return { error: r.error };
  const { fields, source } = r.draft;

  if (!edit.model && !edit.productName) return { error: IMPORT_MSG.needThing };
  const limit = todayPlusOne((deps.now ?? Date.now)());
  if (edit.purchaseDate && edit.purchaseDate > limit) return { error: IMPORT_MSG.future };
  if (edit.purchaseDate && edit.warrantyEnd && edit.warrantyEnd <= edit.purchaseDate) return { error: IMPORT_MSG.warrantyOrder };

  const edited =
    edit.model !== fields.model || edit.productName !== fields.productName ||
    edit.purchaseDate !== fields.purchaseDate || edit.warrantyEnd !== fields.warrantyEnd;
  const warrantyEndSource: ConfirmedAppliance["warrantyEndSource"] =
    edit.warrantyEnd === null ? null
      : edit.warrantyEnd !== fields.warrantyEnd || edit.purchaseDate !== fields.purchaseDate ? "edited"
        : fields.warrantyComputed ? "computed" : "email";

  const record: ConfirmedAppliance = {
    make: "Bosch",
    model: edit.model,
    productName: edit.productName,
    purchaseDate: edit.purchaseDate,
    warrantyEnd: edit.warrantyEnd,
    warrantyEndSource,
    room: edit.room,
    source: { ...source, edited },
  };
  try {
    const s = await deps.saver.save({ userId: session.userId, householdId: session.householdId }, record);
    return s.ok ? { ok: true, saved: source.messageHash } : { error: s.error || IMPORT_MSG.saveFailed };
  } catch {
    return { error: IMPORT_MSG.saveFailed };
  }
}

/** Save one reading draft. Same rules; a reading needs a date and at least one value. */
export async function saveReadingFromEmail(
  session: SaverSession, fd: FormData, deps: ImportDeps & { saver: ReadingSaver },
): Promise<ImportActionState> {
  const edit = parseReadingForm(fd);
  if (!edit) return { error: IMPORT_MSG.invalid };
  const r = await reload(session, "readings", edit.messageId, toReadingDraft, deps);
  if ("error" in r) return { error: r.error };
  const { fields, source } = r.draft;

  if (!edit.readingDate) return { error: IMPORT_MSG.needDate };
  if (edit.readingDate > todayPlusOne((deps.now ?? Date.now)())) return { error: IMPORT_MSG.future };

  const electricity: ElectricityReading[] = [];
  if (edit.elecSingle !== null) electricity.push({ register: "single", kwh: edit.elecSingle });
  if (edit.elecDay !== null) electricity.push({ register: "day", kwh: edit.elecDay });
  if (edit.elecNight !== null) electricity.push({ register: "night", kwh: edit.elecNight });
  if (electricity.length === 0 && edit.gas === null) return { error: IMPORT_MSG.needReading };
  if (edit.gas !== null && !edit.gasUnit) return { error: IMPORT_MSG.needUnit };

  const orig = (reg: string) => fields.electricity.find((e) => e.register === reg)?.kwh ?? null;
  const edited =
    edit.readingDate !== fields.readingDate ||
    edit.elecSingle !== orig("single") || edit.elecDay !== orig("day") || edit.elecNight !== orig("night") ||
    edit.gas !== (fields.gas?.value ?? null) ||
    (edit.gas !== null && edit.gasUnit !== fields.gas?.unit);

  const record: ConfirmedReading = {
    readingDate: edit.readingDate,
    electricity,
    gas: edit.gas !== null && edit.gasUnit ? { value: edit.gas, unit: edit.gasUnit } : null,
    meterType: fields.meterType,
    source: { ...source, edited },
  };
  try {
    const s = await deps.saver.save({ userId: session.userId, householdId: session.householdId }, record);
    return s.ok ? { ok: true, saved: source.messageHash } : { error: s.error || IMPORT_MSG.saveFailed };
  } catch {
    return { error: IMPORT_MSG.saveFailed };
  }
}
