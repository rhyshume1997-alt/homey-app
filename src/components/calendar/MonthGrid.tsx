import Link from "next/link";
import type { CalendarItem } from "@/contracts/calendar";
import { STATUS_LABEL } from "@/components/status";
import { monthGrid, monthLabel, shiftMonth, summariseByDay } from "./grid";

const DOT = { red: "bg-danger-fg", amber: "bg-warning-fg", green: "bg-success-fg" } as const;
const NAV =
  "inline-flex min-h-[var(--touch-target)] min-w-[var(--touch-target)] items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthGrid({
  month, items, today, selected,
}: { month: string; items: readonly CalendarItem[]; today: string; selected: string }) {
  const summary = summariseByDay(items);
  const href = (m: string, d?: string) => `/calendar?m=${m}${d ? `&d=${d}` : ""}`;
  return (
    <section aria-label="Month view" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Link href={href(shiftMonth(month, -1))} className={NAV} aria-label="Previous month" rel="prev">&larr;</Link>
        <h2 className="text-lg font-semibold" aria-live="polite">{monthLabel(month)}</h2>
        <Link href={href(shiftMonth(month, 1))} className={NAV} aria-label="Next month" rel="next">&rarr;</Link>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted" aria-hidden="true">
        {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
      </div>
      <ul className="grid grid-cols-7 gap-1" data-testid="month-grid">
        {monthGrid(month).map((c) => {
          const s = summary.get(c.date);
          const isToday = c.date === today;
          const isSel = c.date === selected;
          const day = Number(c.date.slice(8));
          const label = `${c.date}${isToday ? ", today" : ""}${s ? `, ${s.count} item${s.count === 1 ? "" : "s"}, ${STATUS_LABEL[s.light]}` : ", nothing scheduled"}`;
          return (
            <li key={c.date}>
              <Link
                href={href(month, c.date)}
                aria-label={label}
                aria-current={isToday ? "date" : undefined}
                data-today={isToday ? "true" : undefined}
                data-selected={isSel ? "true" : undefined}
                className={`flex min-h-[var(--touch-target)] flex-col items-center justify-center gap-0.5 rounded-md border text-sm focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  isToday ? "border-accent bg-accent font-bold text-accent-foreground" : isSel ? "border-accent bg-surface font-semibold" : "border-transparent bg-surface"
                } ${c.inMonth ? "" : "opacity-50"}`}
              >
                <span>{day}</span>
                {s ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold" data-light={s.light}>
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[s.light]}`} />
                    {s.count}
                  </span>
                ) : (
                  <span className="h-3" aria-hidden="true" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
