import { addDays, groupBins, londonToday, type BinDay, type BinRow } from "./group";

export const BIN_COLOURS = ["black", "blue", "green", "brown", "grey", "purple", "red", "yellow"] as const;
export type BinColour = (typeof BIN_COLOURS)[number];
export const BIN_LIMITS = { name: 40, every: 8, url: 500 } as const;

export interface BinSchedule {
  id: string;
  bin_name: string;
  colour: BinColour;
  first_date: string; // YYYY-MM-DD
  every_weeks: number;
}

const utcDay = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};

/**
 * Collection dates for one schedule from `today` (inclusive) for `weeks` weeks. Pure calendar-date
 * arithmetic on YYYY-MM-DD, so it is unaffected by the BST/GMT change.
 */
export function scheduleDates(s: Pick<BinSchedule, "first_date" | "every_weeks">, today: string, weeks = 8): string[] {
  const step = Math.max(1, Math.floor(s.every_weeks)) * 7;
  const end = addDays(today, weeks * 7);
  const gap = Math.round((utcDay(today) - utcDay(s.first_date)) / 86_400_000);
  let k = gap <= 0 ? 0 : Math.ceil(gap / step);
  const out: string[] = [];
  for (let d = addDays(s.first_date, k * step); d < end; d = addDays(s.first_date, ++k * step)) {
    if (d >= today) out.push(d);
  }
  return out;
}

/** Schedules expanded over the next 8 weeks, merged with pushed rows. Same date + same bin name (ignoring case) shows once. */
export function mergeBinDays(
  schedules: readonly BinSchedule[],
  pushed: readonly BinRow[],
  now: Date,
  weeks = 8,
): BinDay[] {
  const today = londonToday(now);
  const seen = new Set<string>();
  const rows: BinRow[] = [];
  const add = (date: string, bin: string) => {
    const key = `${date}|${bin.trim().toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ date, bin: bin.trim() });
  };
  for (const p of pushed) add(p.date, p.bin);
  for (const s of schedules) for (const d of scheduleDates(s, today, weeks)) add(d, s.bin_name);
  return groupBins(rows, now);
}
