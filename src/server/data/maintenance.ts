import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import type { HouseholdSession } from "@/server/auth/session";
import {
  DoneInputSchema, MaintenanceInputSchema, MaintenanceItemSchema, MaintenanceLogSchema, SOON_DAYS, SUGGESTIONS,
  daysUntil,
  type DoneInput, type MaintenanceInput, type MaintenanceItem, type MaintenanceLog,
} from "@/components/maintenance/model";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load maintenance right now.",
} as const;

const text = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v : null);

export function parseMaintenanceForm(fd: FormData): MaintenanceInput | null {
  const r = MaintenanceInputSchema.safeParse({
    title: fd.get("title") ?? "",
    area: text(fd.get("area")),
    interval_months: text(fd.get("interval_months")),
    season: text(fd.get("season")),
    next_due_on: text(fd.get("next_due_on")),
    notes: text(fd.get("notes")),
    provider: text(fd.get("provider")),
  });
  return r.success ? r.data : null;
}

export function parseDoneForm(fd: FormData): DoneInput | null {
  const r = DoneInputSchema.safeParse({
    done_on: fd.get("done_on"),
    notes: text(fd.get("notes")),
    cost_gbp: text(fd.get("cost_gbp")),
  });
  return r.success ? r.data : null;
}

export function parseId(fd: FormData): string | null {
  const r = z.uuid().safeParse(fd.get("id"));
  return r.success ? r.data : null;
}

/** A suggestion is identified by index into the static list; the client never supplies its content. */
export function parseSuggestionIndex(fd: FormData): number | null {
  const v = fd.get("suggestion");
  if (typeof v !== "string" || !/^\d{1,3}$/.test(v)) return null;
  const n = Number(v);
  return n < SUGGESTIONS.length ? n : null;
}

export async function listMaintenance(): Promise<Result<MaintenanceItem[]>> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.load };
  const { data, error } = await db.from("maintenance_items").select("*").limit(1000);
  if (error || !data) return { ok: false, error: MSG.load };
  const parsed = z.array(MaintenanceItemSchema).safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: MSG.load };
}

export async function listMaintenanceLog(): Promise<Result<MaintenanceLog[]>> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.load };
  const { data, error } = await db
    .from("maintenance_log")
    .select("id, item_id, done_on, notes, cost_gbp, created_at")
    .order("done_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error || !data) return { ok: false, error: MSG.load };
  const parsed = z.array(MaintenanceLogSchema).safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: MSG.load };
}

/** Dashboard card: overdue and due within 30 days, soonest first, top 3. Null when it could not load. */
export async function getMaintenanceCardData(today: string): Promise<MaintenanceItem[] | null> {
  const r = await listMaintenance();
  if (!r.ok) return null;
  return r.data
    .filter((i) => i.next_due_on !== null && daysUntil(today, i.next_due_on) <= SOON_DAYS)
    .sort((a, b) => (a.next_due_on ?? "").localeCompare(b.next_due_on ?? "") || a.title.localeCompare(b.title))
    .slice(0, 3);
}

async function run(
  fn: (db: NonNullable<Awaited<ReturnType<typeof createUserClient>>>) => PromiseLike<{ error: unknown }>,
): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await fn(db);
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

const fields = (i: MaintenanceInput) => ({
  title: i.title,
  area: i.area ?? null,
  interval_months: i.interval_months ?? null,
  season: i.season ?? null,
  next_due_on: i.next_due_on ?? null,
  notes: i.notes ?? null,
  provider: i.provider ?? null,
});

export const createItem = (s: HouseholdSession, i: MaintenanceInput) =>
  run((db) => db.from("maintenance_items").insert({ ...fields(i), household_id: s.householdId, created_by: s.userId }));

/** Adds one suggestion from the static list. next_due_on stays null: no dates are invented. */
export const addSuggestion = async (s: HouseholdSession, index: number): Promise<Result> => {
  const sg = SUGGESTIONS[index];
  if (!sg) return { ok: false, error: MSG.invalid };
  return run((db) =>
    db.from("maintenance_items").insert({
      title: sg.title, area: sg.area, interval_months: sg.interval_months, season: sg.season, notes: sg.notes,
      next_due_on: null, household_id: s.householdId, created_by: s.userId,
    }),
  );
};

export const updateItem = (s: HouseholdSession, id: string, i: MaintenanceInput) =>
  run((db) => db.from("maintenance_items").update(fields(i)).eq("id", id).eq("household_id", s.householdId));

export const deleteItem = (s: HouseholdSession, id: string) =>
  run((db) => db.from("maintenance_items").delete().eq("id", id).eq("household_id", s.householdId));

export const logDone = (s: HouseholdSession, id: string, i: DoneInput) =>
  run((db) =>
    db.from("maintenance_log").insert({
      household_id: s.householdId, item_id: id, done_on: i.done_on, notes: i.notes ?? null, cost_gbp: i.cost_gbp ?? null,
    }),
  );
