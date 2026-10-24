import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import { scopedDb } from "@/server/db/scoped";
import type { HouseholdSession } from "@/server/auth/session";
import { IngredientRowSchema, MealRowSchema, type MealInput } from "@/contracts/meals";
import {
  addDays, aggregateNeeded, isIsoDate, isMissing, mondayOf, normaliseName,
  type Meal, type MealWithIngredients, type NeededItem, type SupplyRef,
} from "@/components/meals/types";
import { listShopping, listSupplies, type Result } from "@/server/data/shopping";

export type { Result };

export const MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load this right now.",
  nothingToCopy: "Last week has no meals to copy.",
} as const;

export function parseId(fd: FormData): string | null {
  const r = z.uuid().safeParse(fd.get("id"));
  return r.success ? r.data : null;
}
export function parseWeek(fd: FormData): string | null {
  const v = fd.get("week");
  return isIsoDate(v) ? mondayOf(v) : null;
}
/** The normalised ingredient keys the person confirmed in the dialog. */
export function parseKeys(fd: FormData): string[] {
  return fd.getAll("key").map(String).map(normaliseName).filter(Boolean).slice(0, 200);
}

type Db = NonNullable<Awaited<ReturnType<typeof createUserClient>>>;

const MEAL_COLS = "id,planned_on,slot,title,notes";
const ING_COLS = "id,meal_id,name,quantity,unit_price_estimate,supply_id";

/** Meals (no ingredients) between two YYYY-MM-DD dates, inclusive. For the calendar. */
export async function listMealsForRange(from: string, to: string): Promise<Result<Meal[]>> {
  if (!isIsoDate(from) || !isIsoDate(to)) return { ok: false, error: MSG.invalid };
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: MSG.load };
  const { db, householdId } = sc;
  const { data, error } = await db
    .from("meals")
    .select(MEAL_COLS).eq("household_id", householdId)
    .gte("planned_on", from)
    .lte("planned_on", to)
    .order("planned_on", { ascending: true })
    .order("slot", { ascending: true });
  const parsed = z.array(MealRowSchema).safeParse(data);
  return error || !parsed.success ? { ok: false, error: MSG.load } : { ok: true, data: parsed.data };
}

async function mealsWithIngredients(db: Db, householdId: string, from: string, to: string): Promise<Result<MealWithIngredients[]>> {
  const { data, error } = await db
    .from("meals")
    .select(`${MEAL_COLS}, meal_ingredients(${ING_COLS})`)
    .eq("household_id", householdId)
    .gte("planned_on", from)
    .lte("planned_on", to)
    .order("planned_on", { ascending: true })
    .order("slot", { ascending: true });
  const parsed = z.array(MealRowSchema.extend({ meal_ingredients: z.array(IngredientRowSchema) })).safeParse(data);
  if (error || !parsed.success) return { ok: false, error: MSG.load };
  return {
    ok: true,
    data: parsed.data.map(({ meal_ingredients, ...m }) => ({
      ...m,
      ingredients: [...meal_ingredients].sort((a, b) => a.name.localeCompare(b.name)),
    })),
  };
}

/** Monday to Sunday of the week starting `monday`, with ingredients. */
export async function listWeek(monday: string): Promise<Result<MealWithIngredients[]>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: MSG.load };
  return mealsWithIngredients(sc.db, sc.householdId, monday, addDays(monday, 6));
}

export type NeededData = { items: NeededItem[]; supplies: SupplyRef[] };

/** The week's ingredients checked against what people entered on the supplies list. */
export async function getIngredientsNeeded(monday: string): Promise<Result<NeededData>> {
  const [week, sup] = await Promise.all([listWeek(monday), listSupplies()]);
  if (!week.ok || !sup.ok) return { ok: false, error: MSG.load };
  const supplies = sup.data.map((s) => ({ id: s.id, name: s.name, status: s.status }));
  return { ok: true, data: { items: aggregateNeeded(week.data, supplies), supplies } };
}

export async function listSupplyRefs(): Promise<Result<SupplyRef[]>> {
  const sup = await listSupplies();
  return sup.ok ? { ok: true, data: sup.data.map((s) => ({ id: s.id, name: s.name, status: s.status })) } : { ok: false, error: MSG.load };
}

const ingredientRows = (s: HouseholdSession, mealId: string, list: MealInput["ingredients"]) =>
  list.map((i) => ({
    household_id: s.householdId,
    meal_id: mealId,
    name: i.name,
    quantity: i.quantity,
    unit_price_estimate: i.unit_price_estimate,
    supply_id: i.supply_id,
    created_by: s.userId,
  }));

/** Creates a meal (no id) or updates one in the caller's household, replacing its ingredients. */
export async function saveMeal(s: HouseholdSession, input: MealInput, id?: string): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const fields = { planned_on: input.planned_on, slot: input.slot, title: input.title, notes: input.notes };
  let mealId = id;
  if (mealId) {
    const { data, error } = await db.from("meals").update(fields).eq("id", mealId).eq("household_id", s.householdId).select("id");
    if (error || !data?.length) return { ok: false, error: MSG.failed };
  } else {
    const { data, error } = await db
      .from("meals")
      .insert({ ...fields, household_id: s.householdId, created_by: s.userId })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: MSG.failed };
    mealId = data.id as string;
  }
  // Insert the new ingredients first and only then remove the old ones, so a failure loses nothing.
  const { data: old } = await db.from("meal_ingredients").select("id").eq("meal_id", mealId).eq("household_id", s.householdId);
  if (input.ingredients.length) {
    const { error } = await db.from("meal_ingredients").insert(ingredientRows(s, mealId, input.ingredients));
    if (error) return { ok: false, error: MSG.failed };
  }
  const oldIds = (old ?? []).map((r) => r.id as string);
  if (oldIds.length) {
    const { error } = await db.from("meal_ingredients").delete().in("id", oldIds).eq("household_id", s.householdId);
    if (error) return { ok: false, error: MSG.failed };
  }
  return { ok: true, data: undefined };
}

export async function deleteMeal(s: HouseholdSession, id: string): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await db.from("meals").delete().eq("id", id).eq("household_id", s.householdId);
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

/** Copies the previous week's meals and ingredients forward seven days. Slots already filled are kept as they are. */
export async function copyLastWeek(s: HouseholdSession, monday: string): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const prevStart = addDays(monday, -7);
  const [prev, cur] = await Promise.all([
    mealsWithIngredients(db, s.householdId, prevStart, addDays(prevStart, 6)),
    mealsWithIngredients(db, s.householdId, monday, addDays(monday, 6)),
  ]);
  if (!prev.ok || !cur.ok) return { ok: false, error: MSG.failed };
  if (prev.data.length === 0) return { ok: false, error: MSG.nothingToCopy };
  const taken = new Set(cur.data.map((m) => `${m.planned_on}|${m.slot}`));
  for (const m of prev.data) {
    const planned_on = addDays(m.planned_on, 7);
    if (taken.has(`${planned_on}|${m.slot}`)) continue;
    const { data, error } = await db
      .from("meals")
      .insert({ planned_on, slot: m.slot, title: m.title, notes: m.notes, household_id: s.householdId, created_by: s.userId })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: MSG.failed };
    if (m.ingredients.length) {
      const { error: e2 } = await db.from("meal_ingredients").insert(
        ingredientRows(s, data.id as string, m.ingredients.map((i) => ({
          name: i.name, quantity: i.quantity, unit_price_estimate: i.unit_price_estimate, supply_id: i.supply_id,
        }))),
      );
      if (e2) return { ok: false, error: MSG.failed };
    }
    taken.add(`${planned_on}|${m.slot}`);
  }
  return { ok: true, data: undefined };
}

/**
 * Adds the confirmed missing ingredients to the shopping list. The server recomputes what is
 * missing from the stored data and only adds confirmed keys that are still missing, skipping any
 * already on the open list. Nothing is bought or sent.
 */
export async function addMissingToShopping(s: HouseholdSession, monday: string, keys: string[]): Promise<Result> {
  const [needed, items] = await Promise.all([getIngredientsNeeded(monday), listShopping()]);
  if (!needed.ok || !items.ok) return { ok: false, error: MSG.failed };
  const confirmed = new Set(keys);
  const open = new Set(items.data.filter((i) => !i.done).map((i) => normaliseName(i.title)));
  const toAdd = needed.data.items.filter((i) => isMissing(i) && confirmed.has(i.key) && !open.has(i.key));
  if (toAdd.length === 0) return { ok: true, data: undefined };
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await db.from("shopping_items").insert(
    toAdd.map((i) => ({
      title: i.name.slice(0, 120),
      quantity: i.quantity ? i.quantity.slice(0, 40) : null,
      household_id: s.householdId,
      created_by: s.userId,
    })),
  );
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}
