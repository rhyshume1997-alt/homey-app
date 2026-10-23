/**
 * The traffic-light rules, shared by every list, card, the calendar and Homey.
 * Red: past its date. Amber: inside the "due soon" window for its kind. Green: later, or done.
 * Never show the colour alone: pair it with STATUS_LABEL (and a dot or icon).
 */

export type Light = "red" | "amber" | "green";

/**
 * What the date belongs to. The kind sets the amber window:
 * task / maintenance / checklist: today to 7 days; renewal / bill / document / warranty: 30 days;
 * bins: today or tomorrow; event / meal: today only.
 */
export type DueKind =
  | "task"
  | "maintenance"
  | "checklist"
  | "renewal"
  | "bill"
  | "document"
  | "warranty"
  | "bins"
  | "event"
  | "meal";

export const AMBER_DAYS: Record<DueKind, number> = {
  task: 7,
  maintenance: 7,
  checklist: 7,
  renewal: 30,
  bill: 30,
  document: 30,
  warranty: 30,
  bins: 1,
  event: 0,
  meal: 0,
};

export const STATUS_LABEL: Record<Light, string> = { red: "Overdue", amber: "Due soon", green: "On track" };

/** Whole calendar days from `today` to `date`, both YYYY-MM-DD. Negative when past. */
export function daysUntil(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Traffic light for one dated item. A done item, or one with no date, is green. */
export function trafficLight(kind: DueKind, date: string | null, today: string, done = false): Light {
  if (done || !date) return "green";
  const d = daysUntil(today, date);
  if (d < 0) return kind === "event" || kind === "meal" || kind === "bins" ? "green" : "red";
  return d <= AMBER_DAYS[kind] ? "amber" : "green";
}

/** Most urgent first: red, amber, green. */
export const LIGHT_ORDER: Record<Light, number> = { red: 0, amber: 1, green: 2 };

export function countLights(lights: readonly Light[]): Record<Light, number> {
  const out: Record<Light, number> = { red: 0, amber: 0, green: 0 };
  for (const l of lights) out[l]++;
  return out;
}

/** The single most urgent light (drives Homey's face: red shocked, amber concerned, green happy). */
export function worstLight(lights: readonly Light[]): Light {
  return lights.reduce<Light>((w, l) => (LIGHT_ORDER[l] < LIGHT_ORDER[w] ? l : w), "green");
}
