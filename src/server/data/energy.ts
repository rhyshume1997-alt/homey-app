import "server-only";
import { createUserClient } from "@/server/db/supabase";
import { scopedDb } from "@/server/db/scoped";
import { parseRecords, MSG, type Result } from "@/server/data/records";
import { groupEnergy, type EnergyData } from "@/components/energy/group";

/** Energy and solar records, as imported. Nothing is measured or derived here. */
export async function getEnergy(): Promise<Result<EnergyData>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: MSG.load };
  const { db, householdId } = sc;
  const { data, error } = await db
    .from("household_records")
    .select("*").eq("household_id", householdId)
    .in("category", ["electricity", "gas", "solar", "energy_efficiency"])
    .limit(500);
  if (error || !data) return { ok: false, error: MSG.load };
  return { ok: true, data: groupEnergy(parseRecords(data)) };
}
