/**
 * Pure planner for the "Our Home Master Record" JSON format.
 * Never touches a database: planImport returns plain rows, buildSql returns text.
 * Runs under Node >= 22.18 (native type stripping), so keep to erasable TypeScript syntax.
 */
import { createHash } from "node:crypto";
import type { HouseholdRecord } from "../../src/contracts/records";
import type { Snag } from "../../src/contracts/snags";
import type { Task } from "../../src/contracts/tasks";

export type HouseholdRecordInsert = Omit<HouseholdRecord, "id" | "created_by" | "created_at" | "updated_at">;
export type SnagInsert = Pick<Snag, "household_id" | "title" | "location" | "notes" | "status" | "priority">;
export type TaskInsert = Pick<Task, "household_id" | "title" | "notes" | "due_date" | "recurrence">;

export interface MasterRecordItem {
  category: string;
  provider?: string | null;
  what?: string | null;
  amount?: number | null;
  frequency?: string | null;
  dates?: { start?: string | null; renewal?: string | null; end?: string | null; next_action?: string | null } | null;
  reference_last4?: string | null;
  status?: string | null;
  source?: string | null;
}

export interface MasterRecord {
  schema_version?: string | number;
  name?: string;
  as_of: string;
  household?: Record<string, unknown> | null;
  items: MasterRecordItem[];
  import_rules?: unknown;
}

export interface ImportPlan {
  records: HouseholdRecordInsert[];
  snags: SnagInsert[];
  tasks: TaskInsert[];
  warnings: string[];
  /** Returned separately for a later House screen. Contains the address: never print or log it. */
  household: Record<string, unknown> | null;
}

export const RECORD_CATEGORIES = [
  "property", "purchase", "property_document", "mortgage", "mortgage_option", "banking", "insurance",
  "electricity", "gas", "broadband", "council_tax", "water", "factoring", "solar", "maintenance",
  "energy_efficiency", "household_finance", "contact", "project",
] as const;
const AMOUNT_KINDS = ["budget", "bill", "estimate", "snapshot", "contract", "proposal"] as const;
const SNAG_STATUSES = ["open", "reported", "in_progress", "fixed"] as const;
const SNAG_PRIORITIES = ["low", "medium", "high"] as const;
const TASK_RECURRENCES = ["none", "daily", "weekly", "monthly", "yearly"] as const;

const LIMITS = { provider: 200, title: 500, frequency: 100, nextAction: 500, status: 200, source: 500, snagTitle: 200, snagNotes: 2000, taskNotes: 2000 };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addYears(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export function importKey(category: string, provider: string | null | undefined, what: string | null | undefined): string {
  const hash = createHash("sha256").update(`${category}|${provider ?? ""}|${what ?? ""}`).digest("hex");
  return `mr1:${hash.slice(0, 32)}`;
}

function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function deriveUnit(amount: number | null, frequency: string | null, what: string | null): "GBP" | "kWh" | null {
  if (amount === null) return null;
  // Only the frequency says what the number measures ("kWh per year estimated"). The description
  // can mention kWh for a bill that is in pounds (e.g. "300.5 kWh import" billed at £42.17).
  void what;
  return /kwh/i.test(frequency ?? "") ? "kWh" : "GBP";
}

export function deriveAmountKind(
  amount: number | null,
  unit: "GBP" | "kWh" | null,
  item: { category: string; what: string | null; frequency: string | null; status: string | null },
): (typeof AMOUNT_KINDS)[number] | null {
  if (amount === null) return null;
  const freq = (item.frequency ?? "").toLowerCase();
  const status = (item.status ?? "").toLowerCase();
  const both = `${freq} ${status}`;
  if (both.includes("budget")) return "budget";
  if (/\bbill(ed)?\b/.test(status) || (freq === "billing period" && unit === "GBP")) return "bill";
  if (freq.includes("snapshot") || status === "historical") return "snapshot";
  if (both.includes("estimat") || both.includes("predicted")) return "estimate";
  if (both.includes("proposed") || both.includes("considering")) return "proposal";
  const text = `${(item.what ?? "").toLowerCase()} ${freq}`;
  if (item.category === "purchase" || /purchase|original principal|one-off/.test(text)) return "contract";
  return null;
}

function cap(value: string | null, max: number, label: string, where: string, warnings: string[]): string | null {
  if (value === null || value.length <= max) return value;
  warnings.push(`${where}: ${label} truncated to ${max} characters`);
  return value.slice(0, max);
}

function monthStart(nextAction: string | null): string | null {
  const m = nextAction?.match(/\b(\d{4})-(0[1-9]|1[0-2])\b(?!-)/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

export function planImport(record: MasterRecord, householdId: string): ImportPlan {
  const warnings: string[] = [];
  const records: HouseholdRecordInsert[] = [];
  const snags: SnagInsert[] = [];
  const tasks: TaskInsert[] = [];
  const keys = new Set<string>();
  const snagTitles = new Set<string>();
  const taskIndex = new Map<string, TaskInsert>();
  const asOf = isValidIsoDate(record.as_of) ? record.as_of : null;
  if (asOf === null) warnings.push("record: as_of missing or not YYYY-MM-DD; as_of left null");

  let mortgageRenewalSeen = false;
  let mortgageSeen = false;

  const addTask = (t: { title: string; due: string; notes: string; recurrence?: TaskInsert["recurrence"] }) => {
    const existing = taskIndex.get(t.title);
    if (existing) {
      if (existing.due_date !== t.due) {
        warnings.push(`task "${t.title}": several different due dates found; kept the earliest`);
        if (t.due < (existing.due_date ?? "9999")) existing.due_date = t.due;
      }
      return;
    }
    const row: TaskInsert = { household_id: householdId, title: t.title, notes: t.notes.slice(0, LIMITS.taskNotes), due_date: t.due, recurrence: t.recurrence ?? "none" };
    taskIndex.set(t.title, row);
    tasks.push(row);
  };

  (record.items ?? []).forEach((item, i) => {
    const category = clean(item?.category);
    const what = clean(item?.what);
    const where = `item #${i + 1} (${category ?? "no category"}${what ? `: ${what.slice(0, 40)}` : ""})`;
    if (!category) { warnings.push(`${where}: missing category; skipped`); return; }
    if (!what) { warnings.push(`${where}: missing "what"; skipped`); return; }

    const rawProvider = clean(item.provider);
    const provider = rawProvider === null || rawProvider.toLowerCase() === "unknown" ? null : rawProvider;
    const status = clean(item.status);
    const source = clean(item.source);
    const frequency = clean(item.frequency);
    const nextActionRaw = clean(item.dates?.next_action);

    let ref: string | null = null;
    if (item.reference_last4 !== null && item.reference_last4 !== undefined && item.reference_last4 !== "") {
      if (typeof item.reference_last4 === "string" && item.reference_last4.length === 4) ref = item.reference_last4;
      else warnings.push(`${where}: reference_last4 is not exactly 4 characters; dropped`);
    }

    const dateOf = (field: "start" | "renewal" | "end"): string | null => {
      const v = clean(item.dates?.[field]);
      if (v === null) return null;
      if (isValidIsoDate(v)) return v;
      warnings.push(`${where}: dates.${field} is not a valid YYYY-MM-DD date; dropped`);
      return null;
    };
    const start = dateOf("start");
    const renewal = dateOf("renewal");
    const end = dateOf("end");

    if (category === "snag") {
      const title = cap(what, LIMITS.snagTitle, "title", where, warnings) as string;
      const lower = (status ?? "").toLowerCase();
      const lines = [
        status && `Status: ${status}`,
        nextActionRaw && `Next: ${nextActionRaw}`,
        provider && `Provider: ${provider}`,
        ref && `Ref: …${ref}`,
        start && `Since: ${start}`,
        source && `Source: ${source}`,
      ].filter((l): l is string => typeof l === "string");
      if (snagTitles.has(title)) { warnings.push(`${where}: duplicate snag title; skipped`); return; }
      snagTitles.add(title);
      snags.push({
        household_id: householdId,
        title,
        location: null,
        notes: lines.length ? cap(lines.join("\n"), LIMITS.snagNotes, "notes", where, warnings) : null,
        status: /complaint|repair not verified|awaiting response/.test(lower) ? "reported" : "open",
        priority: lower.includes("high priority") ? "high" : "medium",
      });
      return;
    }

    if (!(RECORD_CATEGORIES as readonly string[]).includes(category)) {
      warnings.push(`${where}: unknown category; skipped`);
      return;
    }

    let amount: number | null = null;
    if (item.amount !== null && item.amount !== undefined) {
      if (typeof item.amount === "number" && Number.isFinite(item.amount)) amount = item.amount;
      else warnings.push(`${where}: amount is not a finite number; treated as unknown`);
    }
    const unit = deriveUnit(amount, frequency, what);
    const kind = deriveAmountKind(amount, unit, { category, what, frequency, status });
    const key = importKey(category, rawProvider, what);
    if (keys.has(key)) { warnings.push(`${where}: duplicate of an earlier item (same category, provider and what); skipped`); return; }
    keys.add(key);

    records.push({
      household_id: householdId,
      category: category as HouseholdRecord["category"],
      provider: cap(provider, LIMITS.provider, "provider", where, warnings),
      title: cap(what, LIMITS.title, "title", where, warnings) as string,
      amount,
      unit,
      amount_kind: kind,
      frequency: cap(frequency, LIMITS.frequency, "frequency", where, warnings),
      start_date: start,
      renewal_date: renewal,
      end_date: end,
      next_action: cap(nextActionRaw, LIMITS.nextAction, "next_action", where, warnings),
      reference_last4: ref,
      status: cap(status, LIMITS.status, "status", where, warnings),
      source: cap(source, LIMITS.source, "source", where, warnings),
      verified: false,
      as_of: asOf,
      import_key: key,
    });

    const who = [rawProvider, what].filter(Boolean).join(" - ");
    if (category === "insurance") {
      if (renewal) addTask({ title: "Compare home insurance renewal quotes", due: addDays(renewal, -28), notes: `From master record: ${who}` });
      else warnings.push(`${where}: insurance has no renewal date; no renewal task created`);
    } else if (category === "electricity") {
      const d = kind === "bill" ? null : (end ?? renewal);
      if (d) addTask({ title: "Compare energy tariffs before fixed deal ends", due: addDays(d, -42), notes: `From master record: ${who}` });
      else warnings.push(`${where}: electricity has no fixed-deal end or renewal date (or is a bill); no tariff task created`);
    } else if (category === "mortgage") {
      mortgageSeen = true;
      if (renewal) {
        mortgageRenewalSeen = true;
        addTask({ title: "Review mortgage before fixed rate ends", due: addDays(renewal, -120), notes: `From master record: ${who}` });
      }
    } else if (category === "maintenance" && /boiler/i.test(what)) {
      const due = monthStart(nextActionRaw) ?? (start ? addYears(start, 1) : null);
      if (due) {
        addTask({ title: "Book annual boiler service", due, notes: `From master record: ${who}`, recurrence: "yearly" });
      } else warnings.push(`${where}: boiler service has no usable next_action month or start date; no service task created`);
    }
  });

  if (mortgageSeen && !mortgageRenewalSeen) warnings.push("mortgage: no mortgage item has a renewal date; no review task created");

  return { records, snags, tasks, warnings, household: record.household ?? null };
}

// ---------- SQL ----------

function q(s: string | null): string {
  if (s === null) return "null";
  if (s.includes("\u0000")) throw new Error("NUL character in text value");
  return `'${s.replace(/'/g, "''")}'`;
}
function num(n: number | null): string {
  if (n === null) return "null";
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error("non-finite number in plan");
  return String(n);
}
function dt(d: string | null): string {
  if (d === null) return "null";
  if (!isValidIsoDate(d)) throw new Error(`invalid date in plan: ${String(d)}`);
  return `'${d}'::date`;
}
function oneOf(v: string | null, allowed: readonly string[], label: string): string {
  if (v === null) return "null";
  if (!allowed.includes(v)) throw new Error(`invalid ${label} in plan`);
  return q(v);
}
function hhCheck(id: string): string {
  if (!UUID_RE.test(id)) throw new Error("household_id is not a valid uuid");
  return q(id.toLowerCase());
}

export function buildSql(plan: Pick<ImportPlan, "records" | "snags" | "tasks">): string {
  const out: string[] = ["begin;"];

  if (plan.records.length) {
    const rows = plan.records.map((r) => {
      if (!(RECORD_CATEGORIES as readonly string[]).includes(r.category)) throw new Error("invalid category in plan");
      if (r.reference_last4 !== null && r.reference_last4.length !== 4) throw new Error("reference_last4 must be exactly 4 characters");
      if (r.import_key === null) throw new Error("record without import_key");
      return `(${[
        hhCheck(r.household_id), q(r.category), q(r.provider), q(r.title), num(r.amount),
        oneOf(r.unit, ["GBP", "kWh"], "unit"), oneOf(r.amount_kind, AMOUNT_KINDS, "amount_kind"), q(r.frequency),
        dt(r.start_date), dt(r.renewal_date), dt(r.end_date), q(r.next_action), q(r.reference_last4),
        q(r.status), q(r.source), r.verified ? "true" : "false", dt(r.as_of), q(r.import_key),
      ].join(", ")})`;
    });
    out.push(
      "insert into public.household_records (household_id, category, provider, title, amount, unit, amount_kind, frequency, start_date, renewal_date, end_date, next_action, reference_last4, status, source, verified, as_of, import_key) values",
      rows.join(",\n"),
      "on conflict (household_id, import_key) do nothing;",
    );
  }

  for (const s of plan.snags) {
    const hh = hhCheck(s.household_id);
    out.push(
      `insert into public.snags (household_id, title, location, notes, status, priority) select ${hh}, ${q(s.title)}, ${q(s.location)}, ${q(s.notes)}, ${oneOf(s.status, SNAG_STATUSES, "snag status")}, ${oneOf(s.priority, SNAG_PRIORITIES, "snag priority")} where not exists (select 1 from public.snags where household_id = ${hh} and title = ${q(s.title)});`,
    );
  }
  for (const t of plan.tasks) {
    const hh = hhCheck(t.household_id);
    out.push(
      `insert into public.tasks (household_id, title, notes, due_date, recurrence) select ${hh}, ${q(t.title)}, ${q(t.notes)}, ${dt(t.due_date)}, ${oneOf(t.recurrence, TASK_RECURRENCES, "recurrence")} where not exists (select 1 from public.tasks where household_id = ${hh} and title = ${q(t.title)});`,
    );
  }
  out.push("commit;");
  return out.join("\n") + "\n";
}
