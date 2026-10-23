import type { CalendarItem } from "@/contracts/calendar";
import { addDays } from "@/components/bins/group";
import { worstLight, type Light } from "@/components/status";

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Validates ?m=; anything else falls back to the month of `fallbackDay`. */
export function parseMonth(raw: string | undefined, fallbackDay: string): string {
  return raw && MONTH_RE.test(raw) ? raw : fallbackDay.slice(0, 7);
}

/** Validates ?d= as a real calendar date; otherwise null. */
export function parseDay(raw: string | undefined): string | null {
  if (!raw || !DAY_RE.test(raw)) return null;
  return addDays(raw, 0) === raw ? raw : null;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${NAMES[m - 1]} ${y}`;
}

export type Cell = { date: string; inMonth: boolean };

/** Six Monday-first weeks (42 cells) covering the month. */
export function monthGrid(month: string): Cell[] {
  const first = `${month}-01`;
  const dow = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i);
    return { date, inMonth: date.startsWith(month) };
  });
}

export type DaySummary = { count: number; light: Light };

export function summariseByDay(items: readonly CalendarItem[]): Map<string, DaySummary> {
  const by = new Map<string, CalendarItem[]>();
  for (const it of items) by.set(it.date, [...(by.get(it.date) ?? []), it]);
  return new Map([...by].map(([d, list]) => [d, { count: list.length, light: worstLight(list.map((i) => i.light)) }]));
}
