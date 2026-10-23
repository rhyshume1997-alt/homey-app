export interface BinRow { date: string; bin: string }
export interface BinDay { date: string; bins: string[]; putOutTonight: boolean }

/** Today's calendar date in Europe/London as YYYY-MM-DD. */
let londonDay: Intl.DateTimeFormat | null = null;
export function londonToday(now: Date): string {
  londonDay ??= new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(londonDay.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Groups rows by date (ascending, from today on). A day is "put out tonight" when it is tomorrow in London. */
export function groupBins(rows: readonly BinRow[], now: Date): BinDay[] {
  const today = londonToday(now);
  const tomorrow = addDays(today, 1);
  const byDate = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.date < today) continue;
    let set = byDate.get(r.date);
    if (!set) byDate.set(r.date, (set = new Set()));
    set.add(r.bin);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, bins]) => ({ date, bins: [...bins].sort(), putOutTonight: date === tomorrow }));
}
