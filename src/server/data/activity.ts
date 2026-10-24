import "server-only";
import { AuditEntrySchema } from "@/contracts/household";
import { createUserClient } from "@/server/db/supabase";
import { scopedDb } from "@/server/db/scoped";
import { parseBefore } from "@/components/activity/format";
import type { ActivityRow } from "@/components/activity/format";

export { parseBefore };

export const ACTIVITY_PAGE_SIZE = 25;

const RowSchema = AuditEntrySchema.omit({ before: true, after: true });

export async function loadActivity(
  limit: number,
  before: number | null,
): Promise<{ rows: ActivityRow[]; hasMore: boolean } | null> {
  const sc = await scopedDb();
  if (!sc) return null;
  const { db: supabase, householdId } = sc;
  // before/after JSON is deliberately never selected.
  let q = supabase
    .from("audit_log")
    .select("id, household_id, actor_user_id, action, entity_type, entity_id, summary, created_at").eq("household_id", householdId)
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (before !== null) q = q.lt("id", before);
  const [{ data, error }, { data: members }] = await Promise.all([
    q,
    supabase.from("household_members").select("user_id, display_name").eq("household_id", householdId).eq("status", "active"),
  ]);
  if (error || !data) return null;
  const names = new Map<string, string>();
  for (const m of members ?? []) names.set(m.user_id, m.display_name);
  const hasMore = data.length > limit;
  const rows: ActivityRow[] = [];
  for (const raw of data.slice(0, limit)) {
    const p = RowSchema.safeParse(raw);
    if (!p.success) continue;
    rows.push({
      id: String(p.data.id),
      action: p.data.action,
      entityType: p.data.entity_type,
      summary: p.data.summary,
      createdAt: p.data.created_at,
      actorName: (p.data.actor_user_id && names.get(p.data.actor_user_id)) || "Someone",
    });
  }
  return { rows, hasMore };
}
