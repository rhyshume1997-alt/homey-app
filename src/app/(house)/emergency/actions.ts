"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import {
  MSG, addEmergencyItem, parseEditForm, parseEmergencyForm, parseId, removeEmergencyItem, updateEmergencyItem, type Result,
} from "@/server/data/emergency";
import type { FormState } from "@/components/tasks/types";

function finish(r: Result): FormState {
  if (!r.ok) return { error: r.error };
  revalidatePath("/emergency");
  return { ok: true };
}

export async function addEmergencyItemAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const input = parseEmergencyForm(fd);
  return input ? finish(await addEmergencyItem(s, input)) : { error: MSG.invalid };
}

export async function updateEmergencyItemAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  const input = parseEditForm(fd);
  return id && input ? finish(await updateEmergencyItem(s, id, input)) : { error: MSG.invalid };
}

export async function removeEmergencyItemAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  return id ? finish(await removeEmergencyItem(s, id)) : { error: MSG.invalid };
}
