/** Maintenance limits and seasons without zod, so the client forms stay small. */

/** Limits mirror supabase/migrations/20261022190000_maintenance.sql. */
export const MAINT_LIMITS = { title: 120, area: 60, notes: 1000, provider: 120, logNotes: 500, maxInterval: 120 } as const;

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

export const SEASON_LABEL: Record<Season, string> = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };
