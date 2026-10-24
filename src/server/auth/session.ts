import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { HOUSEHOLD_COOKIE, pickMembership } from "@/server/auth/household-cookie";
import { createUserClient } from "@/server/db/supabase";
import type { HouseholdRole } from "@/contracts/household";
import { parseDatePrefs, type DatePrefs } from "@/components/dates";
import { parseShowSnags } from "@/components/snags/prefs";

export type Session = {
  userId: string;
};

/** A signed-in user who belongs to a household. The only identity pages and actions trust. */
export type HouseholdSession = Session & {
  householdId: string;
  role: HouseholdRole;
  displayName: string;
  /** Every household the caller is an ACTIVE member of, oldest first. Feeds the switcher. */
  memberships: { householdId: string; name: string; role: HouseholdRole }[];
  datePrefs: DatePrefs;
  /** Display only: the person chose to hide the snag list. Never used for authorisation. */
  showSnags: boolean;
};

/**
 * Validates the session with Supabase Auth (getUser, not the unverified cookie)
 * and loads the caller's household membership under RLS. Null when signed out,
 * unconfigured, or not a member of any household.
 *
 * Memoised per server render with React cache(): the (house) layout, AppShell, the page and
 * data loaders all ask for the session and share one getUser + one membership lookup.
 * The memo never outlives one request, so every request is still validated afresh.
 */
/**
 * The validated Supabase user for this request (getUser, not the unverified cookie), memoised so
 * getSession and display-only readers such as getAppearance share one Auth call. Null when signed
 * out or unconfigured.
 */
export const getAuthUser = cache(async function getAuthUser() {
  const supabase = await createUserClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { supabase, user: data.user };
});

export const getSession = cache(async function getSession(): Promise<HouseholdSession | null> {
  const auth = await getAuthUser();
  if (!auth) return null;
  const { supabase, user } = auth;
  const { data } = await supabase
    .from("household_members")
    .select("household_id, role, display_name, households(name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  const rows = (data ?? []).map((r) => {
    const h = (r as { households?: { name?: string } | { name?: string }[] | null }).households;
    const name = (Array.isArray(h) ? h[0]?.name : h?.name) ?? "Household";
    return { householdId: r.household_id as string, name, role: r.role as HouseholdRole, displayName: r.display_name as string };
  });
  // The cookie is a preference, never authority: it only counts if it names an active membership.
  const chosen = pickMembership(rows, (await cookies()).get(HOUSEHOLD_COOKIE)?.value);
  if (!chosen) return null;
  return {
    userId: user.id,
    householdId: chosen.householdId,
    role: chosen.role,
    displayName: chosen.displayName,
    memberships: rows.map(({ householdId, name, role }) => ({ householdId, name, role })),
    datePrefs: parseDatePrefs(user.user_metadata),
    showSnags: parseShowSnags(user.user_metadata),
  };
});

/**
 * For pages, route handlers and server actions: the session, or a redirect. Signed in without an
 * active membership goes to /onboarding; signed out goes to /login.
 */
export async function requireSession(): Promise<HouseholdSession> {
  const s = await getSession();
  if (s) return s;
  redirect((await getAuthUser()) ? "/onboarding" : "/login");
}

/** Signed in (validated with Supabase Auth), membership not required. For /onboarding and /invite. */
export const getAuthOnly = getAuthUser;
