import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import { scopedDb } from "@/server/db/scoped";
import type { HouseholdSession } from "@/server/auth/session";
import { TaskInputSchema, TaskSchema, type Task, type TaskInput } from "@/contracts/tasks";
import { HouseholdMemberSchema } from "@/contracts/household";

export type Member = { user_id: string; display_name: string };
export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load tasks right now.",
} as const;

const text = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Turns form fields into validated input; blanks become null. Null result means invalid. */
export function parseTaskForm(fd: FormData): TaskInput | null {
  const r = TaskInputSchema.safeParse({
    title: fd.get("title") ?? "",
    notes: text(fd.get("notes")),
    assignee_user_id: text(fd.get("assignee_user_id")),
    due_date: text(fd.get("due_date")),
    recurrence: fd.get("recurrence") ?? "none",
    room_id: text(fd.get("room_id")),
  });
  return r.success ? r.data : null;
}

export function parseId(fd: FormData): string | null {
  const r = z.uuid().safeParse(fd.get("id"));
  return r.success ? r.data : null;
}

export async function listTasks(): Promise<Result<Task[]>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: MSG.load };
  const { db, householdId } = sc;
  const { data, error } = await db.from("tasks").select("*").eq("household_id", householdId);
  if (error || !data) return { ok: false, error: MSG.load };
  const parsed = z.array(TaskSchema).safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: MSG.load };
}

export async function listMembers(): Promise<Member[]> {
  const sc = await scopedDb();
  if (!sc) return [];
  const { db, householdId } = sc;
  const { data } = await db
    .from("household_members")
    .select("user_id, display_name")
    .eq("household_id", householdId)
    .eq("status", "active")
    .order("display_name");
  const parsed = z.array(HouseholdMemberSchema.pick({ user_id: true, display_name: true })).safeParse(data ?? []);
  return parsed.success ? parsed.data : [];
}

async function run(
  fn: (db: NonNullable<Awaited<ReturnType<typeof createUserClient>>>) => PromiseLike<{ error: unknown }>,
): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await fn(db);
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

const fields = (i: TaskInput) => ({
  title: i.title,
  notes: i.notes ?? null,
  assignee_user_id: i.assignee_user_id ?? null,
  due_date: i.due_date ?? null,
  recurrence: i.recurrence,
  room_id: i.room_id ?? null,
});

export const createTask = (s: HouseholdSession, i: TaskInput) =>
  run((db) => db.from("tasks").insert({ ...fields(i), household_id: s.householdId, created_by: s.userId }));

export const updateTask = (s: HouseholdSession, id: string, i: TaskInput) =>
  run((db) => db.from("tasks").update(fields(i)).eq("id", id).eq("household_id", s.householdId));

export const setTaskDone = (s: HouseholdSession, id: string, done: boolean) =>
  run((db) =>
    db
      .from("tasks")
      .update(
        done
          ? { status: "done", completed_at: new Date().toISOString(), completed_by: s.userId }
          : { status: "open", completed_at: null, completed_by: null },
      )
      .eq("id", id)
      .eq("household_id", s.householdId),
  );

export const deleteTask = (s: HouseholdSession, id: string) =>
  run((db) => db.from("tasks").delete().eq("id", id).eq("household_id", s.householdId));
