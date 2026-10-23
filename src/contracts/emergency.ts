import { z } from "zod";

export const EMERGENCY_SECTIONS = ["location", "step", "number"] as const;
export type EmergencySection = (typeof EMERGENCY_SECTIONS)[number];

export const EMERGENCY_SECTION_TITLE: Record<EmergencySection, string> = {
  location: "Where things are",
  step: "Boiler and steps",
  number: "Numbers",
};

export const EMERGENCY_LIMITS = { label: 80, detail: 300 } as const;

export const EmergencyItemSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  section: z.enum(EMERGENCY_SECTIONS),
  label: z.string().min(1).max(EMERGENCY_LIMITS.label),
  detail: z.string().min(1).max(EMERGENCY_LIMITS.detail),
  sort_order: z.number().int(),
  created_by: z.uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type EmergencyItem = z.infer<typeof EmergencyItemSchema>;

/** Form input. household_id and created_by are set server side from the session. */
export const EmergencyInputSchema = z.object({
  section: z.enum(EMERGENCY_SECTIONS),
  label: z.string().trim().min(1).max(EMERGENCY_LIMITS.label),
  detail: z.string().trim().min(1).max(EMERGENCY_LIMITS.detail),
});
export type EmergencyInput = z.infer<typeof EmergencyInputSchema>;

/**
 * A detail that reads as a phone number: optional leading +, then digits with spaces,
 * brackets or dashes, carrying 7 to 15 digits. Returns a tel: href, or null.
 */
export function phoneHref(detail: string): string | null {
  const t = detail.trim();
  if (!/^\+?[\d\s()-]+$/.test(t)) return null;
  const digits = t.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:${t.startsWith("+") ? "+" : ""}${digits}`;
}
