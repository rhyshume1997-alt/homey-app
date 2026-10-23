import type { ChecklistItem } from "@/contracts/checklist";
import type { FormAction } from "@/components/tasks/types";
import { formatDate, type DatePrefs } from "@/components/dates";
import { LIGHT_ORDER, trafficLight } from "@/components/status";

export type { ChecklistItem };

export type ChecklistActions = { markDone: FormAction; addTask: FormAction };

export const SEASON_ORDER = ["autumn", "winter", "spring", "summer", "any"] as const;
export const SEASON_LABEL: Record<(typeof SEASON_ORDER)[number], string> = {
  autumn: "Autumn",
  winter: "Winter",
  spring: "Spring",
  summer: "Summer",
  any: "All year",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Plain-words schedule: "Every October", "Monthly", "Yearly". */
export function scheduleLabel(i: Pick<ChecklistItem, "frequency" | "month">): string {
  if (i.frequency === "monthly") return "Monthly";
  return i.month ? `Every ${MONTHS[i.month - 1]}` : "Yearly";
}

export function isCoveredByTask(i: Pick<ChecklistItem, "notes">): boolean {
  return /^covered by task/i.test(i.notes ?? "");
}

/** Groups by season (fixed order), most urgent first inside a group, then by title. */
export function groupBySeason(items: readonly ChecklistItem[], today: string) {
  return SEASON_ORDER.map((season) => ({
    season,
    label: SEASON_LABEL[season],
    items: items
      .filter((i) => i.season === season)
      .sort(
        (a, b) =>
          LIGHT_ORDER[trafficLight("checklist", a.next_due_on, today)] -
            LIGHT_ORDER[trafficLight("checklist", b.next_due_on, today)] ||
          (a.next_due_on ?? "9999").localeCompare(b.next_due_on ?? "9999") ||
          a.title.localeCompare(b.title),
      ),
  })).filter((g) => g.items.length > 0);
}

/** "Add 'Bleed radiators' to Tasks, due 1 Oct?" */
export function confirmText(i: Pick<ChecklistItem, "title" | "next_due_on">, today: string, prefs?: DatePrefs): string {
  const due = i.next_due_on ?? today;
  return `Add '${i.title}' to Tasks, due ${formatDate(due, prefs)}?`;
}
