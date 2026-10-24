"use server";

import { revalidatePath } from "next/cache";
import { DATE_ORDERS, MONTH_STYLES, type DateOrder, type MonthStyle } from "@/components/dates";
import { requireSession } from "@/server/auth/session";
import { createUserClient } from "@/server/db/supabase";

export type SettingsState = { ok: boolean; message: string } | null;

/** Shows or hides the snag list for the caller only. Display preference; snags are never changed. */
export async function saveSnagsShownAction(_prev: SettingsState, fd: FormData): Promise<SettingsState> {
  await requireSession();
  const choice = fd.get("snags");
  if (choice !== "show" && choice !== "hide") return { ok: false, message: "Choose show or hide." };
  const supabase = await createUserClient();
  if (!supabase) return { ok: false, message: "Could not save right now." };
  const { error } = await supabase.auth.updateUser({ data: { snags_hidden: choice === "hide" } });
  if (error) return { ok: false, message: "Could not save right now." };
  revalidatePath("/", "layout");
  return { ok: true, message: choice === "hide" ? "Snag list hidden. Your snags are kept." : "Snag list shown." };
}

/** Saves the caller's own date display preference to their Supabase user_metadata. */
export async function saveDateFormatAction(_prev: SettingsState, fd: FormData): Promise<SettingsState> {
  await requireSession();
  const order = fd.get("date_order");
  const month = fd.get("date_month");
  if (!DATE_ORDERS.includes(order as DateOrder) || !MONTH_STYLES.includes(month as MonthStyle)) {
    return { ok: false, message: "Choose a date format from the list." };
  }
  const supabase = await createUserClient();
  if (!supabase) return { ok: false, message: "Could not save right now." };
  // Only display preferences go into metadata; nothing here is used for authorisation.
  const { error } = await supabase.auth.updateUser({ data: { date_order: order, date_month: month } });
  if (error) return { ok: false, message: "Could not save right now." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Date format saved." };
}
