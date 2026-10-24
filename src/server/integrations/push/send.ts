import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/server/env";
import { payloadSchema, type PushPayload } from "./validate";

export type PushConfig = { publicKey: string; privateKey: string; subject: string };

/** VAPID settings, or null when push is not configured (all sending is then a no-op). */
export function pushConfig(): PushConfig | null {
  const e = getServerEnv();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY || !e.VAPID_SUBJECT) return null;
  return { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT };
}

export type SendResult = { sent: number; removed: number; failed: number };

type Row = { id: string; endpoint: string; p256dh: string; auth: string };

async function deliver(db: SupabaseClient, rows: Row[], payload: PushPayload, cfg: PushConfig, record = true): Promise<SendResult> {
  const body = JSON.stringify(payload);
  const out = { sent: 0, removed: 0, failed: 0 };
  for (const r of rows) {
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, body, {
        vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
        TTL: 3600,
      });
      out.sent++;
      if (record) await db.rpc("push_record_result", { p_id: r.id, p_ok: true });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        if (record) {
          await db.from("push_subscriptions").delete().eq("id", r.id);
          out.removed++;
        } else out.failed++;
      } else {
        out.failed++;
        if (record) await db.rpc("push_record_result", { p_id: r.id, p_ok: false });
        // Status only: never log endpoints or keys.
        console.warn("push delivery failed", status ?? "unknown");
      }
    }
  }
  return out;
}

/**
 * Sends to explicit subscription rows (e.g. another member's, fetched through a guarded RPC).
 * Results are not recorded: the caller's RLS client cannot update or delete another person's rows.
 */
export async function sendToSubscriptions(db: SupabaseClient, rows: Row[], payload: PushPayload): Promise<SendResult> {
  const cfg = pushConfig();
  if (!cfg) return { sent: 0, removed: 0, failed: 0 };
  return deliver(db, rows, payloadSchema.parse(payload), cfg, false);
}

/**
 * Sends to a user's subscriptions. `db` is the caller's RLS client, so it can only see the
 * caller's own subscriptions; reaching other users needs a trusted server-side sender (future).
 */
export async function sendToUser(db: SupabaseClient, userId: string, payload: PushPayload): Promise<SendResult> {
  const cfg = pushConfig();
  if (!cfg) return { sent: 0, removed: 0, failed: 0 };
  const p = payloadSchema.parse(payload);
  const { data } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  return deliver(db, (data ?? []) as Row[], p, cfg);
}

/** Sends to every subscription visible to `db` in the household (own devices under RLS today). */
export async function sendToHousehold(db: SupabaseClient, householdId: string, payload: PushPayload): Promise<SendResult> {
  const cfg = pushConfig();
  if (!cfg) return { sent: 0, removed: 0, failed: 0 };
  const p = payloadSchema.parse(payload);
  const { data } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("household_id", householdId);
  return deliver(db, (data ?? []) as Row[], p, cfg);
}
