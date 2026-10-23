import "server-only";
import { SnagSchema } from "@/contracts/snags";
import { TaskSchema } from "@/contracts/tasks";
import { createUserClient } from "@/server/db/supabase";
import { loadActivity } from "./activity";
import { daysBetween, expenseRecords, sortRenewals } from "@/components/money/format";
import { parseRecords } from "./records";
import type { DashboardData } from "@/components/Dashboard";
import type { Task } from "@/contracts/tasks";
import type { Snag } from "@/contracts/snags";
import { loadBins } from "./bins";
import { documentsSummary } from "./documents";
import { getMaintenanceCardData } from "./maintenance";
import { getSuppliesCardData } from "./shopping";
import { listNotifications } from "./notifications";
import { getAwaitingSummary } from "./replies";
import { getEnergy } from "./energy";

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export function todayInLondon(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

/** Value of a settled loader, or null when it threw or rejected. */
function ok<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === "fulfilled" ? r.value : null;
}

type Core = Pick<DashboardData, "tasks" | "snags" | "openSnagCount" | "activity" | "renewals" | "expenses" | "suggestionInput">;

const EMPTY_CORE: Core = {
  tasks: null, snags: null, openSnagCount: null, activity: null, renewals: null, expenses: null,
  suggestionInput: { tasks: null, snags: null, records: null },
};

/** Tasks, snags, records and activity. Each part is null when its own query failed. */
async function loadCore(today: string): Promise<Core> {
  const supabase = await createUserClient();
  if (!supabase) return EMPTY_CORE;

  const [tasksRes, snagsRes, activity, recordsRes] = await Promise.allSettled([
    supabase.from("tasks").select("*").eq("status", "open").order("due_date", { ascending: true }).limit(500),
    supabase.from("snags").select("*").neq("status", "fixed").limit(500),
    loadActivity(5, null),
    supabase.from("household_records").select("*").limit(2000),
  ]);
  const tr = ok(tasksRes);
  const sr = ok(snagsRes);
  const rr = ok(recordsRes);
  const act = ok(activity);

  let renewals: DashboardData["renewals"] = null;
  let expenses: DashboardData["expenses"] = null;
  let records: DashboardData["suggestionInput"]["records"] = null;
  if (rr && !rr.error && rr.data) {
    const recs = parseRecords(rr.data);
    records = recs;
    renewals = sortRenewals(recs)
      .map((r) => ({ id: r.id, title: r.title, provider: r.provider, date: r.date, days: daysBetween(today, r.date) }))
      .filter((r) => r.days >= 0 && r.days <= 90)
      .slice(0, 3);
    const exp = expenseRecords(recs);
    expenses = {
      count: exp.length,
      lines: exp.slice(0, 3).map((r) => ({
        id: r.id, title: r.title, amount: r.amount as number, frequency: r.frequency, verified: r.verified,
      })),
    };
  }

  let tasks: DashboardData["tasks"] = null;
  let allTasks: Task[] | null = null;
  if (tr && !tr.error) {
    allTasks = (tr.data ?? []).flatMap((r) => {
      const p = TaskSchema.safeParse(r);
      return p.success ? [p.data] : [];
    });
    tasks = allTasks
      .flatMap((t) => (t.due_date && t.due_date <= today ? [{ ...t, due_date: t.due_date }] : []))
      .slice(0, 5)
      .map((t) => ({ id: t.id, title: t.title, dueDate: t.due_date, overdue: t.due_date < today }));
  }

  let snags: DashboardData["snags"] = null;
  let openSnagCount: number | null = null;
  let allSnags: Snag[] | null = null;
  if (sr && !sr.error) {
    const valid = (sr.data ?? []).flatMap((r) => {
      const p = SnagSchema.safeParse(r);
      return p.success ? [p.data] : [];
    });
    valid.sort(
      (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.created_at.localeCompare(b.created_at),
    );
    allSnags = valid;
    openSnagCount = valid.length;
    snags = valid.slice(0, 3).map((s) => ({ id: s.id, title: s.title, priority: s.priority, status: s.status }));
  }

  return {
    tasks, snags, openSnagCount, activity: act ? act.rows : null, renewals, expenses,
    suggestionInput: { tasks: allTasks, snags: allSnags, records },
  };
}

/**
 * Every section loads independently: a failing loader gives null (or an error status) for that
 * card only, so Home never breaks and never shows made-up values.
 */
export async function getDashboardData(now = new Date(), userId?: string): Promise<DashboardData> {
  const today = todayInLondon(now);
  const [core, bins, notifications, awaiting, supplies, maintenance, energy, documents] = await Promise.allSettled([
    loadCore(today),
    loadBins(now),
    userId ? listNotifications(userId, 50) : Promise.resolve(null),
    getAwaitingSummary(),
    getSuppliesCardData(),
    getMaintenanceCardData(today),
    getEnergy(),
    documentsSummary(),
  ]);
  const b = ok(bins);
  const n = ok(notifications);
  const e = ok(energy);
  return {
    ...(ok(core) ?? EMPTY_CORE),
    today,
    bins: b && b.ok ? b.days : null,
    notifications: n && n.ok ? n.data : null,
    awaiting: ok(awaiting),
    supplies: ok(supplies),
    maintenance: ok(maintenance),
    energy: e && e.ok ? e.data : null,
    documents: ok(documents),
  };
}
