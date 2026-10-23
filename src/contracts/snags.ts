import { z } from "zod";
import { SNAG_LIMITS } from "./limits";

export { SNAG_LIMITS };

export const SnagStatusSchema = z.enum(["open", "reported", "in_progress", "fixed"]);
export const SnagPrioritySchema = z.enum(["low", "medium", "high"]);

export const SnagSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  title: z.string().min(1).max(SNAG_LIMITS.title),
  location: z.string().max(SNAG_LIMITS.location).nullable(),
  notes: z.string().max(SNAG_LIMITS.notes).nullable(),
  status: SnagStatusSchema,
  priority: SnagPrioritySchema,
  fixed_at: z.string().nullable(),
  created_by: z.uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  room_id: z.uuid().nullable().optional(),
});
export type Snag = z.infer<typeof SnagSchema>;

/** Form input. household_id and created_by are set server side from the session. */
export const SnagInputSchema = z.object({
  title: z.string().trim().min(1).max(SNAG_LIMITS.title),
  location: z.string().trim().max(SNAG_LIMITS.location).nullish(),
  notes: z.string().trim().max(SNAG_LIMITS.notes).nullish(),
  status: SnagStatusSchema.default("open"),
  priority: SnagPrioritySchema.default("medium"),
  room_id: z.uuid().nullish(),
});
export type SnagInput = z.infer<typeof SnagInputSchema>;
