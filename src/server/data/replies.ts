import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import type { HouseholdSession } from "@/server/auth/session";
import { maybeAutoSync, syncMyGmail } from "@/server/integrations/google/gmail";
import { GMAIL_SCOPE, hasScope } from "@/server/integrations/google/scopes";
import { EmailThreadSchema, THREAD_COLUMNS, type EmailThread } from "@/components/replies/types";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load this right now.",
} as const;

export function parseThreads(rows: unknown): EmailThread[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r) => {
    const p = EmailThreadSchema.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

export function parseThreadId(fd: FormData): string | null {
  const r = z.uuid().safeParse(fd.get("id"));
  return r.success ? r.data : null;
}

/** Oldest waiting first. */
export async function listThreads(): Promise<Result<EmailThread[]>> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.load };
  const { data, error } = await db
    .from("email_threads")
    .select(THREAD_COLUMNS)
    .order("last_message_at", { ascending: true })
    .limit(500);
  if (error || !data) return { ok: false, error: MSG.load };
  return { ok: true, data: parseThreads(data) };
}

export type AwaitingSummary = { count: number; top: EmailThread[]; everSynced: boolean };

/** For the dashboard card. Null when it cannot be loaded. */
export async function getAwaitingSummary(): Promise<AwaitingSummary | null> {
  const r = await listThreads();
  if (!r.ok) return null;
  const awaiting = r.data.filter((t) => t.status === "awaiting");
  return { count: awaiting.length, top: awaiting.slice(0, 3), everSynced: r.data.length > 0 };
}

/** True when the current user has connected Google with the Gmail scope. */
export async function isGmailConnected(): Promise<boolean> {
  const db = await createUserClient();
  if (!db) return false;
  const { data, error } = await db.rpc("google_connection_status");
  const row = Array.isArray(data) ? data[0] : null;
  return !error && !!row?.connected && hasScope(String(row.scopes ?? ""), GMAIL_SCOPE);
}

/** Manual "Sync from Gmail" for the current user's own mailbox. */
export async function syncNow(s: HouseholdSession): Promise<Result<number>> {
  const r = await syncMyGmail(s.displayName);
  if (r.status === "ok") return { ok: true, data: r.count };
  if (r.status === "not_connected") return { ok: false, error: "Connect Google first (Settings, Google connection)." };
  return { ok: false, error: r.message };
}

/** Viewing the page syncs at most every 10 minutes for connected users. Never throws. */
export async function autoSyncIfDue(s: HouseholdSession): Promise<void> {
  if (!(await isGmailConnected())) return;
  await maybeAutoSync(s.displayName);
}

/** Status only: the one column members may change. */
export async function setThreadStatus(s: HouseholdSession, id: string, status: "awaiting" | "closed"): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await db.from("email_threads").update({ status }).eq("id", id).eq("household_id", s.householdId);
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}
