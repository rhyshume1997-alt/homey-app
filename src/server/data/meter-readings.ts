import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import { scopedDb } from "@/server/db/scoped";
import type { HouseholdSession } from "@/server/auth/session";
import {
  METER_FUELS, METER_UNITS, METER_SOURCES, MeterReadingDraftSchema, MeterReadingInputSchema,
  type MeterReading, type MeterReadingDraft, type MeterReadingInput,
} from "@/contracts/meter-readings";
import { todayInLondon } from "@/server/data/dashboard";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load this right now.",
  future: "A reading cannot be dated in the future.",
  duplicate: "There is already a reading for that fuel on that date.",
} as const;

const RowSchema = z.object({
  id: z.uuid(),
  fuel: z.enum(METER_FUELS),
  read_on: z.string(),
  value: z.coerce.number(),
  unit: z.enum(METER_UNITS),
  source: z.enum(METER_SOURCES),
  note: z.string().nullable(),
});

/** Electricity is read in kWh; gas may be kWh or m3. */
const unitMatchesFuel = (i: { fuel: string; unit: string }) => !(i.fuel === "electricity" && i.unit !== "kWh");

export function parseReadingForm(fd: FormData): MeterReadingInput | null {
  const raw = String(fd.get("value") ?? "").trim().replace(/,/g, "");
  const note = fd.get("note");
  const r = MeterReadingInputSchema.safeParse({
    fuel: fd.get("fuel"),
    read_on: fd.get("read_on"),
    value: raw === "" ? Number.NaN : Number(raw),
    unit: fd.get("unit"),
    note: typeof note === "string" && note.trim() !== "" ? note : null,
  });
  return r.success && unitMatchesFuel(r.data) ? r.data : null;
}
export function parseReadingId(fd: FormData): string | null {
  const r = z.uuid().safeParse(fd.get("id"));
  return r.success ? r.data : null;
}

export async function listReadings(): Promise<Result<MeterReading[]>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: MSG.load };
  const { db, householdId } = sc;
  const { data, error } = await db
    .from("meter_readings")
    .select("id,fuel,read_on,value,unit,source,note").eq("household_id", householdId)
    .order("read_on", { ascending: false })
    .limit(500);
  const parsed = z.array(RowSchema).safeParse(data);
  return error || !parsed.success ? { ok: false, error: MSG.load } : { ok: true, data: parsed.data };
}

function failure(error: { code?: string; message?: string }): string {
  if (error.code === "23505") return MSG.duplicate;
  if (error.code === "23514" && /future/.test(error.message ?? "")) return MSG.future;
  return MSG.failed;
}

export async function addReading(s: HouseholdSession, input: MeterReadingInput): Promise<Result> {
  if (input.read_on > todayInLondon()) return { ok: false, error: MSG.future };
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await db.from("meter_readings").insert({
    household_id: s.householdId, created_by: s.userId, source: "manual",
    fuel: input.fuel, read_on: input.read_on, value: input.value, unit: input.unit, note: input.note ?? null,
  });
  return error ? { ok: false, error: failure(error) } : { ok: true, data: undefined };
}

export async function removeReading(s: HouseholdSession, id: string): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await db.from("meter_readings").delete().eq("id", id).eq("household_id", s.householdId);
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

async function hashExists(db: NonNullable<Awaited<ReturnType<typeof createUserClient>>>, householdId: string, hash: string) {
  const { data, error } = await db
    .from("meter_readings").select("id").eq("household_id", householdId).eq("source_message_hash", hash).limit(1);
  return { error, found: !!data && data.length > 0 };
}

/**
 * Saves a reading proposed from an email, after the person confirmed it. Idempotent on
 * source_message_hash: saving the same message again changes nothing and still succeeds.
 */
export async function saveReadingDraft(
  s: HouseholdSession,
  draft: MeterReadingDraft,
): Promise<Result<{ created: boolean }>> {
  const d = MeterReadingDraftSchema.safeParse(draft);
  if (!d.success || !unitMatchesFuel(d.data)) return { ok: false, error: MSG.invalid };
  if (d.data.read_on > todayInLondon()) return { ok: false, error: MSG.future };
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const before = await hashExists(db, s.householdId, d.data.source_message_hash);
  if (before.error) return { ok: false, error: MSG.failed };
  if (before.found) return { ok: true, data: { created: false } };
  const { error } = await db.from("meter_readings").insert({
    household_id: s.householdId, created_by: s.userId, source: "email",
    source_message_hash: d.data.source_message_hash,
    fuel: d.data.fuel, read_on: d.data.read_on, value: d.data.value, unit: d.data.unit, note: d.data.note ?? null,
  });
  if (error) {
    // Lost a race with the same message: the unique index makes it a no-op.
    if (error.code === "23505" && (await hashExists(db, s.householdId, d.data.source_message_hash)).found) {
      return { ok: true, data: { created: false } };
    }
    return { ok: false, error: failure(error) };
  }
  return { ok: true, data: { created: true } };
}
