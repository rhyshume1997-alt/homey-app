"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { MSG, parseThreadId, setThreadStatus, syncNow, type Result } from "@/server/data/replies";
import type { FormState } from "@/components/tasks/types";

function finish(r: Result): FormState {
  if (!r.ok) return { error: r.error };
  revalidatePath("/replies");
  revalidatePath("/");
  return { ok: true };
}

export async function syncGmailAction(): Promise<FormState> {
  const s = await requireSession();
  const r = await syncNow(s);
  if (!r.ok) return { error: r.error };
  revalidatePath("/replies");
  revalidatePath("/");
  return { ok: true };
}

export async function closeThreadAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseThreadId(fd);
  if (!id) return { error: MSG.invalid };
  return finish(await setThreadStatus(s, id, "closed"));
}

export async function reopenThreadAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseThreadId(fd);
  if (!id) return { error: MSG.invalid };
  return finish(await setThreadStatus(s, id, "awaiting"));
}
