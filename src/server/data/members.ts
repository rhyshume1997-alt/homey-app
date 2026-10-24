import "server-only";
import { z } from "zod";
import { HouseholdRoleSchema, LIMITS } from "@/contracts/household";
import type { HouseholdRole } from "@/contracts/household";
import { createUserClient } from "@/server/db/supabase";

/** Only the fields the More page may show. No emails, no user ids. */
const MemberRowSchema = z.object({
  display_name: z.string().min(1).max(LIMITS.displayName),
  role: HouseholdRoleSchema,
});

export type HouseholdMemberView = {
  displayName: string;
  role: HouseholdRole;
};

/**
 * Members of one household, read under RLS as the signed-in user. Null when the
 * query fails or Supabase is unconfigured. Rows that fail validation are dropped.
 */
export async function loadMembers(householdId: string): Promise<HouseholdMemberView[] | null> {
  const supabase = await createUserClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("household_members")
    .select("display_name, role")
    .eq("household_id", householdId)
    .eq("status", "active")
    .order("display_name", { ascending: true });
  if (error || !data) return null;
  const members: HouseholdMemberView[] = [];
  for (const raw of data) {
    const parsed = MemberRowSchema.safeParse(raw);
    if (!parsed.success) continue;
    members.push({ displayName: parsed.data.display_name, role: parsed.data.role });
  }
  return members;
}
