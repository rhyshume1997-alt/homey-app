"use server";

import { z } from "zod";
import { KudosMessageSchema, parseKudosKey } from "@/contracts/kudos";
import { requireSession } from "@/server/auth/session";
import { draftThanksFor, sendKudos } from "@/server/homey/kudos";

export type KudosActionResult = { ok: true; draft?: string } | { ok: false; message: string };
const BAD: KudosActionResult = { ok: false, message: "That is no longer available." };

/** The browser sends only the item key; the server rebuilds the draft. Nothing is stored or sent. */
export async function draftThanksAction(key: unknown): Promise<KudosActionResult> {
  const session = await requireSession();
  const id = parseKudosKey(key);
  if (id === null) return BAD;
  const r = await draftThanksFor(session, id);
  return r.ok ? { ok: true, draft: r.data.draft } : { ok: false, message: r.error };
}

/** Called only when the user taps Send on a reviewed draft. */
export async function sendThanksAction(key: unknown, message: unknown): Promise<KudosActionResult> {
  const session = await requireSession();
  const id = parseKudosKey(key);
  const msg = z.object({ m: KudosMessageSchema }).safeParse({ m: message });
  if (id === null || !msg.success) return { ok: false, message: "Write a short note, up to 200 characters." };
  const r = await sendKudos(session, id, msg.data.m);
  return r.ok ? { ok: true } : { ok: false, message: r.error };
}
