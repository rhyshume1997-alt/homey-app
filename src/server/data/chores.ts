import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import type { HouseholdSession } from "@/server/auth/session";
import { pushConfig, sendToSubscriptions } from "@/server/integrations/push/send";
import type { Result } from "./tasks";

export const NUDGE_MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  notAssigned: "This chore is not assigned to anyone.",
  self: "That chore is yours.",
  inactive: "That person is no longer in this household.",
  closed: "That chore is already done.",
  notFound: "Could not find that chore.",
  rate: "You nudged about this recently. Try again in a little while.",
} as const;

/** Maps the database's refusal reasons (nudge_task) to fixed user-facing text. */
export function nudgeError(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("rate limit")) return NUDGE_MSG.rate;
  if (m.includes("not assigned")) return NUDGE_MSG.notAssigned;
  if (m.includes("yourself")) return NUDGE_MSG.self;
  if (m.includes("not an active member")) return NUDGE_MSG.inactive;
  if (m.includes("closed")) return NUDGE_MSG.closed;
  if (m.includes("not found")) return NUDGE_MSG.notFound;
  return NUDGE_MSG.failed;
}

const NudgeRowSchema = z.object({ nudge_id: z.uuid(), recipient_user_id: z.uuid(), title: z.string() });
const TargetSchema = z.object({ id: z.string(), endpoint: z.string(), p256dh: z.string(), auth: z.string() });

/**
 * Nudges the person a chore is assigned to. The database enforces every rule (task in the caller's
 * household, open, assigned to a different ACTIVE member, 1 nudge per task per 30 min, 20 per user per
 * day) and writes the in-app notification. Web push is best effort and never fails the nudge.
 */
export async function nudgeAssignee(s: HouseholdSession, taskId: string): Promise<Result<{ pushed: number }>> {
  if (!z.uuid().safeParse(taskId).success) return { ok: false, error: NUDGE_MSG.invalid };
  const db = await createUserClient();
  if (!db) return { ok: false, error: NUDGE_MSG.failed };
  const { data, error } = await db.rpc("nudge_task", { p_task: taskId });
  if (error) return { ok: false, error: nudgeError(error.message) };
  const row = z.array(NudgeRowSchema).safeParse(data);
  if (!row.success || row.data.length !== 1) return { ok: false, error: NUDGE_MSG.failed };
  const n = row.data[0];

  let pushed = 0;
  try {
    if (pushConfig()) {
      const t = await db.rpc("nudge_push_targets", { p_nudge: n.nudge_id });
      const targets = z.array(TargetSchema).safeParse(t.data ?? []);
      if (targets.success && targets.data.length > 0) {
        const title = `${s.displayName} nudged you`.slice(0, 100);
        const r = await sendToSubscriptions(db, targets.data, { title, body: n.title.slice(0, 300), link: "/tasks" });
        pushed = r.sent;
      }
    }
  } catch {
    // Push is best effort: the in-app notification already exists.
  }
  return { ok: true, data: { pushed } };
}
