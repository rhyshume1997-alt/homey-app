import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import { scopedDb } from "@/server/db/scoped";
import type { HouseholdSession } from "@/server/auth/session";
import { SnagInputSchema, SnagSchema, SnagStatusSchema, type Snag, type SnagInput } from "@/contracts/snags";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load snags right now.",
} as const;

const text = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Turns form fields into validated input; blanks become null. Null result means invalid. */
export function parseSnagForm(fd: FormData): SnagInput | null {
  const r = SnagInputSchema.safeParse({
    title: fd.get("title") ?? "",
    location: text(fd.get("location")),
    notes: text(fd.get("notes")),
    status: fd.get("status") ?? "open",
    priority: fd.get("priority") ?? "medium",
    room_id: text(fd.get("room_id")),
  });
  return r.success ? r.data : null;
}

export function parseId(fd: FormData): string | null {
  const r = z.uuid().safeParse(fd.get("id"));
  return r.success ? r.data : null;
}

export function parseStatus(fd: FormData) {
  const r = SnagStatusSchema.safeParse(fd.get("status"));
  return r.success ? r.data : null;
}

export async function listSnags(): Promise<Result<Snag[]>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: MSG.load };
  const { db, householdId } = sc;
  const { data, error } = await db.from("snags").select("*").eq("household_id", householdId);
  if (error || !data) return { ok: false, error: MSG.load };
  const parsed = z.array(SnagSchema).safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: MSG.load };
}

async function run(
  fn: (db: NonNullable<Awaited<ReturnType<typeof createUserClient>>>) => PromiseLike<{ error: unknown }>,
): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await fn(db);
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

const fixedAt = (status: SnagInput["status"]) => (status === "fixed" ? new Date().toISOString() : null);

const fields = (i: SnagInput) => ({
  title: i.title,
  location: i.location ?? null,
  notes: i.notes ?? null,
  status: i.status,
  priority: i.priority,
  fixed_at: fixedAt(i.status),
  room_id: i.room_id ?? null,
});

export const createSnag = (s: HouseholdSession, i: SnagInput) =>
  run((db) => db.from("snags").insert({ ...fields(i), household_id: s.householdId, created_by: s.userId }));

export const updateSnag = (s: HouseholdSession, id: string, i: SnagInput) =>
  run((db) => db.from("snags").update(fields(i)).eq("id", id).eq("household_id", s.householdId));

export const setSnagStatus = (s: HouseholdSession, id: string, status: SnagInput["status"]) =>
  run((db) =>
    db.from("snags").update({ status, fixed_at: fixedAt(status) }).eq("id", id).eq("household_id", s.householdId),
  );

export const deleteSnag = (s: HouseholdSession, id: string) =>
  run((db) => db.from("snags").delete().eq("id", id).eq("household_id", s.householdId));
