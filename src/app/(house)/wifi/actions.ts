"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { MSG, parseId, parseWifiForm, removeWifi, revealPassword, saveWifi, type Result } from "@/server/data/wifi";
import type { FormState } from "@/components/tasks/types";
import type { RevealResult } from "@/contracts/wifi";

function finish(r: Result): FormState {
  if (!r.ok) return { error: r.error };
  revalidatePath("/wifi");
  return { ok: true };
}

/** Members only (requireSession). Returns the decrypted password to the caller, rate limited. */
export async function revealWifiPasswordAction(id: string): Promise<RevealResult> {
  const s = await requireSession();
  const nid = parseId(id);
  return nid ? revealPassword(s, nid) : { ok: false, error: MSG.invalid };
}

export async function saveWifiAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const input = parseWifiForm(fd);
  const raw = fd.get("id");
  const id = raw ? parseId(raw) : null;
  if (!input || (raw && !id)) return { error: MSG.invalid };
  return finish(await saveWifi(s, id, input));
}

export async function removeWifiAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseId(fd.get("id"));
  return id ? finish(await removeWifi(s, id)) : { error: MSG.invalid };
}
