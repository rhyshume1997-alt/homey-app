import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
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
  const data = { user };
  const { data: m } = await supabase
    .from("household_members")
    .select("household_id, role, display_name")
    .eq("user_id", data.user.id)
    .limit(1)
    .maybeSingle();
  if (!m) return null;
  return {
    userId: data.user.id,
    householdId: m.household_id,
    role: m.role,
    displayName: m.display_name,
    datePrefs: parseDatePrefs(data.user.user_metadata),
    showSnags: parseShowSnags(data.user.user_metadata),
  };
});

/** For pages, route handlers and server actions: the session, or a redirect to /login. */
export async function requireSession(): Promise<HouseholdSession> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}
