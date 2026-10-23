import Link from "next/link";
import type { CalendarItem } from "@/contracts/calendar";
import { formatDate, type DatePrefs, DEFAULT_DATE_PREFS } from "@/components/dates";
import { StatusPill } from "@/components/ui/StatusPill";

function Row({ item }: { item: CalendarItem }) {
  return (
    <li>
      <Link
        href={item.href}
        className="flex min-h-[var(--touch-target)] items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span className="min-w-0">
          <span className="block truncate text-base font-medium">{item.title}</span>
          <span className="block text-xs text-muted">
            {item.kind}
            {item.time ? `, ${item.time}` : ""}
          </span>
        </span>
        <StatusPill light={item.light} />
      </Link>
    </li>
  );
}

export function Agenda({
  selected, today, items, upcoming, datePrefs = DEFAULT_DATE_PREFS,
}: {
  selected: string;
  today: string;
  items: readonly CalendarItem[];
  upcoming: readonly CalendarItem[];
  datePrefs?: DatePrefs;
}) {
  const day = items.filter((i) => i.date === selected);
  const groups = new Map<string, CalendarItem[]>();
  for (const i of upcoming) groups.set(i.date, [...(groups.get(i.date) ?? []), i]);
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="agenda-day" className="flex flex-col gap-2">
        <h2 id="agenda-day" className="text-lg font-semibold">
          {selected === today ? "Today" : formatDate(selected, datePrefs)}
        </h2>
        {day.length === 0 ? (
          <p className="text-sm text-muted">Nothing scheduled.</p>
        ) : (
          <ul className="flex flex-col gap-2">{day.map((i) => <Row key={i.key} item={i} />)}</ul>
        )}
      </section>
      <section aria-labelledby="agenda-next" className="flex flex-col gap-2">
        <h2 id="agenda-next" className="text-lg font-semibold">Next 14 days</h2>
        {groups.size === 0 ? (
          <p className="text-sm text-muted">Nothing in the next 14 days.</p>
        ) : (
          [...groups].map(([date, list]) => (
            <div key={date} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted">{date === today ? "Today" : formatDate(date, datePrefs)}</h3>
              <ul className="flex flex-col gap-2">{list.map((i) => <Row key={i.key} item={i} />)}</ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
