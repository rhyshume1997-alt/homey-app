import "server-only";
import type { NeedItem } from "@/components/homey/types";
import type { HouseholdSession } from "@/server/auth/session";
import { createUserClient } from "@/server/db/supabase";

export const MAX_KUDOS_ITEMS = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;

export type AuditLite = { id: number; action: string; summary: string | null; created_at: string };

const ACTIONS = ["task.completed", "shopping.bought", "snag.fixed", "maintenance.done"] as const;
type ThankAction = (typeof ACTIONS)[number];
const isThankAction = (a: string): a is ThankAction => (ACTIONS as readonly string[]).includes(a);

export type Thankable = { auditId: number; name: string; thing: string; action: ThankAction; text: string; createdAt: string };

function clean(s: string | null): string {
  // eslint-disable-next-line no-control-regex
  return (s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Pure: one audit row to a thankable thing, or null when it is not one we suggest thanks for. */
export function toThankable(row: AuditLite, name: string): Thankable | null {
  if (!isThankAction(row.action)) return null;
  const thing = clean(row.summary);
  if (!thing) return null; // only what is in the log
  const text =
    row.action === "shopping.bought"
      ? `${name} bought ${thing}. Say thanks?`
      : row.action === "snag.fixed"
        ? `${name} fixed ${thing}. Want to say thanks?`
        : row.action === "maintenance.done"
          ? `${name} did the maintenance: ${thing}. Want to say thanks?`
          : `${name} did ${thing}. Want to say thanks?`;
  return { auditId: row.id, name, thing, action: row.action, text, createdAt: row.created_at };
}

/** Pure: newest first, last 24h, skip thanked, max 3. */
export function mapActivity(
  rows: AuditLite[],
  name: string,
  thanked: ReadonlySet<number>,
  now: Date,
): { item: NeedItem; thankable: Thankable }[] {
  const cutoff = now.getTime() - WINDOW_MS;
  return rows
    .filter((r) => new Date(r.created_at).getTime() >= cutoff && !thanked.has(r.id))
    .sort((a, b) => b.id - a.id)
    .flatMap((r) => {
      const t = toThankable(r, name);
      if (!t) return [];
      const item: NeedItem = {
        key: `kudos:${r.id}`,
        bucket: "activity",
        kind: "activity",
        light: "green",
        text: t.text,
        date: r.created_at,
        href: "/activity",
        action: { type: "draft_thanks", label: "Say thanks" },
      };
      return [{ item, thankable: t }];
    })
    .slice(0, MAX_KUDOS_ITEMS);
}

export async function otherMember(session: HouseholdSession): Promise<{ userId: string; name: string } | null> {
  const db = await createUserClient();
  if (!db) return null;
  const { data } = await db
    .from("household_members")
    .select("user_id, display_name")
    .eq("household_id", session.householdId)
    .neq("user_id", session.userId)
    .limit(1)
    .maybeSingle();
  return data ? { userId: data.user_id, name: data.display_name } : null;
}

/**
 * Looks one audit row up with the caller's RLS client, scoped to their household AND to the other member's actions.
 * Audit ids are guessable, so both filters are required.
 */
export async function findThankable(session: HouseholdSession, auditId: number): Promise<Thankable | null> {
  const db = await createUserClient();
  const other = await otherMember(session);
  if (!db || !other) return null;
  const { data } = await db
    .from("audit_log")
    .select("id, action, summary, created_at")
    .eq("id", auditId)
    .eq("household_id", session.householdId)
    .eq("actor_user_id", other.userId)
    .maybeSingle();
  return data ? toThankable(data as AuditLite, other.name) : null;
}

/** Suggestions from what the other member did in the last 24h. Empty on any failure. */
export async function otherMemberActivity(session: HouseholdSession, now: Date): Promise<NeedItem[]> {
  const db = await createUserClient();
  const other = await otherMember(session);
  if (!db || !other) return [];
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  const { data } = await db
    .from("audit_log")
    .select("id, action, summary, created_at")
    .eq("household_id", session.householdId)
    .eq("actor_user_id", other.userId)
    .in("action", [...ACTIONS])
    .gte("created_at", since)
    .order("id", { ascending: false })
    .limit(20);
  const rows = (data ?? []) as AuditLite[];
  if (rows.length === 0) return [];
  const { data: sent } = await db
    .from("kudos")
    .select("audit_id")
    .eq("from_user", session.userId)
    .in("audit_id", rows.map((r) => r.id));
  const thanked = new Set(
    (sent ?? []).map((k: { audit_id: number | null }) => k.audit_id).filter((x): x is number => x !== null),
  );
  return mapActivity(rows, other.name, thanked, now).map((x) => x.item);
}
