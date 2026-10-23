"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import {
  MSG, createSnag, deleteSnag, parseId, parseSnagForm, parseStatus, setSnagStatus, updateSnag, type Result,
} from "@/server/data/snags";
import type { FormState } from "@/components/tasks/types";

function finish(r: Result): FormState {
  if (!r.ok) return { error: r.error };
  revalidatePath("/snags");
  revalidatePath("/");
  return { ok: true };
}

export async function createSnagAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const input = parseSnagForm(fd);
  if (!input) return { error: MSG.invalid };
  return finish(await createSnag(s, input));
}

export async function updateSnagAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  const input = parseSnagForm(fd);
  if (!id || !input) return { error: MSG.invalid };
  return finish(await updateSnag(s, id, input));
}

export async function setSnagStatusAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  const status = parseStatus(fd);
  if (!id || !status) return { error: MSG.invalid };
  return finish(await setSnagStatus(s, id, status));
}

export async function deleteSnagAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  if (!id) return { error: MSG.invalid };
  return finish(await deleteSnag(s, id));
}
