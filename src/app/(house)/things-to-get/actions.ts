"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import {
  MSG, addWishlistItem, parseId, parseStatus, parseWishlistForm, removeWishlistItem, setWishlistStatus,
  updateWishlistItem, type Result,
} from "@/server/data/wishlist";
import type { FormState } from "@/components/tasks/types";

function finish(r: Result): FormState {
  if (!r.ok) return { error: r.error };
  revalidatePath("/things-to-get");
  revalidatePath("/rooms", "layout");
  return { ok: true };
}

export async function addWishlistItemAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const input = parseWishlistForm(fd);
  return input ? finish(await addWishlistItem(s, input)) : { error: MSG.invalid };
}

export async function updateWishlistItemAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  const input = parseWishlistForm(fd);
  return id && input ? finish(await updateWishlistItem(s, id, input)) : { error: MSG.invalid };
}

export async function setWishlistStatusAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  const status = parseStatus(fd);
  return id && status ? finish(await setWishlistStatus(s, id, status)) : { error: MSG.invalid };
}

export async function removeWishlistItemAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  return id ? finish(await removeWishlistItem(s, id)) : { error: MSG.invalid };
}
