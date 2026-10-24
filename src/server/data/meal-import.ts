import "server-only";
import { createUserClient } from "@/server/db/supabase";
import type { HouseholdSession } from "@/server/auth/session";
import { MEAL_LIMITS, normaliseName } from "@/components/meals/types";
import { IMPORT_MSG, type SaveImportInput } from "@/contracts/recipe-import";
import { saveMeal, type Result } from "@/server/data/meals";

/**
 * Saves confirmed imported ingredients in the caller's household: either as a new meal, or
 * appended to an existing meal. Appending is retry safe: names already on the meal are skipped,
 * so a double submit adds nothing twice. The meal's 30-ingredient limit is enforced.
 */
export async function saveImportedRecipe(s: HouseholdSession, input: SaveImportInput): Promise<Result> {
  if (input.mode === "new") {
    const r = await saveMeal(s, {
      planned_on: input.planned_on,
      slot: input.slot,
      title: input.title,
      notes: input.notes,
      ingredients: dedupe(input.ingredients).map((i) => ({ ...i, unit_price_estimate: null, supply_id: null })),
    });
    return r.ok ? r : { ok: false, error: IMPORT_MSG.saveFailed };
  }

  const db = await createUserClient();
  if (!db) return { ok: false, error: IMPORT_MSG.saveFailed };
  const { data: meal, error: e1 } = await db
    .from("meals")
    .select("id")
    .eq("id", input.meal_id)
    .eq("household_id", s.householdId)
    .maybeSingle();
  if (e1) return { ok: false, error: IMPORT_MSG.saveFailed };
  if (!meal) return { ok: false, error: IMPORT_MSG.mealGone };
  const { data: existing, error: e2 } = await db
    .from("meal_ingredients")
    .select("name")
    .eq("meal_id", input.meal_id)
    .eq("household_id", s.householdId);
  if (e2) return { ok: false, error: IMPORT_MSG.saveFailed };
  const have = new Set((existing ?? []).map((r) => normaliseName(String(r.name))));
  const fresh = dedupe(input.ingredients).filter((i) => !have.has(normaliseName(i.name)));
  if (fresh.length === 0) return { ok: false, error: IMPORT_MSG.nothingNew };
  if (have.size + fresh.length > MEAL_LIMITS.maxIngredients) return { ok: false, error: IMPORT_MSG.tooMany(have.size) };
  const { error: e3 } = await db.from("meal_ingredients").insert(
    fresh.map((i) => ({
      household_id: s.householdId,
      meal_id: input.meal_id,
      name: i.name,
      quantity: i.quantity,
      unit_price_estimate: null,
      supply_id: null,
      created_by: s.userId,
    })),
  );
  return e3 ? { ok: false, error: IMPORT_MSG.saveFailed } : { ok: true, data: undefined };
}

function dedupe<T extends { name: string }>(list: readonly T[]): T[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = normaliseName(i.name);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
