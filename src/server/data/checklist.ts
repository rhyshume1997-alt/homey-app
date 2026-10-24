import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import { scopedDb } from "@/server/db/scoped";
import type { HouseholdSession } from "@/server/auth/session";
import { ChecklistItemSchema, type ChecklistItem, type DueChecklistItem } from "@/contracts/checklist";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load the checklist right now.",
} as const;

const COLS = "id,title,season,frequency,month,room_id,last_done_on,next_due_on,notes";

export function parseId(fd: FormData): string | null {
  const r = z.uuid().safeParse(fd.get("id"));
  return r.success ? r.data : null;
}

export async function listChecklist(): Promise<Result<ChecklistItem[]>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: MSG.load };
  const { db, householdId } = sc;
  const { data, error } = await db.from("checklist_items").select(COLS).eq("household_id", householdId).order("title");
  const parsed = z.array(ChecklistItemSchema).safeParse(data);
  return error || !parsed.success ? { ok: false, error: MSG.load } : { ok: true, data: parsed.data };
}

/**
 * Items due on or before `today` plus `withinDays` (default 7, the amber window). For Homey and
 * the calendar. Items covered by a task are left out so nothing is shown twice.
 */
export async function listDueChecklist(today: string, withinDays = 7): Promise<Result<DueChecklistItem[]>> {
  const r = await listChecklist();
  if (!r.ok) return r;
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + withinDays * 86_400_000).toISOString().slice(0, 10);
  const due = r.data
    .filter((i): i is ChecklistItem & { next_due_on: string } => i.next_due_on !== null && i.next_due_on <= limit)
    .filter((i) => !/^covered by task/i.test(i.notes ?? ""))
    .sort((a, b) => a.next_due_on.localeCompare(b.next_due_on) || a.title.localeCompare(b.title))
    .map(({ id, title, season, next_due_on, room_id }) => ({ id, title, season, next_due_on, room_id }));
  return { ok: true, data: due };
}

/** Sets last_done_on to `today`; the database recomputes next_due_on. */
export async function markChecklistDone(s: HouseholdSession, id: string, today: string): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await db.from("checklist_items").update({ last_done_on: today }).eq("id", id).eq("household_id", s.householdId);
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

/**
 * Creates a task from a checklist item. Title and due date come from the stored item, never the
 * client. Call only after an explicit user confirmation (the Confirm button of the dialog).
 */
export async function createTaskFromChecklist(s: HouseholdSession, id: string, today: string): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { data, error } = await db
    .from("checklist_items")
    .select("title,next_due_on,room_id")
    .eq("id", id)
    .eq("household_id", s.householdId)
    .maybeSingle();
  if (error || !data) return { ok: false, error: MSG.failed };
  const { error: insErr } = await db.from("tasks").insert({
    household_id: s.householdId,
    created_by: s.userId,
    title: data.title,
    due_date: data.next_due_on ?? today,
    room_id: data.room_id,
    recurrence: "none",
  });
  return insErr ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}
