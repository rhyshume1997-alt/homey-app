"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { MSG, addReading, parseReadingForm, parseReadingId, removeReading, type Result } from "@/server/data/meter-readings";
import type { FormState } from "@/components/tasks/types";

function finish(r: Result): FormState {
  if (!r.ok) return { error: r.error };
  revalidatePath("/energy");
  return { ok: true };
}

export async function addReadingAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const input = parseReadingForm(fd);
  return input ? finish(await addReading(s, input)) : { error: MSG.invalid };
}

export async function removeReadingAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseReadingId(fd);
  return id ? finish(await removeReading(s, id)) : { error: MSG.invalid };
}
