import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import { scopedDb } from "@/server/db/scoped";
import type { NotificationItem } from "@/components/notifications/types";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const LOAD = "Could not load this right now.";
const FAILED = "Something went wrong. Please try again.";

const RowSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["renewal_due", "task_due", "task_overdue", "bin_tomorrow", "snag_stale", "document_expiring", "system", "chore_nudge"]),
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  created_at: z.string(),
  notification_reads: z.array(z.object({ user_id: z.string() })),
});

/** Asks the database to generate any new notifications for the caller's household. Failure is non-fatal. */
export async function refreshNotifications(): Promise<void> {
  const db = await createUserClient();
  if (!db) return;
  await db.rpc("refresh_my_notifications");
}

/** Lists notifications visible to the caller (RLS) with the caller's own read state. */
export async function listNotifications(userId: string, limit = 100): Promise<Result<NotificationItem[]>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: LOAD };
  const { data, error } = await sc.db
    .from("notifications")
    .select("id, kind, title, body, link, created_at, notification_reads(user_id)")
    .eq("household_id", sc.householdId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return { ok: false, error: LOAD };
  const items = data.flatMap((r) => {
    const p = RowSchema.safeParse(r);
    return p.success
      ? [{
          id: p.data.id, kind: p.data.kind, title: p.data.title, body: p.data.body, link: p.data.link,
          createdAt: p.data.created_at, read: p.data.notification_reads.some((x) => x.user_id === userId),
        } satisfies NotificationItem]
      : [];
  });
  return { ok: true, data: items };
}

const UnreadRowSchema = RowSchema.pick({ id: true, kind: true, notification_reads: true });

/**
 * Unread badge count. Runs in the app shell on every full page load, so it selects only the
 * columns it needs (no titles or bodies) instead of reusing listNotifications. Same rows, same rule.
 */
export async function unreadCount(userId: string): Promise<Result<number>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: LOAD };
  const { data, error } = await sc.db
    .from("notifications")
    .select("id, kind, notification_reads(user_id)")
    .eq("household_id", sc.householdId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error || !data) return { ok: false, error: LOAD };
  let n = 0;
  for (const r of data) {
    const p = UnreadRowSchema.safeParse(r);
    if (p.success && !p.data.notification_reads.some((x) => x.user_id === userId)) n++;
  }
  return { ok: true, data: n };
}

export async function markRead(id: string): Promise<Result> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: FAILED };
  const db = await createUserClient();
  if (!db) return { ok: false, error: FAILED };
  const { error } = await db
    .from("notification_reads")
    .upsert({ notification_id: id }, { onConflict: "notification_id,user_id", ignoreDuplicates: true });
  return error ? { ok: false, error: FAILED } : { ok: true, data: undefined };
}

export async function markAllRead(userId: string): Promise<Result> {
  const all = await listNotifications(userId, 500);
  if (!all.ok) return { ok: false, error: FAILED };
  const rows = all.data.filter((n) => !n.read).map((n) => ({ notification_id: n.id }));
  if (rows.length === 0) return { ok: true, data: undefined };
  const db = await createUserClient();
  if (!db) return { ok: false, error: FAILED };
  const { error } = await db
    .from("notification_reads")
    .upsert(rows, { onConflict: "notification_id,user_id", ignoreDuplicates: true });
  return error ? { ok: false, error: FAILED } : { ok: true, data: undefined };
}
