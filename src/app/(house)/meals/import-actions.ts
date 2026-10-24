"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { previewFromText, previewFromUrl } from "@/server/integrations/recipes/import";
import { saveImportedRecipe } from "@/server/data/meal-import";
import { IMPORT_MSG, parseImportForm, type PreviewResult } from "@/contracts/recipe-import";
import type { FormState } from "@/components/tasks/types";

/** Fetches a link and returns a PREVIEW only. Nothing is saved. Rate limited per user. */
export async function importRecipePreview(url: string): Promise<PreviewResult> {
  const s = await requireSession();
  return previewFromUrl(url, s.userId);
}

/** The paste box: extracts ingredients from pasted text. Nothing is fetched or saved. */
export async function importRecipeFromText(text: string): Promise<PreviewResult> {
  await requireSession();
  return previewFromText(text);
}

/** Saves the ticked, edited ingredients to a chosen meal or a new one, in the session household. */
export async function saveImportedRecipeAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const input = parseImportForm(fd);
  if (input === "none") return { error: IMPORT_MSG.saveNone };
  if (!input) return { error: IMPORT_MSG.saveInvalid };
  const r = await saveImportedRecipe(s, input);
  if (!r.ok) return { error: r.error };
  revalidatePath("/meals");
  revalidatePath("/meals/ingredients");
  revalidatePath("/calendar");
  revalidatePath("/");
  return { ok: true };
}
