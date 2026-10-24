import { z } from "zod";
import { MEAL_LIMITS, MEAL_SLOTS, isIsoDate } from "@/components/meals/types";

/** "Add from a link": a preview is shown, ticked and edited; nothing is saved until confirmed. */

export const RECIPE_SOURCES = ["website", "tiktok", "instagram", "text"] as const;
export type RecipeSource = (typeof RECIPE_SOURCES)[number];

export type ImportedIngredient = { name: string; quantity: string | null };

export type RecipePreview = {
  title: string;
  ingredients: ImportedIngredient[];
  source: RecipeSource;
  /** More ingredients were found than one meal can hold; only the first ones are shown. */
  truncated?: boolean;
};

/** Failures always offer the paste box. Messages are fixed text; never page content or the URL. */
export type PreviewResult = { ok: true; preview: RecipePreview } | { ok: false; error: string; source?: RecipeSource };

export const IMPORT_LIMITS = { url: 2_048, text: 20_000 } as const;

export const IMPORT_MSG = {
  invalidUrl: "That doesn't look like a web link. Paste a link starting with https://.",
  blocked: "That link can't be fetched. Only public https web pages can be used.",
  rate: "Too many links in a short time. Please wait a few minutes and try again.",
  fetchFailed: "Couldn't load that page. You can paste the recipe text below instead.",
  noRecipe: "Couldn't find a list of ingredients on that page. You can paste the recipe text below instead.",
  tiktokNone: "The TikTok caption doesn't list any ingredients. If they're in the video or comments, paste them below.",
  tiktokFailed: "TikTok didn't share that video's caption. You can paste the caption below instead.",
  instagram:
    "Instagram doesn't share post captions with apps like this one. Open the post, copy the caption, and paste it below.",
  textEmpty: "Paste some recipe text first.",
  textNone: "Couldn't spot any ingredients in that text. Try putting each ingredient on its own line.",
  saveInvalid: "Please check the details and try again.",
  saveNone: "Tick at least one ingredient to add.",
  saveFailed: "Something went wrong. Please try again.",
  mealGone: "That meal is no longer on the planner. Choose another or add a new meal.",
  tooMany: (has: number) =>
    `That meal already has ${has} ingredients and can hold ${MEAL_LIMITS.maxIngredients}. Untick some or add as a new meal.`,
  nothingNew: "Those ingredients are already on that meal.",
} as const;

const ImportedIngredientSchema = z.object({
  name: z.string().trim().min(1).max(MEAL_LIMITS.name),
  quantity: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : (v ?? null)),
    z.string().trim().max(MEAL_LIMITS.quantity).nullable(),
  ),
});

const SaveSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("existing"),
    meal_id: z.uuid(),
    ingredients: z.array(ImportedIngredientSchema).min(1).max(MEAL_LIMITS.maxIngredients),
  }),
  z.object({
    mode: z.literal("new"),
    planned_on: z.string().refine(isIsoDate),
    slot: z.enum(MEAL_SLOTS),
    title: z.string().trim().min(1).max(MEAL_LIMITS.title),
    notes: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : (v ?? null)),
      z.string().trim().max(MEAL_LIMITS.notes).nullable(),
    ),
    ingredients: z.array(ImportedIngredientSchema).min(1).max(MEAL_LIMITS.maxIngredients),
  }),
]);
export type SaveImportInput = z.infer<typeof SaveSchema>;

/**
 * Reads the confirm form. Only ticked rows are posted (unticked rows are disabled inputs), as
 * aligned imp_name / imp_quantity lists. Null when anything is invalid, "none" when nothing is ticked.
 */
export function parseImportForm(fd: FormData): SaveImportInput | "none" | null {
  const names = fd.getAll("imp_name").map(String);
  const qty = fd.getAll("imp_quantity").map(String);
  if (names.length !== qty.length) return null;
  const ingredients = names
    .map((name, i) => ({ name, quantity: qty[i] }))
    .filter((r) => r.name.trim() !== "");
  if (ingredients.length === 0) return "none";
  const mode = fd.get("mode");
  const r = SaveSchema.safeParse(
    mode === "existing"
      ? { mode, meal_id: fd.get("meal_id"), ingredients }
      : { mode, planned_on: fd.get("planned_on"), slot: fd.get("slot") ?? "dinner", title: fd.get("title") ?? "", notes: fd.get("notes"), ingredients },
  );
  return r.success ? r.data : null;
}
