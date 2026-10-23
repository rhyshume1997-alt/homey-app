"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { MSG, createEvent, parseEventForm } from "@/server/data/household-events";
import type { FormState } from "@/components/tasks/types";

export async function addEventAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const input = parseEventForm(fd);
  if (!input) return { error: MSG.invalid };
  const r = await createEvent(s, input);
  if (!r.ok) return { error: r.error };
  revalidatePath("/calendar");
  return { ok: true };
}
