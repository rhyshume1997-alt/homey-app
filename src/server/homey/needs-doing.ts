import "server-only";
import { SnagSchema, type Snag } from "@/contracts/snags";
import { TaskSchema, type Task } from "@/contracts/tasks";
import type { HouseholdRecord } from "@/contracts/records";
import type { NeedItem } from "@/components/homey/types";
import {
  computeNeedEntries, countNeeds, worstLightFor, type NeedEntry, type NeedsInput,
} from "@/components/homey/needs-doing";
import { createUserClient } from "@/server/db/supabase";
import { getSession, type HouseholdSession } from "@/server/auth/session";
import { parseRecords } from "@/server/data/records";
import { loadBins } from "@/server/data/bins";
import { listMaintenance } from "@/server/data/maintenance";
import { listSupplies } from "@/server/data/shopping";

export { worstLightFor };

export type NeedsDoing = { items: NeedItem[]; partial: boolean };
export type NeedsEntries = { entries: NeedEntry[]; partial: boolean };

type Db = NonNullable<Awaited<ReturnType<typeof createUserClient>>>;

async function loadTasks(db: Db, s: HouseholdSession): Promise<Task[] | null> {
  const { data, error } = await db
    .from("tasks").select("*").eq("household_id", s.householdId).eq("status", "open").limit(500);
  if (error || !data) return null;
  return data.flatMap((r) => {
    const p = TaskSchema.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

async function loadSnags(db: Db, s: HouseholdSession): Promise<Snag[] | null> {
  const { data, error } = await db
    .from("snags").select("*").eq("household_id", s.householdId).neq("status", "fixed").limit(500);
  if (error || !data) return null;
  return data.flatMap((r) => {
    const p = SnagSchema.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

async function loadRecords(db: Db, s: HouseholdSession): Promise<HouseholdRecord[] | null> {
  const { data, error } = await db.from("household_records").select("*").eq("household_id", s.householdId).limit(2000);
  return error || !data ? null : parseRecords(data);
}

/**
 * Loads every source independently (a failing loader only sets `partial`) and runs the rules.
 * Entries carry the server-built proposal for each item; the browser never supplies that data.
 */
export async function getNeedsEntries(session: HouseholdSession, today: string): Promise<NeedsEntries> {
  const db = await createUserClient();
  if (!db) return { entries: [], partial: true };
  // Noon UTC is the same London calendar day all year.
  const at = new Date(`${today}T12:00:00Z`);
  const [tasks, snags, records, bins, maintenance, supplies] = await Promise.allSettled([
    loadTasks(db, session),
    loadSnags(db, session),
    loadRecords(db, session),
    loadBins(at),
    listMaintenance(),
    listSupplies(),
  ]);
  const v = <T>(r: PromiseSettledResult<T | null>): T | null => (r.status === "fulfilled" ? r.value : null);
  const t = v(tasks), sn = v(snags), rc = v(records);
  const bn = bins.status === "fulfilled" && bins.value.ok ? bins.value.days : null;
  const mt = maintenance.status === "fulfilled" && maintenance.value.ok ? maintenance.value.data : null;
  const sp = supplies.status === "fulfilled" && supplies.value.ok ? supplies.value.data : null;

  const input: NeedsInput = {
    tasks: t ?? [], snags: sn ?? [], records: rc ?? [], bins: bn ?? [], maintenance: mt ?? [], supplies: sp ?? [], today,
  };
  const partial = [t, sn, rc, bn, mt, sp].some((x) => x === null);
  return { entries: computeNeedEntries(input), partial };
}

export async function getNeedsDoing(session: HouseholdSession, today: string): Promise<NeedsDoing> {
  const { entries, partial } = await getNeedsEntries(session, today);
  return { items: entries.map((e) => e.item), partial };
}

/** Badge number: overdue + today + renewals within 7 days. Zero when signed out. */
export async function getNeedsCount(today: string): Promise<number> {
  const session = await getSession();
  if (!session) return 0;
  const { items } = await getNeedsDoing(session, today);
  return countNeeds(items, today);
}
