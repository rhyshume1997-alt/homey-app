"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { createUserClient } from "@/server/db/supabase";
import type { SettingsState } from "./settings-actions";

const schema = z.enum(["dark", "light", "system"]);

/** Saves the caller's own theme preference to their Supabase user_metadata. */
export async function saveAppearanceAction(_prev: SettingsState, fd: FormData): Promise<SettingsState> {
  await requireSession();
  const parsed = schema.safeParse(fd.get("appearance"));
  if (!parsed.success) return { ok: false, message: "Choose Dark, Light or Match phone." };
  const supabase = await createUserClient();
  if (!supabase) return { ok: false, message: "Could not save right now." };
  const { error } = await supabase.auth.updateUser({ data: { appearance: parsed.data } });
  if (error) return { ok: false, message: "Could not save right now." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Appearance saved." };
}
