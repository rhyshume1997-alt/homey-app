import type { HouseholdRecord } from "@/contracts/records";

export const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
export const formatGBP = (n: number) => GBP.format(n);

export const CATEGORY_LABEL: Record<HouseholdRecord["category"], string> = {
  property: "Property",
  purchase: "Purchase",
  property_document: "Property documents",
  mortgage: "Mortgage",
  mortgage_option: "Mortgage options",
  banking: "Banking",
  insurance: "Insurance",
  electricity: "Electricity",
  gas: "Gas",
  broadband: "Broadband",
  council_tax: "Council tax",
  water: "Water",
  factoring: "Factoring",
  solar: "Solar",
  maintenance: "Maintenance",
  energy_efficiency: "Energy efficiency",
  household_finance: "Household finance",
  contact: "Contacts",
  project: "Projects",
};

export const KIND_LABEL = {
  budget: "Budget",
  bill: "Bill",
  estimate: "Estimate",
  snapshot: "Snapshot",
  contract: "Contract",
  proposal: "Proposal",
} as const;

const DAY = 86_400_000;
/** Whole calendar days from `today` (YYYY-MM-DD) to `date` (YYYY-MM-DD). Negative when past. */
export function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
}

export function relativeDays(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "in 1 day";
  if (n === -1) return "1 day ago";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** The earliest of renewal_date and end_date, or null when neither is set. */
export function keyDate(r: Pick<HouseholdRecord, "renewal_date" | "end_date">): string | null {
  const ds = [r.renewal_date, r.end_date].filter((d): d is string => !!d).sort();
  return ds[0] ?? null;
}

/** Records with a deadline, earliest first. */
export function sortRenewals<T extends Pick<HouseholdRecord, "renewal_date" | "end_date" | "title">>(
  rows: readonly T[],
): (T & { date: string })[] {
  return rows
    .flatMap((r) => {
      const date = keyDate(r);
      return date ? [{ ...r, date }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** Money records only (unit GBP with an amount). */
export function expenseRecords(records: readonly HouseholdRecord[]): HouseholdRecord[] {
  return records.filter((r) => r.unit === "GBP" && r.amount !== null);
}
