import { z } from "zod";
import { DEFAULT_HOMEY_PREFS, type HomeyPrefs } from "./types";

/**
 * Homey preferences live in the member's Supabase user_metadata, which the member can write
 * themselves. Treat it as untrusted: every field is checked and a bad value falls back to the
 * default. Nothing here is used for authorisation; it only changes how Homey is shown.
 */
export const HOMEY_META_KEYS = {
  hidden: "homey_hidden",
  tipsOff: "homey_tips_off",
  bubbles: "homey_bubbles",
  side: "homey_side",
} as const;

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

export function parseHomeyPrefs(meta: unknown): HomeyPrefs {
  const m = (meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {}) as Record<string, unknown>;
  const side = m[HOMEY_META_KEYS.side];
  return {
    hidden: bool(m[HOMEY_META_KEYS.hidden], DEFAULT_HOMEY_PREFS.hidden),
    tipsOff: bool(m[HOMEY_META_KEYS.tipsOff], DEFAULT_HOMEY_PREFS.tipsOff),
    bubbles: bool(m[HOMEY_META_KEYS.bubbles], DEFAULT_HOMEY_PREFS.bubbles),
    side: side === "left" || side === "right" ? side : DEFAULT_HOMEY_PREFS.side,
  };
}

/** A partial update from the browser: known keys only, at least one of them. */
export const homeyPrefsPatchSchema = z
  .strictObject({
    hidden: z.boolean(),
    tipsOff: z.boolean(),
    bubbles: z.boolean(),
    side: z.enum(["left", "right"]),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: "Nothing to save." });

export type HomeyPrefsPatch = z.infer<typeof homeyPrefsPatchSchema>;

export function mergeHomeyPrefs(current: HomeyPrefs, patch: HomeyPrefsPatch): HomeyPrefs {
  return {
    hidden: patch.hidden ?? current.hidden,
    tipsOff: patch.tipsOff ?? current.tipsOff,
    bubbles: patch.bubbles ?? current.bubbles,
    side: patch.side ?? current.side,
  };
}

/** The user_metadata shape written by saveHomeyPrefsAction. */
export function toHomeyMetadata(p: HomeyPrefs) {
  return {
    [HOMEY_META_KEYS.hidden]: p.hidden,
    [HOMEY_META_KEYS.tipsOff]: p.tipsOff,
    [HOMEY_META_KEYS.bubbles]: p.bubbles,
    [HOMEY_META_KEYS.side]: p.side,
  };
}
