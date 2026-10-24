import "server-only";
import { createUserClient } from "@/server/db/supabase";
import { scopedDb } from "@/server/db/scoped";
import { addDays, groupBins, londonToday, type BinDay } from "@/components/bins/group";

export type BinsResult = { ok: true; days: BinDay[]; lastSynced: string | null } | { ok: false; error: string };

const WEEKS = 8;
const FAIL = "Could not load bin collections right now.";

/** Next 8 weeks of collections for the caller's household (RLS scopes the rows). */
export async function loadBins(now: Date = new Date()): Promise<BinsResult> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: FAIL };
  const { db, householdId } = sc;
  const today = londonToday(now);
  const [rows, last] = await Promise.all([
    db.from("bin_collections").select("collection_date, bin_name").eq("household_id", householdId)
      .gte("collection_date", today).lt("collection_date", addDays(today, WEEKS * 7))
      .order("collection_date").limit(500),
    db.from("bin_collections").select("received_at").eq("household_id", householdId).order("received_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (rows.error || last.error || !rows.data) return { ok: false, error: FAIL };
  const days = groupBins(rows.data.map((r) => ({ date: String(r.collection_date), bin: String(r.bin_name) })), now);
  return { ok: true, days, lastSynced: last.data ? String(last.data.received_at) : null };
}
