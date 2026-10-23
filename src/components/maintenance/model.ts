import { z } from "zod";
import { MAINT_LIMITS, SEASONS, SEASON_LABEL, type Season } from "./constants";

export { MAINT_LIMITS, SEASON_LABEL, type Season };
export const SeasonSchema = z.enum(SEASONS);

export const MaintenanceItemSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  title: z.string().min(1).max(MAINT_LIMITS.title),
  area: z.string().max(MAINT_LIMITS.area).nullable(),
  interval_months: z.number().int().min(1).max(MAINT_LIMITS.maxInterval).nullable(),
  season: SeasonSchema.nullable(),
  last_done_on: z.iso.date().nullable(),
  next_due_on: z.iso.date().nullable(),
  notes: z.string().max(MAINT_LIMITS.notes).nullable(),
  provider: z.string().max(MAINT_LIMITS.provider).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MaintenanceItem = z.infer<typeof MaintenanceItemSchema>;

export const MaintenanceLogSchema = z.object({
  id: z.uuid(),
  item_id: z.uuid(),
  done_on: z.iso.date(),
  notes: z.string().max(MAINT_LIMITS.logNotes).nullable(),
  // PostgREST returns numeric as a number; null means the cost is unknown (not zero).
  cost_gbp: z.number().nullable(),
  created_at: z.string(),
});
export type MaintenanceLog = z.infer<typeof MaintenanceLogSchema>;

/** Form input. household_id and created_by come from the session, never the client. */
export const MaintenanceInputSchema = z.object({
  title: z.string().trim().min(1).max(MAINT_LIMITS.title),
  area: z.string().trim().max(MAINT_LIMITS.area).nullish(),
  interval_months: z.coerce.number().int().min(1).max(MAINT_LIMITS.maxInterval).nullish(),
  season: SeasonSchema.nullish(),
  next_due_on: z.iso.date().nullish(),
  notes: z.string().trim().max(MAINT_LIMITS.notes).nullish(),
  provider: z.string().trim().max(MAINT_LIMITS.provider).nullish(),
});
export type MaintenanceInput = z.infer<typeof MaintenanceInputSchema>;

export const DoneInputSchema = z.object({
  done_on: z.iso.date(),
  notes: z.string().trim().max(MAINT_LIMITS.logNotes).nullish(),
  cost_gbp: z.coerce.number().min(0).max(99999999).nullish(),
});
export type DoneInput = z.infer<typeof DoneInputSchema>;

export type MaintenanceGroups = {
  overdue: MaintenanceItem[];
  soon: MaintenanceItem[];
  later: MaintenanceItem[];
  noDate: MaintenanceItem[];
};

export const SOON_DAYS = 30;

/** Whole days from `today` to `date` (both YYYY-MM-DD). Negative means in the past. */
export function daysUntil(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

const byDue = (a: MaintenanceItem, b: MaintenanceItem) =>
  (a.next_due_on ?? "").localeCompare(b.next_due_on ?? "") || a.title.localeCompare(b.title);

/** Overdue = before today; due soon = today up to 30 days ahead. */
export function groupMaintenance(items: readonly MaintenanceItem[], today: string): MaintenanceGroups {
  const g: MaintenanceGroups = { overdue: [], soon: [], later: [], noDate: [] };
  for (const i of items) {
    if (!i.next_due_on) g.noDate.push(i);
    else {
      const d = daysUntil(today, i.next_due_on);
      (d < 0 ? g.overdue : d <= SOON_DAYS ? g.soon : g.later).push(i);
    }
  }
  g.overdue.sort(byDue);
  g.soon.sort(byDue);
  g.later.sort(byDue);
  g.noDate.sort((a, b) => a.title.localeCompare(b.title));
  return g;
}

export type Suggestion = {
  title: string;
  area: string;
  interval_months: number | null;
  season: Season | null;
  notes: string;
};

/**
 * Common upkeep for a UK new-build home. These are suggestions only: nothing is added until
 * someone taps Add, and no due date is ever filled in for them.
 */
export const SUGGESTIONS: readonly Suggestion[] = [
  { title: "Boiler service", area: "Heating", interval_months: 12, season: "autumn", notes: "Annual service by a Gas Safe registered engineer. Check your warranty terms." },
  { title: "Test smoke and heat alarms", area: "Safety", interval_months: 1, season: null, notes: "Press the test button on each alarm." },
  { title: "Test carbon monoxide alarm", area: "Safety", interval_months: 1, season: null, notes: "Press the test button." },
  { title: "Bleed radiators", area: "Heating", interval_months: 12, season: "autumn", notes: "Before the heating season starts." },
  { title: "Check boiler pressure", area: "Heating", interval_months: 3, season: null, notes: "Usually between 1 and 2 bar when cold." },
  { title: "Clean gutters", area: "Outside", interval_months: 12, season: "autumn", notes: "Clear leaves and debris from gutters and downpipes." },
  { title: "Isolate external tap before winter", area: "Plumbing", interval_months: 12, season: "autumn", notes: "Turn off the supply inside and drain the outside tap to avoid frost damage." },
  { title: "Clean trickle vents", area: "Windows", interval_months: 6, season: null, notes: "Wipe vents and check they open and close." },
  { title: "Clean extractor fan filters", area: "Ventilation", interval_months: 6, season: null, notes: "Kitchen and bathroom extractor fans." },
  { title: "Clean cooker hood filter", area: "Kitchen", interval_months: 3, season: null, notes: "Check the manufacturer's guidance." },
  { title: "Check window and door seals", area: "Windows", interval_months: 12, season: "spring", notes: "Look for gaps, damp or condensation between panes." },
  { title: "Descale kettle, dishwasher and washing machine", area: "Appliances", interval_months: 3, season: null, notes: "Use the cleaning cycle if one is available." },
  { title: "Check roof from the ground", area: "Outside", interval_months: 12, season: "spring", notes: "Look for slipped tiles or leaks after winter. Do not climb onto the roof." },
  { title: "Check RCD trip switch", area: "Electrics", interval_months: 6, season: null, notes: "Press the test button on the consumer unit." },
  { title: "Check bath and shower sealant", area: "Bathroom", interval_months: 12, season: null, notes: "Look for gaps or mould and re-seal if needed." },
];


export function describeInterval(months: number | null): string {
  if (months === null) return "One-off";
  if (months === 1) return "Every month";
  if (months === 12) return "Every year";
  if (months % 12 === 0) return `Every ${months / 12} years`;
  return `Every ${months} months`;
}
