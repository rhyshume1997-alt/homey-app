import "server-only";
import { THANKS, fill } from "@/components/homey/copy";
import { KUDOS_MAX, KudosMessageSchema, type ReceivedKudos } from "@/contracts/kudos";
import type { HouseholdSession } from "@/server/auth/session";
import { createUserClient } from "@/server/db/supabase";
import { findThankable, otherMember } from "./activity";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const FAILED = "Could not send that. Please try again.";

function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) || s.length === 1 ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** Pure: a draft from the templates. Deterministic per audit id so a reload shows the same draft. */
export function draftThanks(input: { auditId: number; name: string; thing: string }): string {
  const template = THANKS[Math.abs(input.auditId) % THANKS.length] ?? THANKS[0]!;
  return fill(template, { name: input.name, thing: lowerFirst(input.thing) }).slice(0, KUDOS_MAX);
}

/** Server-side draft for a key's audit id. Nothing is stored or sent. */
export async function draftThanksFor(session: HouseholdSession, auditId: number): Promise<Result<{ draft: string }>> {
  const t = await findThankable(session, auditId);
  if (!t) return { ok: false, error: "That is no longer available." };
  return { ok: true, data: { draft: draftThanks(t) } };
}

/** Sends in-app only, after the user tapped Send. Sender is set by the database trigger, never by us. */
export async function sendKudos(session: HouseholdSession, auditId: number, message: string): Promise<Result> {
  const msg = KudosMessageSchema.safeParse(message);
  if (!msg.success) return { ok: false, error: `Write a short note, up to ${KUDOS_MAX} characters.` };
  if (!Number.isSafeInteger(auditId) || auditId <= 0) return { ok: false, error: FAILED };
  const t = await findThankable(session, auditId);
  const other = await otherMember(session);
  const db = await createUserClient();
  if (!t || !other || !db) return { ok: false, error: "That is no longer available." };
  const { error } = await db
    .from("kudos")
    .insert({ household_id: session.householdId, to_user: other.userId, audit_id: auditId, message: msg.data });
  if (error) return { ok: false, error: error.code === "23505" ? "You already said thanks for that." : FAILED };
  return { ok: true, data: undefined };
}

/** Kudos sent to the caller since a time, for their Homey panel. */
export async function receivedKudos(session: HouseholdSession, since: Date): Promise<ReceivedKudos[]> {
  const db = await createUserClient();
  if (!db) return [];
  const { data } = await db
    .from("kudos")
    .select("id, from_user, message, created_at")
    .eq("household_id", session.householdId)
    .eq("to_user", session.userId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(10);
  if (!data?.length) return [];
  const other = await otherMember(session);
  return data.map((k: { id: string; message: string; created_at: string }) => ({
    id: k.id,
    fromName: other?.name ?? "Someone",
    message: k.message,
    createdAt: k.created_at,
  }));
}
