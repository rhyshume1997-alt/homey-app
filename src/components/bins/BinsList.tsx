import { formatDate, type DatePrefs } from "@/components/dates";
import type { BinDay } from "./group";
import { londonToday } from "./group";
import { trafficLight } from "@/components/status";
import { StatusPill } from "@/components/ui/StatusPill";

export function BinsEmpty() {
  return (
    <p className="rounded-md border border-border bg-surface-muted px-4 py-3 text-sm text-muted">
      No bin collections yet. Add your bins once below, or open your council&apos;s page.
    </p>
  );
}

export function BinsList({ days, datePrefs, lastSynced, today = londonToday(new Date()) }: { days: readonly BinDay[]; datePrefs?: DatePrefs; lastSynced: string | null; today?: string }) {
  return (
    <div className="flex flex-col gap-3">
      {days.length === 0 ? <BinsEmpty /> : (
        <ul aria-label="Upcoming bin collections" className="flex flex-col gap-2">
          {days.map((d) => (
            <li
              key={d.date}
              className={`rounded-lg border p-4 ${d.putOutTonight ? "border-warning-border bg-warning-bg text-warning-fg" : "border-border bg-surface"}`}
            >
              {d.putOutTonight ? <p className="text-sm font-semibold">Put out tonight</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold"><time dateTime={d.date}>{formatDate(d.date, datePrefs)}</time></p>
                <StatusPill light={trafficLight("bins", d.date, today)} />
              </div>
              <ul className="mt-1 text-sm">
                {d.bins.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {lastSynced ? <p className="text-sm text-muted">Last synced {formatDate(lastSynced, datePrefs, true)}</p> : null}
    </div>
  );
}
