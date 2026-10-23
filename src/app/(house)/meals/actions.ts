"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { parseMealForm } from "@/contracts/meals";
import {
  MSG, addMissingToShopping, copyLastWeek, deleteMeal, parseId, parseKeys, parseWeek, saveMeal, type Result,
} from "@/server/data/meals";
import type { FormState } from "@/components/tasks/types";

function finish(r: Result): FormState {
  if (!r.ok) return { error: r.error };
  revalidatePath("/meals");
  revalidatePath("/meals/ingredients");
  revalidatePath("/shopping");
  revalidatePath("/calendar");
  revalidatePath("/");
  return { ok: true };
}

export async function saveMealAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const input = parseMealForm(fd);
  if (!input) return { error: MSG.invalid };
  const raw = fd.get("id");
  const id = raw ? parseId(fd) : undefined;
  if (raw && !id) return { error: MSG.invalid };
  return finish(await saveMeal(s, input, id ?? undefined));
}

export async function deleteMealAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  return id ? finish(await deleteMeal(s, id)) : { error: MSG.invalid };
}

export async function copyLastWeekAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const week = parseWeek(fd);
  return week ? finish(await copyLastWeek(s, week)) : { error: MSG.invalid };
}

export async function addMissingToShoppingAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const week = parseWeek(fd);
  return week ? finish(await addMissingToShopping(s, week, parseKeys(fd))) : { error: MSG.invalid };
}
