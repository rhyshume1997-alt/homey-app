import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import { scopedDb } from "@/server/db/scoped";
import type { HouseholdSession } from "@/server/auth/session";
import { EventInputSchema, HouseholdEventSchema, type EventInput, type HouseholdEvent } from "@/contracts/calendar";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load events right now.",
} as const;

const text = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v : null);

export function parseEventForm(fd: FormData): EventInput | null {
  const r = EventInputSchema.safeParse({
    title: fd.get("title") ?? "",
    starts_on: fd.get("starts_on"),
    starts_at: text(fd.get("starts_at")),
    room_id: text(fd.get("room_id")),
    notes: text(fd.get("notes")),
  });
  return r.success ? r.data : null;
}

export function parseEventId(fd: FormData): string | null {
  const r = z.uuid().safeParse(fd.get("id"));
  return r.success ? r.data : null;
}

export async function listEvents(from: string, to: string): Promise<Result<HouseholdEvent[]>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: MSG.load };
  const { db, householdId } = sc;
  const { data, error } = await db
    .from("household_events").select("*").eq("household_id", householdId).gte("starts_on", from).lte("starts_on", to)
    .order("starts_on").limit(1000);
  if (error || !data) return { ok: false, error: MSG.load };
  const parsed = z.array(HouseholdEventSchema).safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: MSG.load };
}

export async function listRoomOptions(): Promise<{ id: string; name: string }[]> {
  const sc = await scopedDb();
  if (!sc) return [];
  const { db, householdId } = sc;
  const { data } = await db.from("rooms").select("id, name").eq("household_id", householdId).order("sort_order");
  const parsed = z.array(z.object({ id: z.uuid(), name: z.string() })).safeParse(data ?? []);
  return parsed.success ? parsed.data : [];
}

export async function createEvent(s: HouseholdSession, i: EventInput): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await db.from("household_events").insert({
    household_id: s.householdId,
    created_by: s.userId,
    title: i.title,
    starts_on: i.starts_on,
    starts_at: i.starts_at ?? null,
    all_day: !i.starts_at,
    room_id: i.room_id ?? null,
    notes: i.notes ?? null,
  });
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

export async function deleteEvent(s: HouseholdSession, id: string): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await db.from("household_events").delete().eq("id", id).eq("household_id", s.householdId);
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}
