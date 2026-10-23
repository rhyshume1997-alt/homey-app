"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { MSG, confirmRecordFigure, markRecordVerified, parseAmount, parseRecordId } from "@/server/data/records";
import type { FormState } from "@/components/tasks/types";

export async function markVerifiedAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseRecordId(fd);
  if (!id) return { error: MSG.invalid };
  const r = await markRecordVerified(s, id);
  if (!r.ok) return { error: r.error };
  revalidatePath("/money");
  revalidatePath("/");
  return { ok: true };
}

export async function confirmFigureAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseRecordId(fd);
  const amount = parseAmount(fd.get("amount"));
  if (!id || amount === null) return { error: "Enter the amount as a number, for example 42.17." };
  const r = await confirmRecordFigure(s, id, amount);
  if (!r.ok) return { error: r.error };
  revalidatePath("/money/check");
  revalidatePath("/money");
  revalidatePath("/");
  return { ok: true };
}
