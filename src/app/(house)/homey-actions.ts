"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { createUserClient } from "@/server/db/supabase";
import { homeyPrefsPatchSchema, mergeHomeyPrefs, parseHomeyPrefs, toHomeyMetadata } from "@/components/homey/prefs";
import type { HomeyPrefs } from "@/components/homey/types";

export type HomeyPrefsResult = { ok: true; prefs: HomeyPrefs } | { ok: false; message: string };

/**
 * Saves the caller's own Homey display preferences (partial update, merged with what is
 * stored) to their Supabase user_metadata. Display only: nothing here is used for authorisation.
 */
export async function saveHomeyPrefsAction(patch: unknown): Promise<HomeyPrefsResult> {
  await requireSession();
  const parsed = homeyPrefsPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, message: "Could not save that setting." };
  const supabase = await createUserClient();
  if (!supabase) return { ok: false, message: "Could not save right now." };
  const { data, error: readError } = await supabase.auth.getUser();
  if (readError || !data.user) return { ok: false, message: "Could not save right now." };
  const prefs = mergeHomeyPrefs(parseHomeyPrefs(data.user.user_metadata), parsed.data);
  const { error } = await supabase.auth.updateUser({ data: toHomeyMetadata(prefs) });
  if (error) return { ok: false, message: "Could not save right now." };
  revalidatePath("/", "layout");
  return { ok: true, prefs };
}
