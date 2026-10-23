import { z } from "zod";

export const ROOM_LIMITS = { name: 60, notes: 2000 } as const;

export const RoomSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  name: z.string().min(1).max(ROOM_LIMITS.name),
  sort_order: z.number().int().min(0).max(1000),
  notes: z.string().max(ROOM_LIMITS.notes).nullable(),
  created_by: z.uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Room = z.infer<typeof RoomSchema>;

/** Form input. household_id and created_by are set server side from the session. */
export const RoomNameInputSchema = z.object({ name: z.string().trim().min(1).max(ROOM_LIMITS.name) });
export const RoomNotesInputSchema = z.object({ notes: z.string().trim().max(ROOM_LIMITS.notes).nullable() });
