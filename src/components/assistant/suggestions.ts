import type { Task } from "@/contracts/tasks";
import type { Snag } from "@/contracts/snags";
import type { HouseholdRecord } from "@/contracts/records";
import { computeNeedsDoing, RENEWAL_WINDOW_DAYS, SNAG_STALE_DAYS } from "@/components/homey/needs-doing";

/** Deterministic, rule-based suggestions. No API, no key, no network. */
export type Suggestion = { id: string; text: string; href: string };

export { RENEWAL_WINDOW_DAYS, SNAG_STALE_DAYS };
export const MAX_SUGGESTIONS = 3;

/**
 * Thin wrapper over the "what needs doing" engine (computeNeedsDoing), kept for callers that only
 * have tasks, snags and records. Bins, maintenance and supplies are not part of this input.
 */
export function computeSuggestions(input: {
  tasks: Task[];
  snags: Snag[];
  records: HouseholdRecord[];
  /** ISO date (YYYY-MM-DD). */
  today: string;
}): Suggestion[] {
  return computeNeedsDoing({ ...input, bins: [], maintenance: [], supplies: [] })
    .slice(0, MAX_SUGGESTIONS)
    .map((i) => ({ id: i.key, text: i.text, href: i.href }));
}
