"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getAuthOnly } from "@/server/auth/session";
import { HOUSEHOLD_COOKIE, INVITE_COOKIE, cookieOptions, isInviteToken } from "@/server/auth/household-cookie";
import { acceptInvite, createHousehold, MSG } from "@/server/data/households";

export type OnboardingState = { ok: boolean; message: string } | null;

const SIGNED_OUT = "Please sign in again.";

async function enter(householdId: string) {
  (await cookies()).set(HOUSEHOLD_COOKIE, householdId, cookieOptions(60 * 60 * 24 * 365));
  revalidatePath("/", "layout");
}

/** Signed in is enough (no membership yet). The database decides whether this person may create one. */
export async function createHouseholdAction(_prev: OnboardingState, fd: FormData): Promise<OnboardingState> {
  if (!(await getAuthOnly())) return { ok: false, message: SIGNED_OUT };
  const r = await createHousehold({ name: fd.get("name"), displayName: fd.get("displayName") });
  if (!r.ok) return { ok: false, message: r.error };
  await enter(r.data.householdId);
  return { ok: true, message: "Household created." };
}

/** The token comes only from the short-lived httpOnly cookie, never from the form or URL. */
export async function acceptInviteAction(_prev: OnboardingState, fd: FormData): Promise<OnboardingState> {
  if (!(await getAuthOnly())) return { ok: false, message: SIGNED_OUT };
  const store = await cookies();
  const token = store.get(INVITE_COOKIE)?.value;
  if (!isInviteToken(token)) return { ok: false, message: MSG.inviteBad };
  const r = await acceptInvite({ token, displayName: fd.get("displayName") });
  if (!r.ok) return { ok: false, message: r.error };
  store.delete(INVITE_COOKIE);
  await enter(r.data.householdId);
  return { ok: true, message: "Welcome." };
}
