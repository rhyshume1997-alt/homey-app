import { z } from "zod";

export const CHECKLIST_SEASONS = ["autumn", "winter", "spring", "summer", "any"] as const;
export const CHECKLIST_FREQUENCIES = ["monthly", "yearly"] as const;

export const ChecklistItemSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(120),
  season: z.enum(CHECKLIST_SEASONS),
  frequency: z.enum(CHECKLIST_FREQUENCIES),
  /** 1..12, yearly items only. */
  month: z.number().int().min(1).max(12).nullable(),
  room_id: z.uuid().nullable(),
  /** ISO dates (YYYY-MM-DD). next_due_on is computed by the database. */
  last_done_on: z.iso.date().nullable(),
  next_due_on: z.iso.date().nullable(),
  notes: z.string().max(500).nullable(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

/** What Homey and the calendar need: a dated item. */
export type DueChecklistItem = Pick<ChecklistItem, "id" | "title" | "season" | "room_id"> & {
  next_due_on: string;
};
