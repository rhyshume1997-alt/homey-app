import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import type { HouseholdSession } from "@/server/auth/session";
import { HouseholdRecordSchema, type HouseholdRecord } from "@/contracts/records";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load this right now.",
} as const;

/** Keeps only rows that match the contract; invalid rows are dropped, never guessed at. */
export function parseRecords(rows: unknown): HouseholdRecord[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r) => {
    const p = HouseholdRecordSchema.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

export function parseRecordId(fd: FormData): string | null {
  const r = z.uuid().safeParse(fd.get("id"));
  return r.success ? r.data : null;
}

export async function listRecords(): Promise<Result<HouseholdRecord[]>> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.load };
  const { data, error } = await db.from("household_records").select("*").limit(2000);
  if (error || !data) return { ok: false, error: MSG.load };
  return { ok: true, data: parseRecords(data) };
}

export async function markRecordVerified(s: HouseholdSession, id: string): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await db
    .from("household_records")
    .update({ verified: true })
    .eq("id", id)
    .eq("household_id", s.householdId);
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

/** "£1,234.56", "1234.5" or "69" -> 1234.56 / 1234.5 / 69. Anything else -> null. */
export function parseAmount(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^£/, "").replace(/,/g, "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}

/**
 * A person has checked a figure: stores the amount they confirmed (corrected or as is)
 * and marks it verified. Only for records that already have an amount, so the unit is known.
 */
export async function confirmRecordFigure(s: HouseholdSession, id: string, amount: number): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { data, error } = await db
    .from("household_records")
    .update({ amount, verified: true })
    .eq("id", id)
    .eq("household_id", s.householdId)
    .not("amount", "is", null)
    .select("id");
  if (error) return { ok: false, error: MSG.failed };
  return data && data.length === 1 ? { ok: true, data: undefined } : { ok: false, error: MSG.invalid };
}
