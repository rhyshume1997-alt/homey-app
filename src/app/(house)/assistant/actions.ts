"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { chatTurn } from "@/server/ai/chat";
import { defaultDeps } from "@/server/ai/usage";
import { confirmProposal, rejectProposal } from "@/server/ai/proposals";
import { ChatMessagesSchema } from "@/server/ai/schemas";
import { todayInLondon } from "@/server/data/dashboard";

export type SendState = { ok: true; reply: string; proposed: number } | { ok: false; error: string };
export type DecideState = { ok: boolean; message: string };

/** Messages come from the browser; they are re-validated here and are never trusted for identity. */
export async function sendMessageAction(messages: unknown): Promise<SendState> {
  const s = await requireSession();
  const parsed = ChatMessagesSchema.safeParse(messages);
  if (!parsed.success) return { ok: false, error: "Please enter a message of up to 2000 characters." };
  const r = await chatTurn(s, defaultDeps(s), parsed.data, todayInLondon());
  if (r.ok && r.proposed > 0) revalidatePath("/assistant");
  return r;
}

export async function confirmProposalAction(id: string): Promise<DecideState> {
  const s = await requireSession();
  const r = await confirmProposal(s, id);
  revalidatePath("/assistant");
  revalidatePath("/tasks");
  revalidatePath("/snags");
  revalidatePath("/");
  return r.ok ? { ok: true, message: r.data.message } : { ok: false, message: r.error };
}

export async function rejectProposalAction(id: string): Promise<DecideState> {
  const s = await requireSession();
  const r = await rejectProposal(s, id);
  revalidatePath("/assistant");
  return r.ok ? { ok: true, message: "Rejected." } : { ok: false, message: r.error };
}
