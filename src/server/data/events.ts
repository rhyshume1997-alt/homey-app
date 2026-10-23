import "server-only";
import { createUserClient } from "@/server/db/supabase";
import type { HouseholdSession } from "@/server/auth/session";

/** Server-side allowlist. The client sends only a slug; labels never come from the client. */
export const HOUSEHOLD_EVENTS: Readonly<Record<string, string>> = Object.freeze({
  "washing.on": "Put a washing on",
  "dishwasher.started": "Started the dishwasher",
  "dishwasher.emptied": "Emptied the dishwasher",
  "washing.away": "Put the washing away",
  "supplies.bought": "Bought supplies",
});

export const EVENT_NOTE_MAX = 200;

export const EVENT_MSG = {
  invalid: "That could not be logged. Please try again.",
  failed: "Could not log that. Please try again.",
} as const;

export type EventResult = { ok: true } | { ok: false; error: string };

export function eventLabel(slug: unknown): string | null {
  if (typeof slug !== "string") return null;
  return Object.hasOwn(HOUSEHOLD_EVENTS, slug) ? HOUSEHOLD_EVENTS[slug]! : null;
}

/** Trims; empty becomes null; over-long or non-string is rejected (undefined). */
export function parseNote(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return undefined;
  const n = raw.trim();
  if (n.length > EVENT_NOTE_MAX) return undefined;
  return n === "" ? null : n;
}

export async function logHouseholdEvent(
  session: Pick<HouseholdSession, "householdId">,
  slug: unknown,
  rawNote: unknown,
): Promise<EventResult> {
  const label = eventLabel(slug);
  const note = parseNote(rawNote);
  if (!label || note === undefined) return { ok: false, error: EVENT_MSG.invalid };
  const db = await createUserClient();
  if (!db) return { ok: false, error: EVENT_MSG.failed };
  const { error } = await db.rpc("log_audit", {
    p_household: session.householdId,
    p_action: "household.event",
    p_entity_type: "event",
    p_entity_id: slug as string,
    p_summary: note ? `${label}: ${note}` : label,
    p_before: null,
    p_after: null,
  });
  return error ? { ok: false, error: EVENT_MSG.failed } : { ok: true };
}
