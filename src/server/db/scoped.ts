import "server-only";
import { getSession } from "@/server/auth/session";
import { createUserClient } from "@/server/db/supabase";

/**
 * A user client plus the household the caller is currently acting in. Loaders add
 * .eq("household_id", householdId) explicitly: RLS alone would return every household the person
 * belongs to. Null when signed out, not a member, or unconfigured.
 */
export async function scopedDb() {
  const session = await getSession();
  if (!session) return null;
  const db = await createUserClient();
  if (!db) return null;
  return { db, householdId: session.householdId, userId: session.userId };
}
