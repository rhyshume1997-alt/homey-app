"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { HOUSEHOLD_COOKIE, cookieOptions } from "@/server/auth/household-cookie";
import { createInvite, leaveHousehold, removeMember, revokeInvite } from "@/server/data/households";

export type HouseholdActionState = { ok: boolean; message: string; token?: string } | null;

const FOREIGN = "You aren't a member of that household.";

/**
 * Switches the household this browser shows. Membership is verified server side (active, under RLS)
 * before the cookie is set. The client then does a full navigation so nothing from the old
 * household survives in the router cache or in memory.
 */
export async function switchHouseholdAction(householdId: string): Promise<{ ok: boolean; message: string }> {
  const s = await requireSession();
  const id = z.uuid().safeParse(householdId);
  if (!id.success || !s.memberships.some((m) => m.householdId === id.data)) {
    return { ok: false, message: FOREIGN };
  }
  (await cookies()).set(HOUSEHOLD_COOKIE, id.data, { ...cookieOptions(60 * 60 * 24 * 365) });
  revalidatePath("/", "layout");
  return { ok: true, message: "Switched." };
}

/** Owner only (the database re-checks). Returns the token once; the client builds the link from its own origin. */
export async function inviteMemberAction(_prev: HouseholdActionState, fd: FormData): Promise<HouseholdActionState> {
  const s = await requireSession();
  if (s.role !== "owner") return { ok: false, message: "Only a household owner can invite people." };
  const r = await createInvite({ household: s.householdId, email: fd.get("email") });
  if (!r.ok) return { ok: false, message: r.error };
  revalidatePath("/settings");
  return { ok: true, message: "Invite created. Nothing has been emailed: share the link yourself.", token: r.data.token };
}

export async function revokeInviteAction(_prev: HouseholdActionState, fd: FormData): Promise<HouseholdActionState> {
  const s = await requireSession();
  if (s.role !== "owner") return { ok: false, message: "Only a household owner can revoke invites." };
  const r = await revokeInvite(fd.get("invite"));
  if (!r.ok) return { ok: false, message: r.error };
  revalidatePath("/settings");
  return { ok: true, message: "Invite revoked." };
}

export async function removeMemberAction(_prev: HouseholdActionState, fd: FormData): Promise<HouseholdActionState> {
  const s = await requireSession();
  if (s.role !== "owner") return { ok: false, message: "Only a household owner can remove people." };
  const r = await removeMember(s.householdId, fd.get("user"));
  if (!r.ok) return { ok: false, message: r.error };
  revalidatePath("/settings");
  return { ok: true, message: "Member removed. They no longer have access." };
}

/** Leaves the household being shown. The client then does a full navigation to / (onboarding if none left). */
export async function leaveHouseholdAction(_prev: HouseholdActionState, _fd: FormData): Promise<HouseholdActionState> {
  const s = await requireSession();
  const r = await leaveHousehold(s.householdId);
  if (!r.ok) return { ok: false, message: r.error };
  const store = await cookies();
  if (store.get(HOUSEHOLD_COOKIE)?.value === s.householdId) store.delete(HOUSEHOLD_COOKIE);
  revalidatePath("/", "layout");
  return { ok: true, message: "You have left the household." };
}
