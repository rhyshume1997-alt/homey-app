import { z } from "zod";
import type { DueKind, Light } from "@/components/status";

export const EVENT_LIMITS = { title: 120, notes: 500 } as const;

export const HouseholdEventSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  title: z.string().min(1).max(EVENT_LIMITS.title),
  starts_on: z.iso.date(),
  starts_at: z.string().nullable(),
  ends_on: z.iso.date().nullable(),
  all_day: z.boolean(),
  room_id: z.uuid().nullable(),
  notes: z.string().max(EVENT_LIMITS.notes).nullable(),
});
export type HouseholdEvent = z.infer<typeof HouseholdEventSchema>;

/** Form input. household_id and created_by come from the session, never the client. */
export const EventInputSchema = z.object({
  title: z.string().trim().min(1).max(EVENT_LIMITS.title),
  starts_on: z.iso.date(),
  starts_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish(),
  room_id: z.uuid().nullish(),
  notes: z.string().trim().max(EVENT_LIMITS.notes).nullish(),
});
export type EventInput = z.infer<typeof EventInputSchema>;

/** One dated thing on the calendar, whatever table it came from. */
export type CalendarItem = {
  /** Unique and stable: "<source>:<id>[:<date>]". */
  key: string;
  date: string;
  title: string;
  kind: DueKind | "event";
  light: Light;
  href: string;
  /** Optional HH:MM, events only. */
  time?: string;
};
