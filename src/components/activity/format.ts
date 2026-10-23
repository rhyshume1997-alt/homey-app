import { DEFAULT_DATE_PREFS, formatDate, type DatePrefs } from "@/components/dates";
/** Pure helpers for rendering audit entries. Never touches before/after JSON. */

export type ActivityRow = {
  id: string;
  action: string;
  entityType: string;
  summary: string | null;
  createdAt: string;
  actorName: string;
};

const VERBS: Record<string, string> = {
  created: "added",
  updated: "updated",
  completed: "completed",
  reopened: "reopened",
  deleted: "deleted",
  fixed: "marked as fixed",
};

const NOUNS: Record<string, string> = { task: "task", snag: "snag" };

/**
 * Phrasing for actions beyond the task/snag verbs. `title` false means the summary is never shown
 * (it may hold free text from an email or an AI proposal). Summaries are titles only, never amounts or references.
 */
const ACTIONS: Record<string, { verb: string; noun: string; title: boolean }> = {
  "shopping.added": { verb: "added", noun: "to the shopping list:", title: true },
  "shopping.updated": { verb: "updated shopping item", noun: "", title: true },
  "shopping.bought": { verb: "bought", noun: "", title: true },
  "shopping.removed": { verb: "removed from the shopping list:", noun: "", title: true },
  "supply.added": { verb: "added supply", noun: "", title: true },
  "supply.updated": { verb: "updated supply", noun: "", title: true },
  "supply.status_changed": { verb: "changed the stock level of", noun: "", title: true },
  "supply.removed": { verb: "removed supply", noun: "", title: true },
  "maintenance.added": { verb: "added maintenance", noun: "", title: true },
  "maintenance.updated": { verb: "updated maintenance", noun: "", title: true },
  "maintenance.done": { verb: "marked maintenance done:", noun: "", title: true },
  "maintenance.removed": { verb: "removed maintenance", noun: "", title: true },
  "document.added": { verb: "added document", noun: "", title: true },
  "document.updated": { verb: "updated document", noun: "", title: true },
  "document.deleted": { verb: "deleted document", noun: "", title: true },
  "bins.synced": { verb: "updated the bin dates", noun: "", title: false },
  "email.synced": { verb: "synced email threads", noun: "", title: false },
  "email.status_changed": { verb: "changed the status of an email thread", noun: "", title: false },
  "record.created": { verb: "added", noun: "record", title: true },
  "record.updated": { verb: "updated", noun: "record", title: true },
  "record.deleted": { verb: "deleted", noun: "record", title: true },
  "record.verified": { verb: "marked verified:", noun: "", title: true },
  "budget.snapshot_saved": { verb: "saved a budget snapshot", noun: "", title: false },
  "ai.proposed": { verb: "received an assistant suggestion", noun: "", title: false },
  "ai.confirmed": { verb: "confirmed an assistant suggestion", noun: "", title: false },
  "ai.rejected": { verb: "dismissed an assistant suggestion", noun: "", title: false },
  // D18 modules. Summaries are names/titles only (see each module's audit trigger).
  "room.created": { verb: "added room", noun: "", title: true },
  "room.updated": { verb: "updated room", noun: "", title: true },
  "room.deleted": { verb: "deleted room", noun: "", title: true },
  "checklist.added": { verb: "added checklist item", noun: "", title: true },
  "checklist.updated": { verb: "updated checklist item", noun: "", title: true },
  "checklist.done": { verb: "ticked off", noun: "", title: true },
  "checklist.removed": { verb: "removed checklist item", noun: "", title: true },
  "wishlist.added": { verb: "added to things to get:", noun: "", title: true },
  "wishlist.updated": { verb: "updated thing to get", noun: "", title: true },
  "wishlist.bought": { verb: "marked as bought:", noun: "", title: true },
  "wishlist.removed": { verb: "removed from things to get:", noun: "", title: true },
  // Label only (e.g. "Stopcock"); numbers and codes never reach the summary.
  "emergency.added": { verb: "added emergency info", noun: "", title: true },
  "emergency.updated": { verb: "updated emergency info", noun: "", title: true },
  "emergency.removed": { verb: "removed emergency info", noun: "", title: true },
  // Network name only: the password is never in the summary and is never shown here.
  "wifi.added": { verb: "added wifi network", noun: "", title: true },
  "wifi.updated": { verb: "updated wifi network", noun: "", title: true },
  "wifi.removed": { verb: "removed wifi network", noun: "", title: true },
  "event.created": { verb: "added calendar event", noun: "", title: true },
  "event.updated": { verb: "updated calendar event", noun: "", title: true },
  "event.deleted": { verb: "deleted calendar event", noun: "", title: true },
  "appliance.created": { verb: "added appliance", noun: "", title: true },
  "appliance.updated": { verb: "updated appliance", noun: "", title: true },
  "appliance.deleted": { verb: "deleted appliance", noun: "", title: true },
};

/** Meter reading summaries are "<fuel> <YYYY-MM-DD>" (never the value): phrase them with the fuel only. */
const METER_VERBS: Record<string, string> = {
  "meter_reading.added": "added",
  "meter_reading.updated": "updated",
  "meter_reading.removed": "removed",
};

function describeMeter(row: Describable, verb: string) {
  const fuel = /^(electricity|gas) \d{4}-\d{2}-\d{2}$/.exec(row.summary?.trim() ?? "")?.[1];
  return { actor: row.actorName, verb: `${verb} ${fuel === "electricity" ? "an electricity" : fuel ? `a ${fuel}` : "a"} meter reading`, noun: "", title: null };
}

type Describable = Pick<ActivityRow, "action" | "entityType" | "summary" | "actorName">;

const EVENT_LABELS = [
  "Put a washing on",
  "Started the dishwasher",
  "Emptied the dishwasher",
  "Put the washing away",
  "Bought supplies",
];

/** Household event summary is "<label>" or "<label>: <note>". Verb is the lower-cased label. */
function describeEvent(row: Describable) {
  const summary = row.summary?.trim() ?? "";
  const known = EVENT_LABELS.find((l) => summary === l || summary.startsWith(`${l}: `));
  if (!known) return { actor: row.actorName, verb: "logged a household event", noun: "", title: null };
  const note = summary.slice(known.length).replace(/^: /, "");
  const verb = known.charAt(0).toLowerCase() + known.slice(1);
  return { actor: row.actorName, verb, noun: "", title: note || null };
}

/** Returns sentence parts so the title is rendered as escaped text, never markup. */
export function describeActivity(row: Describable): { actor: string; verb: string; noun: string; title: string | null } {
  if (row.action === "household.event") return describeEvent(row);
  const meter = METER_VERBS[row.action];
  if (meter) return describeMeter(row, meter);
  const known = ACTIONS[row.action];
  if (known) {
    return { actor: row.actorName, verb: known.verb, noun: known.noun, title: known.title && row.summary?.trim() ? row.summary : null };
  }
  const [entity, verbKey] = row.action.split(".");
  const noun = NOUNS[row.entityType] ?? NOUNS[entity ?? ""] ?? "item";
  const verb = VERBS[verbKey ?? ""] ?? "changed";
  return { actor: row.actorName, verb, noun, title: row.summary?.trim() ? row.summary : null };
}

export function activityText(row: Describable): string {
  const d = describeActivity(row);
  if (row.action === "household.event") return d.title ? `${d.actor} ${d.verb} (${d.title})` : `${d.actor} ${d.verb}`;
  if (ACTIONS[row.action] || METER_VERBS[row.action]) {
    const head = [d.actor, d.verb, d.noun].filter(Boolean).join(" ");
    return d.title ? `${head} '${d.title}'` : head;
  }
  return d.title ? `${d.actor} ${d.verb} ${d.noun} '${d.title}'` : `${d.actor} ${d.verb} a ${d.noun}`;
}

export function relativeTime(iso: string, now: Date, prefs: DatePrefs = DEFAULT_DATE_PREFS): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.round((now.getTime() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d ago`;
  return formatDate(new Date(t), prefs);
}

export function absoluteTime(iso: string, prefs: DatePrefs = DEFAULT_DATE_PREFS): string {
  return formatDate(iso, prefs, true);
}

/** Accepts only a positive integer cursor; anything else is ignored. */
export function parseBefore(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string" || !/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
