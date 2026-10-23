import type { HouseholdRecord } from "@/contracts/records";

export const PROPERTY_CATEGORIES = ["property", "purchase", "property_document"] as const;
export const MORTGAGE_CATEGORIES = ["mortgage", "mortgage_option", "banking"] as const;

export const isUnknownName = (s: string | null | undefined) => !s || s.trim() === "" || s.trim().toLowerCase() === "unknown";

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });
const KWH = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

/** Formats an amount with its unit. Null is "Unknown", never zero. */
export function formatAmount(r: Pick<HouseholdRecord, "amount" | "unit">): string {
  if (r.amount === null) return "Unknown";
  if (r.unit === "GBP") return GBP.format(r.amount);
  if (r.unit === "kWh") return `${KWH.format(r.amount)} kWh`;
  return String(r.amount);
}

export type MortgageSections = {
  terms: HouseholdRecord[];
  payments: HouseholdRecord[];
  snapshots: HouseholdRecord[];
  options: HouseholdRecord[];
  notes: HouseholdRecord[];
};

/** Sorts mortgage-area records into labelled sections. A snapshot is never treated as live. */
export function splitMortgage(rows: readonly HouseholdRecord[]): MortgageSections {
  const out: MortgageSections = { terms: [], payments: [], snapshots: [], options: [], notes: [] };
  for (const r of rows) {
    if (r.amount_kind === "snapshot") out.snapshots.push(r);
    else if (r.category === "mortgage_option" || r.amount_kind === "proposal") out.options.push(r);
    else if (r.amount_kind === "contract") out.terms.push(r);
    else if (r.amount !== null && /month/i.test(r.frequency ?? "")) out.payments.push(r);
    else out.notes.push(r);
  }
  const byTitle = (a: HouseholdRecord, b: HouseholdRecord) => a.title.localeCompare(b.title);
  out.snapshots.sort((a, b) => (b.as_of ?? "").localeCompare(a.as_of ?? "") || byTitle(a, b));
  for (const k of ["terms", "payments", "options", "notes"] as const) out[k].sort(byTitle);
  return out;
}

/** The fixed-rate end date: earliest end/renewal date on a mortgage record, if any. */
export function fixedRateEnd(rows: readonly HouseholdRecord[]): { record: HouseholdRecord; date: string } | null {
  const withDate = rows
    .filter((r) => r.category === "mortgage")
    .flatMap((r) => {
      const date = r.end_date ?? r.renewal_date;
      return date ? [{ record: r, date }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return withDate[0] ?? null;
}

export type ProviderGroup = { provider: string; categories: HouseholdRecord["category"][]; count: number };

/** Providers across non-contact records, grouped case-insensitively; unknown names excluded. */
export function deriveProviders(rows: readonly HouseholdRecord[]): ProviderGroup[] {
  const map = new Map<string, { provider: string; cats: Set<HouseholdRecord["category"]>; count: number }>();
  for (const r of rows) {
    if (r.category === "contact" || isUnknownName(r.provider)) continue;
    const name = r.provider!.trim();
    const g = map.get(name.toLowerCase()) ?? { provider: name, cats: new Set(), count: 0 };
    g.cats.add(r.category);
    g.count += 1;
    map.set(name.toLowerCase(), g);
  }
  return [...map.values()]
    .map((g) => ({ provider: g.provider, categories: [...g.cats].sort(), count: g.count }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}
