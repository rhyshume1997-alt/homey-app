import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import type { HouseholdSession } from "@/server/auth/session";
import { EmergencyInputSchema, EmergencyItemSchema, type EmergencyInput, type EmergencyItem } from "@/contracts/emergency";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load this right now.",
} as const;

const SELECT = "id,household_id,section,label,detail,sort_order,created_by,created_at,updated_at";

export function parseEmergencyForm(fd: FormData): EmergencyInput | null {
  const r = EmergencyInputSchema.safeParse({
    section: fd.get("section"),
    label: fd.get("label") ?? "",
    detail: fd.get("detail") ?? "",
  });
  return r.success ? r.data : null;
}

export function parseEditForm(fd: FormData): Pick<EmergencyInput, "label" | "detail"> | null {
  const r = EmergencyInputSchema.pick({ label: true, detail: true }).safeParse({
    label: fd.get("label") ?? "",
    detail: fd.get("detail") ?? "",
  });
  return r.success ? r.data : null;
}

export function parseId(fd: FormData): string | null {
  const r = z.uuid().safeParse(fd.get("id"));
  return r.success ? r.data : null;
}

type Db = NonNullable<Awaited<ReturnType<typeof createUserClient>>>;

async function run(fn: (db: Db) => PromiseLike<{ error: unknown }>): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await fn(db);
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

export async function listEmergencyItems(): Promise<Result<EmergencyItem[]>> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.load };
  const { data, error } = await db
    .from("emergency_items")
    .select(SELECT)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const parsed = z.array(EmergencyItemSchema).safeParse(data);
  return error || !parsed.success ? { ok: false, error: MSG.load } : { ok: true, data: parsed.data };
}

/** New items go to the end of their section. */
export async function addEmergencyItem(s: HouseholdSession, i: EmergencyInput): Promise<Result> {
  const list = await listEmergencyItems();
  if (!list.ok) return { ok: false, error: MSG.failed };
  const last = list.data.filter((x) => x.section === i.section).reduce((m, x) => Math.max(m, x.sort_order), 0);
  const sort_order = Math.min(1000, last + 10);
  return run((db) =>
    db.from("emergency_items").insert({ ...i, sort_order, household_id: s.householdId, created_by: s.userId }),
  );
}

export const updateEmergencyItem = (s: HouseholdSession, id: string, i: Pick<EmergencyInput, "label" | "detail">) =>
  run((db) => db.from("emergency_items").update(i).eq("id", id).eq("household_id", s.householdId));

export const removeEmergencyItem = (s: HouseholdSession, id: string) =>
  run((db) => db.from("emergency_items").delete().eq("id", id).eq("household_id", s.householdId));
