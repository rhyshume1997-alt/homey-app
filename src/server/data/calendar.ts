import "server-only";
import type { createUserClient } from "@/server/db/supabase";
import { scopedDb } from "@/server/db/scoped";
import { daysUntil, trafficLight } from "@/components/status";
import type { CalendarItem } from "@/contracts/calendar";
import { listEvents } from "./household-events";
import { listWarrantyEnds } from "./appliances";
import { listDueChecklist } from "./checklist";
import { listMealsForRange } from "./meals";

export type CalendarRange = { from: string; to: string; today: string };
export type CalendarSource = (range: CalendarRange) => Promise<CalendarItem[]>;

type Db = NonNullable<Awaited<ReturnType<typeof createUserClient>>>;
type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

async function withDb(fn: (db: Db, householdId: string) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  const sc = await scopedDb();
  if (!sc) throw new Error("no client");
  const { data, error } = await fn(sc.db, sc.householdId);
  if (error || !Array.isArray(data)) throw new Error("query failed");
  return data as Row[];
}

const tasks: CalendarSource = async (r) =>
  (await withDb((db, hid) =>
    db.from("tasks").select("id, title, due_date").eq("household_id", hid).eq("status", "open")
      .gte("due_date", r.from).lte("due_date", r.to).limit(1000),
  )).map((t) => ({
    key: `task:${str(t.id)}`, date: str(t.due_date), title: str(t.title), kind: "task" as const,
    light: trafficLight("task", str(t.due_date), r.today), href: "/tasks",
  }));

const bins: CalendarSource = async (r) =>
  (await withDb((db, hid) =>
    db.from("bin_collections").select("collection_date, bin_name").eq("household_id", hid)
      .gte("collection_date", r.from).lte("collection_date", r.to).limit(1000),
  )).map((b) => ({
    key: `bins:${str(b.collection_date)}:${str(b.bin_name)}`, date: str(b.collection_date),
    title: `${str(b.bin_name)} bin collection`, kind: "bins" as const,
    light: trafficLight("bins", str(b.collection_date), r.today), href: "/bins",
  }));

const records: CalendarSource = async (r) => {
  const rows = await withDb((db, hid) =>
    db.from("household_records").select("id, title, provider, renewal_date, end_date").eq("household_id", hid)
      .or(`and(renewal_date.gte.${r.from},renewal_date.lte.${r.to}),and(end_date.gte.${r.from},end_date.lte.${r.to})`)
      .limit(1000),
  );
  return rows.flatMap((x) =>
    (["renewal_date", "end_date"] as const).flatMap((f): CalendarItem[] => {
      const d = str(x[f]);
      if (!d || d < r.from || d > r.to) return [];
      const label = f === "renewal_date" ? "renews" : "ends";
      return [{
        key: `record:${str(x.id)}:${f}`, date: d, title: `${str(x.provider) || str(x.title)} ${label}`,
        kind: "renewal", light: trafficLight("renewal", d, r.today), href: "/money",
      }];
    }),
  );
};

const maintenance: CalendarSource = async (r) =>
  (await withDb((db, hid) =>
    db.from("maintenance_items").select("id, title, next_due_on").eq("household_id", hid)
      .gte("next_due_on", r.from).lte("next_due_on", r.to).limit(1000),
  )).map((m) => ({
    key: `maintenance:${str(m.id)}`, date: str(m.next_due_on), title: str(m.title), kind: "maintenance" as const,
    light: trafficLight("maintenance", str(m.next_due_on), r.today), href: "/maintenance",
  }));

const documents: CalendarSource = async (r) =>
  (await withDb((db, hid) =>
    db.from("documents").select("id, title, expires_on").eq("household_id", hid)
      .gte("expires_on", r.from).lte("expires_on", r.to).limit(1000),
  )).map((d) => ({
    key: `document:${str(d.id)}`, date: str(d.expires_on), title: `${str(d.title)} expires`, kind: "document" as const,
    light: trafficLight("document", str(d.expires_on), r.today), href: "/documents",
  }));

const events: CalendarSource = async (r) => {
  const res = await listEvents(r.from, r.to);
  if (!res.ok) throw new Error(res.error);
  return res.data.map((e): CalendarItem => ({
    key: `event:${e.id}`, date: e.starts_on, title: e.title, kind: "event",
    light: trafficLight("event", e.starts_on, r.today), href: `/calendar?d=${e.starts_on}`,
    ...(e.starts_at ? { time: e.starts_at.slice(0, 5) } : {}),
  }));
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Appliance warranty ends. The link is built from the id only (validated as a uuid). */
export const warranties: CalendarSource = async (r) =>
  (await listWarrantyEnds())
    .filter((w) => UUID.test(w.id) && w.warranty_end >= r.from && w.warranty_end <= r.to)
    .map((w): CalendarItem => ({
      key: `warranty:${w.id}`, date: w.warranty_end, title: `${w.name} warranty ends`, kind: "warranty",
      light: trafficLight("warranty", w.warranty_end, r.today), href: `/appliances/${w.id}`,
    }));

/** Seasonal checklist items due in the range (items covered by a task are already left out). */
export const checklist: CalendarSource = async (r) => {
  const res = await listDueChecklist(r.today, Math.max(0, daysUntil(r.today, r.to)));
  if (!res.ok) throw new Error(res.error);
  return res.data
    .filter((c) => c.next_due_on >= r.from && c.next_due_on <= r.to)
    .map((c): CalendarItem => ({
      key: `checklist:${c.id}`, date: c.next_due_on, title: c.title, kind: "checklist",
      light: trafficLight("checklist", c.next_due_on, r.today), href: "/checklist",
    }));
};

/**
 * Every source of dated items. Add meals by appending a loader here;
 * a source that throws is skipped and counted, never blocks the others.
 */
/** Planned meals in the range (titles only, never ingredients or prices). */
export const meals: CalendarSource = async (r) => {
  const res = await listMealsForRange(r.from, r.to);
  if (!res.ok) throw new Error(res.error);
  return res.data.map((m): CalendarItem => ({
    key: `meal:${m.id}`, date: m.planned_on, title: `${m.slot === "lunch" ? "Lunch" : "Dinner"}: ${m.title}`, kind: "meal",
    light: trafficLight("meal", m.planned_on, r.today), href: `/meals?w=${m.planned_on}`,
  }));
};

export const CALENDAR_SOURCES: CalendarSource[] = [tasks, bins, records, maintenance, documents, events, warranties, checklist, meals];

export type CalendarResult = { items: CalendarItem[]; failed: number };

export async function loadCalendarItems(
  range: CalendarRange,
  sources: readonly CalendarSource[] = CALENDAR_SOURCES,
): Promise<CalendarResult> {
  const settled = await Promise.allSettled(sources.map((s) => s(range)));
  const items: CalendarItem[] = [];
  let failed = 0;
  for (const s of settled) {
    if (s.status === "fulfilled") items.push(...s.value);
    else failed++;
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
  return { items, failed };
}
