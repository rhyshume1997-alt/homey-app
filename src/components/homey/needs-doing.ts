/**
 * "What needs doing": a deterministic rule engine (no AI, no network). Pure, so it is safe in client
 * and server code. Everything it emits is built here from a fixed route map and an explicit field
 * allowlist (titles, dates, bin and supply names). Never amounts, notes, providers or references.
 */
import { addDays } from "@/components/bins/group";
import { daysUntil, trafficLight, worstLight, type Light } from "@/components/status";
import type { NeedBucket, NeedItem } from "@/components/homey/types";
import type { Task } from "@/contracts/tasks";
import type { Snag } from "@/contracts/snags";
import type { HouseholdRecord } from "@/contracts/records";
import type { SupplyStatus } from "@/components/shopping/types";

/** The only hrefs this module may emit. Fixed internal routes, never built from data. */
export const NEED_ROUTES = {
  tasks: "/tasks",
  bins: "/bins",
  maintenance: "/maintenance",
  money: "/money",
  figures: "/money/check",
  snags: "/snags",
  shopping: "/shopping",
} as const;

export const SOON_DAYS = 7;
/** Mirrors EXCLUDED_CATEGORIES in src/server/ai/context.ts (kept here so this module stays client-safe). */
const PERSONAL_CATEGORIES: ReadonlySet<string> = new Set(["contact", "property", "property_document", "banking", "purchase"]);
export const RENEWAL_WINDOW_DAYS = 30;
export const RENEWAL_LEAD_DAYS = 14;
export const SNAG_STALE_DAYS = 30;

const BUCKET_ORDER: Record<NeedBucket, number> = { overdue: 0, today: 1, soon: 2, check: 3, activity: 4 };

export type NeedsInput = {
  tasks: readonly Pick<Task, "id" | "title" | "notes" | "status" | "due_date">[];
  snags: readonly Pick<Snag, "id" | "status" | "created_at">[];
  records: readonly (Pick<HouseholdRecord, "id" | "title" | "provider" | "amount" | "verified" | "renewal_date" | "end_date"> &
    Partial<Pick<HouseholdRecord, "category">>)[];
  bins: readonly { date: string; bins: readonly string[] }[];
  maintenance: readonly { id: string; title: string; next_due_on: string | null }[];
  supplies: readonly { id: string; name: string; status: SupplyStatus }[];
  /** YYYY-MM-DD in London. */
  today: string;
};

/** What a person would be asked to confirm. Built from server data only, then stored as a pending proposal. */
export type NeedProposal =
  | { kind: "create_task"; payload: { title: string; due_date: string } }
  | { kind: "add_shopping_item"; payload: { title: string } };

export type NeedEntry = { item: NeedItem; proposal: NeedProposal | null };

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const TITLE_MAX = 120;

const mentions = (task: { title: string; notes: string | null }, record: { title: string; provider: string | null }) => {
  const hay = `${task.title} ${task.notes ?? ""}`.toLowerCase();
  const needles = [record.title, record.provider].filter((v): v is string => Boolean(v && v.trim().length >= 3));
  return needles.some((n) => hay.includes(n.toLowerCase()));
};

const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);

export function computeNeedEntries(input: NeedsInput): NeedEntry[] {
  const { today } = input;
  const out: NeedEntry[] = [];
  const push = (item: NeedItem, proposal: NeedProposal | null = null) => out.push({ item, proposal });
  const openTasks = input.tasks.filter((t) => t.status === "open");

  // Tasks: overdue, due today, due within 7 days.
  for (const t of openTasks) {
    if (!t.due_date) continue;
    const d = daysUntil(today, t.due_date);
    if (d > SOON_DAYS) continue;
    push({
      key: `task:${t.id}`,
      bucket: d < 0 ? "overdue" : d === 0 ? "today" : "soon",
      kind: "task",
      light: trafficLight("task", t.due_date, today),
      text: clip(t.title, TITLE_MAX),
      date: t.due_date,
      href: NEED_ROUTES.tasks,
      action: { type: "open", href: NEED_ROUTES.tasks, label: "Open tasks" },
    });
  }

  // Bins: collection today, or tomorrow (put out tonight).
  for (const b of input.bins) {
    const d = daysUntil(today, b.date);
    if ((d !== 0 && d !== 1) || b.bins.length === 0) continue;
    const names = b.bins.slice(0, 6).map((n) => clip(n, 30)).join(", ");
    push({
      key: `bins:${b.date}`,
      bucket: "today",
      kind: "bins",
      light: trafficLight("bins", b.date, today),
      text: d === 1 ? `Bins out tonight: ${names}` : `Bins collected today: ${names}`,
      date: b.date,
      href: NEED_ROUTES.bins,
      action: { type: "open", href: NEED_ROUTES.bins, label: "Open bins" },
    });
  }

  // Maintenance: due within 7 days, or already past.
  for (const m of input.maintenance) {
    if (!m.next_due_on) continue;
    const d = daysUntil(today, m.next_due_on);
    if (d > SOON_DAYS) continue;
    const title = clip(`Do: ${m.title}`, TITLE_MAX);
    push(
      {
        key: `maint:${m.id}`,
        bucket: d < 0 ? "overdue" : d === 0 ? "today" : "soon",
        kind: "maintenance",
        light: trafficLight("maintenance", m.next_due_on, today),
        text: clip(m.title, TITLE_MAX),
        date: m.next_due_on,
        href: NEED_ROUTES.maintenance,
        action: { type: "propose_task", label: title },
      },
      { kind: "create_task", payload: { title, due_date: d < 0 ? today : m.next_due_on } },
    );
  }

  // Renewals and end dates within 30 days with no open task that mentions them. Personal categories
  // (same set as the AI context exclusions) never become items, so their titles never reach the AI.
  for (const r of input.records) {
    if (r.category && PERSONAL_CATEGORIES.has(r.category)) continue;
    const date = r.renewal_date ?? r.end_date;
    if (!date) continue;
    const d = daysUntil(today, date);
    if (d < 0 || d > RENEWAL_WINDOW_DAYS || openTasks.some((t) => mentions(t, r))) continue;
    const lead = addDays(date, -RENEWAL_LEAD_DAYS);
    const title = clip(`Review ${r.title} renewal`, TITLE_MAX);
    push(
      {
        key: `renewal:${r.id}`,
        bucket: "soon",
        kind: "renewal",
        light: trafficLight("renewal", date, today),
        text: `${clip(r.title, 80)} ${r.renewal_date ? "renews" : "ends"} ${inDays(d)}`,
        date,
        href: NEED_ROUTES.money,
        action: { type: "propose_task", label: title },
      },
      { kind: "create_task", payload: { title, due_date: lead < today ? today : lead } },
    );
  }

  // Unverified figures (count only).
  const unverified = input.records.filter((r) => r.amount !== null && !r.verified).length;
  if (unverified > 0) {
    push({
      key: "figures",
      bucket: "check",
      kind: "figures",
      light: "green",
      text: `${unverified} figure${unverified === 1 ? " is" : "s are"} still unverified`,
      href: NEED_ROUTES.figures,
      action: { type: "open", href: NEED_ROUTES.figures, label: "Check figures" },
    });
  }

  // Snags open for more than 30 days (count only).
  const stale = input.snags.filter(
    (s) => s.status !== "fixed" && daysUntil(s.created_at.slice(0, 10), today) > SNAG_STALE_DAYS,
  ).length;
  if (stale > 0) {
    push({
      key: "snags",
      bucket: "check",
      kind: "snags",
      light: "amber",
      text: `${stale} snag${stale === 1 ? " has" : "s have"} been open over ${SNAG_STALE_DAYS} days`,
      href: NEED_ROUTES.snags,
      action: { type: "open", href: NEED_ROUTES.snags, label: "Open snags" },
    });
  }

  // Supplies a person marked low or out.
  for (const s of input.supplies) {
    if (s.status === "ok") continue;
    const name = clip(s.name, 80);
    push(
      {
        key: `supply:${s.id}`,
        bucket: "check",
        kind: "supplies",
        light: s.status === "out" ? "amber" : "green",
        text: `${name} is ${s.status}`,
        href: NEED_ROUTES.shopping,
        action: { type: "propose_shopping", label: clip(`Add ${name} to the shopping list`, TITLE_MAX) },
      },
      { kind: "add_shopping_item", payload: { title: name } },
    );
  }

  return out.sort(
    (a, b) =>
      BUCKET_ORDER[a.item.bucket] - BUCKET_ORDER[b.item.bucket] ||
      (a.item.date ?? "9999").localeCompare(b.item.date ?? "9999") ||
      a.item.key.localeCompare(b.item.key),
  );
}

export function computeNeedsDoing(input: NeedsInput): NeedItem[] {
  return computeNeedEntries(input).map((e) => e.item);
}

/** The most urgent light across items (drives Homey's face). Empty is green. */
export function worstLightFor(items: readonly Pick<NeedItem, "light">[]): Light {
  return worstLight(items.map((i) => i.light));
}

/** Overdue + today + renewals due within 7 days: the badge number. */
export function countNeeds(items: readonly NeedItem[], today: string): number {
  return items.filter(
    (i) =>
      i.bucket === "overdue" ||
      i.bucket === "today" ||
      (i.kind === "renewal" && i.date !== undefined && daysUntil(today, i.date) <= SOON_DAYS),
  ).length;
}
