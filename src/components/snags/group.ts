import type { Snag } from "@/contracts/snags";
import { daysUntil, type Light } from "@/components/status";

/** An unfixed snag older than this many days is "Stale". */
export const STALE_SNAG_DAYS = 30;

/**
 * The one snag light, used by the snag list and the rooms pages. Snags have no due date:
 * fixed is green "Fixed"; unfixed and open more than STALE_SNAG_DAYS is amber "Stale";
 * any other unfixed snag is green "On track".
 */
export function snagLight(s: Pick<Snag, "status" | "created_at">, today: string): { light: Light; label: string } {
  if (s.status === "fixed") return { light: "green", label: "Fixed" };
  return daysUntil(today, s.created_at.slice(0, 10)) < -STALE_SNAG_DAYS
    ? { light: "amber", label: "Stale" }
    : { light: "green", label: "On track" };
}

export const STATUS_ORDER = ["open", "reported", "in_progress", "fixed"] as const;
export const STATUS_LABEL: Record<Snag["status"], string> = {
  open: "Open", reported: "Reported", in_progress: "In progress", fixed: "Fixed",
};
export const PRIORITY_LABEL: Record<Snag["priority"], string> = {
  high: "High priority", medium: "Medium priority", low: "Low priority",
};
const PRIORITY_RANK: Record<Snag["priority"], number> = { high: 0, medium: 1, low: 2 };

/** Groups by status in a fixed order; within a group high priority first, then oldest first. */
export function groupSnags(snags: readonly Snag[]): Record<Snag["status"], Snag[]> {
  const g: Record<Snag["status"], Snag[]> = { open: [], reported: [], in_progress: [], fixed: [] };
  for (const s of snags) g[s.status].push(s);
  for (const k of STATUS_ORDER) {
    g[k].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.created_at.localeCompare(b.created_at));
  }
  return g;
}
