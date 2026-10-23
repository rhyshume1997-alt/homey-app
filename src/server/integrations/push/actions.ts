"use server";

import { requireSession } from "@/server/auth/session";
import { createUserClient } from "@/server/db/supabase";
import { pushConfig, sendToUser } from "./send";
import { endpointSchema, subscriptionSchema } from "./validate";

export type PushActionResult = { ok: boolean; message: string };
const FAIL: PushActionResult = { ok: false, message: "Could not do that right now." };

export async function subscribePushAction(input: unknown): Promise<PushActionResult> {
  const session = await requireSession();
  if (!pushConfig()) return { ok: false, message: "Notifications are not set up yet." };
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That subscription was not valid." };
  const supabase = await createUserClient();
  if (!supabase) return FAIL;
  const s = parsed.data;
  // Users cannot update rows, so re-subscribing replaces this user's row for the endpoint.
  await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint).eq("user_id", session.userId);
  const { error } = await supabase.from("push_subscriptions").insert({
    household_id: session.householdId,
    user_id: session.userId,
    endpoint: s.endpoint,
    p256dh: s.p256dh,
    auth: s.auth,
    user_agent: s.userAgent ?? null,
  });
  if (error) return FAIL;
  return { ok: true, message: "Notifications enabled on this device." };
}

export async function unsubscribePushAction(endpoint: unknown): Promise<PushActionResult> {
  const session = await requireSession();
  const parsed = endpointSchema.safeParse(endpoint);
  if (!parsed.success) return { ok: false, message: "That subscription was not valid." };
  const supabase = await createUserClient();
  if (!supabase) return FAIL;
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", parsed.data).eq("user_id", session.userId);
  if (error) return FAIL;
  return { ok: true, message: "Notifications turned off on this device." };
}

/** Sends a test notification to the caller's own devices only. */
export async function sendTestPushAction(): Promise<PushActionResult> {
  const session = await requireSession();
  if (!pushConfig()) return { ok: false, message: "Notifications are not set up yet." };
  const supabase = await createUserClient();
  if (!supabase) return FAIL;
  const r = await sendToUser(supabase, session.userId, { title: "Our Home", body: "Test notification. It works.", link: "/" });
  if (r.sent === 0) return { ok: false, message: "No device received it. Enable notifications on this device first." };
  return { ok: true, message: `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}.` };
}
