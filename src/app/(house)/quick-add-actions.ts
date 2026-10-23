"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { logHouseholdEvent } from "@/server/data/events";
import { createTaskAction } from "./tasks/actions";
import { createSnagAction } from "./snags/actions";
import type { FormState } from "@/components/tasks/types";

function refresh() {
  revalidatePath("/");
  revalidatePath("/activity");
}

export async function logEventAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const r = await logHouseholdEvent(s, fd.get("slug"), fd.get("note"));
  if (!r.ok) return { error: r.error };
  refresh();
  return { ok: true };
}

export async function quickAddTaskAction(prev: FormState, fd: FormData): Promise<FormState> {
  const r = await createTaskAction(prev, fd);
  if (r?.ok) refresh();
  return r;
}

export async function quickAddSnagAction(prev: FormState, fd: FormData): Promise<FormState> {
  const r = await createSnagAction(prev, fd);
  if (r?.ok) refresh();
  return r;
}
