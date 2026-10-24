"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import {
  MSG, addSchedule, editSchedule, parseCouncilForm, parseId, parseScheduleForm, removeSchedule, saveCouncilUrl, type Result,
} from "@/server/data/bins";
import type { FormState } from "@/components/tasks/types";

function finish(r: Result): FormState {
  if (!r.ok) return { error: r.error };
  revalidatePath("/bins");
  revalidatePath("/");
  return { ok: true };
}

export async function saveCouncilUrlAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const v = parseCouncilForm(fd);
  return v ? finish(await saveCouncilUrl(s, v.url)) : { error: MSG.invalidUrl };
}

export async function saveScheduleAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const input = parseScheduleForm(fd);
  const raw = fd.get("id");
  const id = raw ? parseId(raw) : null;
  if (!input || (raw && !id)) return { error: MSG.invalid };
  return finish(id ? await editSchedule(s, id, input) : await addSchedule(s, input));
}

export async function removeScheduleAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd.get("id"));
  return id ? finish(await removeSchedule(s, id)) : { error: MSG.invalid };
}
