"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import {
  MSG, addSuggestion, createItem, deleteItem, logDone, parseDoneForm, parseId, parseMaintenanceForm,
  parseSuggestionIndex, updateItem, type Result,
} from "@/server/data/maintenance";
import type { FormState } from "@/components/tasks/types";

function finish(r: Result): FormState {
  if (!r.ok) return { error: r.error };
  revalidatePath("/maintenance");
  revalidatePath("/");
  return { ok: true };
}

export async function createItemAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const input = parseMaintenanceForm(fd);
  if (!input) return { error: MSG.invalid };
  return finish(await createItem(s, input));
}

export async function updateItemAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  const input = parseMaintenanceForm(fd);
  if (!id || !input) return { error: MSG.invalid };
  return finish(await updateItem(s, id, input));
}

export async function deleteItemAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  if (!id) return { error: MSG.invalid };
  return finish(await deleteItem(s, id));
}

export async function markDoneAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  const input = parseDoneForm(fd);
  if (!id || !input) return { error: MSG.invalid };
  return finish(await logDone(s, id, input));
}

export async function addSuggestionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const index = parseSuggestionIndex(fd);
  if (index === null) return { error: MSG.invalid };
  return finish(await addSuggestion(s, index));
}
