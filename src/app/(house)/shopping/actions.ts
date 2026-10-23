"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import {
  MSG, addLowSuppliesToShopping, addShoppingItem, addSupply, clearBought, parseDone, parseId, parseShoppingForm,
  parseSupplyForm, parseSupplyStatus, removeShoppingItem, removeSupply, setShoppingDone, setSupplyStatus, type Result,
} from "@/server/data/shopping";
import type { FormState } from "@/components/tasks/types";

function finish(r: Result): FormState {
  if (!r.ok) return { error: r.error };
  revalidatePath("/shopping");
  revalidatePath("/");
  return { ok: true };
}

export async function addShoppingItemAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const input = parseShoppingForm(fd);
  return input ? finish(await addShoppingItem(s, input)) : { error: MSG.invalid };
}

export async function toggleShoppingItemAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  const done = parseDone(fd);
  return id && done !== null ? finish(await setShoppingDone(s, id, done)) : { error: MSG.invalid };
}

export async function removeShoppingItemAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  return id ? finish(await removeShoppingItem(s, id)) : { error: MSG.invalid };
}

export async function clearBoughtAction(): Promise<FormState> {
  const s = await requireSession();
  return finish(await clearBought(s));
}

export async function addSupplyAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const input = parseSupplyForm(fd);
  return input ? finish(await addSupply(s, input)) : { error: MSG.invalid };
}

export async function setSupplyStatusAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  const status = parseSupplyStatus(fd);
  return id && status ? finish(await setSupplyStatus(s, id, status)) : { error: MSG.invalid };
}

export async function removeSupplyAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  return id ? finish(await removeSupply(s, id)) : { error: MSG.invalid };
}

export async function addLowToShoppingAction(): Promise<FormState> {
  const s = await requireSession();
  return finish(await addLowSuppliesToShopping(s));
}
