import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import { scopedDb } from "@/server/db/scoped";
import type { HouseholdSession } from "@/server/auth/session";
import { addDays, londonToday, type BinDay } from "@/components/bins/group";
import { BIN_COLOURS, BIN_LIMITS, mergeBinDays, type BinSchedule } from "@/components/bins/schedule";
import { parseCouncilUrl } from "@/components/bins/council-url";

export type BinsResult = { ok: true; days: BinDay[]; lastSynced: string | null } | { ok: false; error: string };
export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
export type BinsPage = { days: BinDay[]; lastSynced: string | null; councilUrl: string | null; schedules: BinSchedule[] };

const WEEKS = 8;
const FAIL = "Could not load bin collections right now.";
export const MSG = {
  invalid: "Please check the details and try again.",
  invalidUrl: "Enter a secure link that starts with https://",
  failed: "Something went wrong. Please try again.",
} as const;

const ScheduleRowSchema = z.object({
  id: z.uuid(),
  bin_name: z.string(),
  colour: z.enum(BIN_COLOURS),
  first_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  every_weeks: z.number().int().min(1).max(BIN_LIMITS.every),
});

const ScheduleInputSchema = z.object({
  bin_name: z.string().trim().min(1).max(BIN_LIMITS.name),
  colour: z.enum(BIN_COLOURS),
  first_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v)),
  every_weeks: z.coerce.number().int().min(1).max(BIN_LIMITS.every),
});
export type ScheduleInput = z.infer<typeof ScheduleInputSchema>;

export function parseScheduleForm(fd: FormData): ScheduleInput | null {
  const r = ScheduleInputSchema.safeParse({
    bin_name: String(fd.get("bin_name") ?? ""),
    colour: fd.get("colour"),
    first_date: String(fd.get("first_date") ?? ""),
    every_weeks: fd.get("every_weeks"),
  });
  return r.success ? r.data : null;
}
export function parseId(v: unknown): string | null {
  const r = z.uuid().safeParse(v);
  return r.success ? r.data : null;
}

/** Council link: blank clears it. Null return means invalid. */
export function parseCouncilForm(fd: FormData): { url: string | null } | null {
  const raw = String(fd.get("council_url") ?? "").trim();
  if (raw === "") return { url: null };
  const url = parseCouncilUrl(raw);
  return url ? { url } : null;
}

export async function listSchedules(): Promise<Result<BinSchedule[]>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: FAIL };
  const { data, error } = await sc.db.from("bin_schedules")
    .select("id,bin_name,colour,first_date,every_weeks").eq("household_id", sc.householdId)
    .order("bin_name").order("created_at").limit(100);
  const parsed = z.array(ScheduleRowSchema).safeParse(data);
  return error || !parsed.success ? { ok: false, error: FAIL } : { ok: true, data: parsed.data };
}

export async function getCouncilUrl(): Promise<Result<string | null>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: FAIL };
  const { data, error } = await sc.db.from("bin_settings").select("council_url").eq("household_id", sc.householdId).maybeSingle();
  if (error) return { ok: false, error: FAIL };
  // Re-validate on the way out: only ever hand a safe https link to a client.
  return { ok: true, data: parseCouncilUrl(data?.council_url) };
}

/** Saves (or with null clears) the household's council link. The caller must pass a value from parseCouncilUrl. */
export async function saveCouncilUrl(s: HouseholdSession, url: string | null): Promise<Result> {
  if (url !== null && parseCouncilUrl(url) !== url) return { ok: false, error: MSG.invalidUrl };
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await db.from("bin_settings").upsert({ household_id: s.householdId, council_url: url }, { onConflict: "household_id" });
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

export async function addSchedule(s: HouseholdSession, input: ScheduleInput): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await db.from("bin_schedules").insert({ ...input, household_id: s.householdId, created_by: s.userId });
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

export async function editSchedule(s: HouseholdSession, id: string, input: ScheduleInput): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { data, error } = await db.from("bin_schedules").update(input).eq("id", id).eq("household_id", s.householdId).select("id");
  return error || !data?.length ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

export async function removeSchedule(s: HouseholdSession, id: string): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await db.from("bin_schedules").delete().eq("id", id).eq("household_id", s.householdId);
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

/** Everything the bins page needs. Days merge the household's schedules with pushed collections. */
export async function loadBinsPage(now: Date = new Date()): Promise<Result<BinsPage>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: FAIL };
  const { db, householdId } = sc;
  const today = londonToday(now);
  const [rows, last, sched, settings] = await Promise.all([
    db.from("bin_collections").select("collection_date, bin_name").eq("household_id", householdId)
      .gte("collection_date", today).lt("collection_date", addDays(today, WEEKS * 7))
      .order("collection_date").limit(500),
    db.from("bin_collections").select("received_at").eq("household_id", householdId).order("received_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("bin_schedules").select("id,bin_name,colour,first_date,every_weeks").eq("household_id", householdId)
      .order("bin_name").order("created_at").limit(100),
    db.from("bin_settings").select("council_url").eq("household_id", householdId).maybeSingle(),
  ]);
  const schedules = z.array(ScheduleRowSchema).safeParse(sched.data);
  if (rows.error || last.error || sched.error || settings.error || !rows.data || !schedules.success) return { ok: false, error: FAIL };
  const pushed = rows.data.map((r) => ({ date: String(r.collection_date), bin: String(r.bin_name) }));
  return {
    ok: true,
    data: {
      days: mergeBinDays(schedules.data, pushed, now, WEEKS),
      lastSynced: last.data ? String(last.data.received_at) : null,
      councilUrl: parseCouncilUrl(settings.data?.council_url),
      schedules: schedules.data,
    },
  };
}

/** Next 8 weeks of collections for the caller's household (schedules plus pushed rows). */
export async function loadBins(now: Date = new Date()): Promise<BinsResult> {
  const r = await loadBinsPage(now);
  return r.ok ? { ok: true, days: r.data.days, lastSynced: r.data.lastSynced } : r;
}
