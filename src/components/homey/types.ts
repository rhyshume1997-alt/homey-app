/** Shared Homey contracts (D18). Builders implement against these; do not change shapes without the orchestrator. */
import type { DueKind, Light } from "@/components/status";

export type Expression = "smiley" | "happy" | "excited" | "surprised" | "concerned" | "shocked" | "sleepy";

/** Face for the most urgent state: red shocked, amber concerned, all green happy. */
export function expressionFor(worst: Light): Expression {
  return worst === "red" ? "shocked" : worst === "amber" ? "concerned" : "happy";
}

export type NeedBucket = "overdue" | "today" | "soon" | "check" | "activity";

/** One-tap action. The browser only ever sends the item key; the server rebuilds everything. */
export type NeedAction =
  | { type: "open"; href: string; label: string }
  | { type: "propose_task"; label: string }
  | { type: "propose_shopping"; label: string }
  | { type: "draft_thanks"; label: string };

export type NeedItem = {
  /** Stable, unique, e.g. "task:<uuid>", "renewal:<uuid>", "bins:2026-10-23", "figures", "kudos:<audit id>". */
  key: string;
  bucket: NeedBucket;
  kind: DueKind | "figures" | "snags" | "supplies" | "activity";
  light: Light;
  /** Short, plain text. Never amounts, references or email content. */
  text: string;
  date?: string;
  href: string;
  action?: NeedAction;
};

/** Homey's AI-written summary (cached per member per day). */
export type HomeyDigest = {
  summary: string;
  top: { key: string; why: string }[];
  createdAt: string;
  stale: boolean;
};

/** Per-member Homey preferences, stored in Supabase user_metadata (validated on every read). */
export type HomeyPrefs = { hidden: boolean; tipsOff: boolean; bubbles: boolean; side: "left" | "right" };
export const DEFAULT_HOMEY_PREFS: HomeyPrefs = { hidden: false, tipsOff: false, bubbles: true, side: "left" };
