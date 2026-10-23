import { z } from "zod";
import { TASK_LIMITS } from "./limits";

export { TASK_LIMITS };

export const TaskRecurrenceSchema = z.enum(["none", "daily", "weekly", "monthly", "yearly"]);
export const TaskStatusSchema = z.enum(["open", "done"]);

export const TaskSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  title: z.string().min(1).max(TASK_LIMITS.title),
  notes: z.string().max(TASK_LIMITS.notes).nullable(),
  /** Null means either person. */
  assignee_user_id: z.uuid().nullable(),
  /** ISO date (YYYY-MM-DD) or null. */
  due_date: z.iso.date().nullable(),
  recurrence: TaskRecurrenceSchema,
  status: TaskStatusSchema,
  completed_at: z.string().nullable(),
  completed_by: z.uuid().nullable(),
  created_by: z.uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  /** Next occurrence spawned when a recurring task was completed. Read-only: set by the database. */
  // default(null): rows read before migration 20261022100000 is applied still parse.
  next_task_id: z.uuid().nullable().default(null),
  /** Optional room (D18). Optional so rows read before the rooms migration still parse. */
  room_id: z.uuid().nullable().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

/** Form input. household_id and created_by are set server side from the session, never from the client. */
export const TaskInputSchema = z.object({
  title: z.string().trim().min(1).max(TASK_LIMITS.title),
  notes: z.string().trim().max(TASK_LIMITS.notes).nullish(),
  assignee_user_id: z.uuid().nullish(),
  due_date: z.iso.date().nullish(),
  recurrence: TaskRecurrenceSchema.default("none"),
  room_id: z.uuid().nullish(),
});
export type TaskInput = z.infer<typeof TaskInputSchema>;
