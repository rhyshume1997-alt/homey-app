import { z } from "zod";
import { MEAL_LIMITS, MEAL_SLOTS, isIsoDate } from "@/components/meals/types";

export { MEAL_LIMITS };

export const MealSlotSchema = z.enum(MEAL_SLOTS);
const IsoDate = z.string().refine(isIsoDate);

const optText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : (v ?? null)),
    z.string().trim().max(max).nullable(),
  );

export const IngredientInputSchema = z.object({
  name: z.string().trim().min(1).max(MEAL_LIMITS.name),
  quantity: optText(MEAL_LIMITS.quantity),
  unit_price_estimate: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? null : Number(v.trim().replace(/^£/, ""))) : (v ?? null)),
    z.number().finite().min(0).max(999999.99).nullable(),
  ),
  supply_id: z.preprocess((v) => (v === "" ? null : (v ?? null)), z.uuid().nullable()),
});
export type IngredientInput = z.infer<typeof IngredientInputSchema>;

/** Form input. household_id and created_by are set server side from the session. */
export const MealInputSchema = z.object({
  planned_on: IsoDate,
  slot: MealSlotSchema.default("dinner"),
  title: z.string().trim().min(1).max(MEAL_LIMITS.title),
  notes: optText(MEAL_LIMITS.notes),
  ingredients: z.array(IngredientInputSchema).max(MEAL_LIMITS.maxIngredients),
});
export type MealInput = z.infer<typeof MealInputSchema>;

export const MealRowSchema = z.object({
  id: z.uuid(),
  planned_on: IsoDate,
  slot: MealSlotSchema,
  title: z.string(),
  notes: z.string().nullable(),
});

export const IngredientRowSchema = z.object({
  id: z.uuid(),
  meal_id: z.uuid(),
  name: z.string(),
  quantity: z.string().nullable(),
  // numeric(8,2) can arrive as a number or a string depending on the driver.
  unit_price_estimate: z.preprocess((v) => (v === null || v === undefined ? null : Number(v)), z.number().nullable()),
  supply_id: z.uuid().nullable(),
});

/** Reads the aligned ing_* fields of the meal form. Blank-name rows are dropped. */
export function parseMealForm(fd: FormData): MealInput | null {
  const names = fd.getAll("ing_name").map(String);
  const qty = fd.getAll("ing_quantity").map(String);
  const price = fd.getAll("ing_price").map(String);
  const supply = fd.getAll("ing_supply").map(String);
  const ingredients = names
    .map((name, i) => ({ name, quantity: qty[i] ?? "", unit_price_estimate: price[i] ?? "", supply_id: supply[i] ?? "" }))
    .filter((r) => r.name.trim() !== "");
  const r = MealInputSchema.safeParse({
    planned_on: fd.get("planned_on"),
    slot: fd.get("slot") ?? "dinner",
    title: fd.get("title") ?? "",
    notes: fd.get("notes"),
    ingredients,
  });
  return r.success ? r.data : null;
}
