"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import {
  MSG, createTask, deleteTask, parseId, parseTaskForm, setTaskDone, updateTask, type Result,
} from "@/server/data/tasks";
import { nudgeAssignee } from "@/server/data/chores";
import type { FormState } from "@/components/tasks/types";

function finish(r: Result): FormState {
  if (!r.ok) return { error: r.error };
  revalidatePath("/tasks");
  revalidatePath("/");
  return { ok: true };
}

export async function createTaskAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const input = parseTaskForm(fd);
  if (!input) return { error: MSG.invalid };
  return finish(await createTask(s, input));
}

export async function updateTaskAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  const input = parseTaskForm(fd);
  if (!id || !input) return { error: MSG.invalid };
  return finish(await updateTask(s, id, input));
}

export async function completeTaskAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  if (!id) return { error: MSG.invalid };
  return finish(await setTaskDone(s, id, true));
}

export async function reopenTaskAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  if (!id) return { error: MSG.invalid };
  return finish(await setTaskDone(s, id, false));
}

export async function deleteTaskAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  if (!id) return { error: MSG.invalid };
  return finish(await deleteTask(s, id));
}

export async function nudgeAssigneeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd);
  if (!id) return { error: MSG.invalid };
  const r = await nudgeAssignee(s, id);
  return r.ok ? { ok: true } : { error: r.error };
}
