import "server-only";
import { z } from "zod";
import { HouseholdRecordSchema, type HouseholdRecord } from "@/contracts/records";
import { listRecords } from "@/server/data/records";
import { MORTGAGE_CATEGORIES, PROPERTY_CATEGORIES, deriveProviders, type ProviderGroup } from "@/components/house/model";

const ListSchema = z.array(HouseholdRecordSchema);

async function load(): Promise<HouseholdRecord[] | null> {
  const res = await listRecords();
  if (!res.ok) return null;
  const p = ListSchema.safeParse(res.data);
  return p.success ? p.data : null;
}

const inCategories = (cats: readonly string[]) => (r: HouseholdRecord) => cats.includes(r.category);

/** Each loader returns null when loading failed, so the UI never shows made-up values. */
export async function getPropertyRecords(): Promise<HouseholdRecord[] | null> {
  const all = await load();
  return all && all.filter(inCategories(PROPERTY_CATEGORIES));
}

export async function getMortgageRecords(): Promise<HouseholdRecord[] | null> {
  const all = await load();
  return all && all.filter(inCategories(MORTGAGE_CATEGORIES));
}

export async function getContactsData(): Promise<{ contacts: HouseholdRecord[]; providers: ProviderGroup[] } | null> {
  const all = await load();
  if (!all) return null;
  return { contacts: all.filter((r) => r.category === "contact"), providers: deriveProviders(all) };
}
