"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { MSG, createTaskFromChecklist, markChecklistDone, parseId, type Result } from "@/server/data/checklist";
import type { FormState } from "@/components/tasks/types";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

function finish(r: Result, paths: string[]): FormState {
  if (!r.ok) return { error: r.error };
  for (const p of paths) revalidatePath(p);
  return { ok: true };
}

export async function markChecklistDoneAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  return id ? finish(await markChecklistDone(s, id, today()), ["/checklist", "/"]) : { error: MSG.invalid };
}

/** Only reachable from the dialog's Confirm button; the page never creates tasks on its own. */
export async function addChecklistTaskAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  return id ? finish(await createTaskFromChecklist(s, id, today()), ["/tasks", "/"]) : { error: MSG.invalid };
}
