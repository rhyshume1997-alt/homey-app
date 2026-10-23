import type { HouseholdRecord } from "@/contracts/records";

export interface EnergyData {
  tariffs: HouseholdRecord[];
  bills: HouseholdRecord[];
  usage: HouseholdRecord[];
  solar: HouseholdRecord[];
  efficiency: HouseholdRecord[];
}

const FUEL = new Set(["electricity", "gas"]);

/** Sorts imported records into sections. Pure: no figure is created or changed. */
export function groupEnergy(records: readonly HouseholdRecord[]): EnergyData {
  const out: EnergyData = { tariffs: [], bills: [], usage: [], solar: [], efficiency: [] };
  for (const r of records) {
    if (r.category === "solar") out.solar.push(r);
    else if (r.category === "energy_efficiency") out.efficiency.push(r);
    else if (!FUEL.has(r.category)) continue;
    else if (r.unit === "kWh" && r.amount !== null) out.usage.push(r);
    else if (r.amount_kind === "bill" && r.unit === "GBP" && r.amount !== null) out.bills.push(r);
    else out.tariffs.push(r);
  }
  const byEnd = (a: HouseholdRecord, b: HouseholdRecord) =>
    (b.end_date ?? b.as_of ?? "").localeCompare(a.end_date ?? a.as_of ?? "");
  out.bills.sort(byEnd);
  out.usage.sort(byEnd);
  out.tariffs.sort((a, b) => (a.end_date ?? a.renewal_date ?? "9").localeCompare(b.end_date ?? b.renewal_date ?? "9"));
  return out;
}

export const isEmpty = (d: EnergyData) => Object.values(d).every((a) => a.length === 0);

/** The date a deal ends or renews, if recorded. */
export const tariffDate = (r: Pick<HouseholdRecord, "renewal_date" | "end_date">) => r.end_date ?? r.renewal_date;

/** How a kWh figure was obtained, from its recorded kind. */
export function usageLabel(kind: HouseholdRecord["amount_kind"]): string {
  if (kind === "bill") return "From a bill";
  if (kind === "estimate") return "Estimate";
  if (kind === null) return "Source type not recorded";
  return "From an assessment";
}
