import { z } from "zod";

export const EmailThreadSchema = z.object({
  id: z.uuid(),
  thread_hash: z.string(),
  member: z.string(),
  subject: z.string(),
  counterpart_domain: z.string(),
  last_message_at: z.string(),
  last_from: z.enum(["me", "them"]),
  labelled: z.boolean(),
  status: z.enum(["awaiting", "replied", "closed"]),
  updated_at: z.string(),
});
export type EmailThread = z.infer<typeof EmailThreadSchema>;

export const THREAD_COLUMNS = "id, thread_hash, member, subject, counterpart_domain, last_message_at, last_from, labelled, status, updated_at";

/** Whole days since the last message (never negative). */
export function daysWaiting(lastMessageAt: string, now: Date): number {
  const t = new Date(lastMessageAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

export function waitingLabel(days: number): string {
  return days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days`;
}
