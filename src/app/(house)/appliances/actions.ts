"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/session";
import {
  MSG, createAppliance, createServiceTask, deleteAppliance, parseApplianceForm, parseApplianceId, updateAppliance,
} from "@/server/data/appliances";
import type { FormState } from "@/components/tasks/types";

export async function createApplianceAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const input = parseApplianceForm(fd);
  if (!input) return { error: MSG.invalid };
  const r = await createAppliance(s, input);
  if (!r.ok) return { error: r.error };
  revalidatePath("/appliances");
  redirect(`/appliances/${r.data.id}`);
}

export async function updateApplianceAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseApplianceId(fd.get("id"));
  const input = parseApplianceForm(fd);
  if (!id || !input) return { error: MSG.invalid };
  const r = await updateAppliance(s, id, input);
  if (!r.ok) return { error: r.error };
  revalidatePath("/appliances");
  revalidatePath(`/appliances/${id}`);
  return { ok: true };
}

export async function deleteApplianceAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseApplianceId(fd.get("id"));
  if (!id) return { error: MSG.invalid };
  const r = await deleteAppliance(s, id);
  if (!r.ok) return { error: r.error };
  revalidatePath("/appliances");
  redirect("/appliances");
}

/** Only called from the confirm step of "+ Service task". */
export async function createServiceTaskAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseApplianceId(fd.get("id"));
  const due = fd.get("due_date");
  if (!id) return { error: MSG.invalid };
  const r = await createServiceTask(s, id, typeof due === "string" && due.trim() !== "" ? due.trim() : null);
  if (!r.ok) return { error: r.error };
  revalidatePath("/tasks");
  revalidatePath("/");
  return { ok: true };
}
