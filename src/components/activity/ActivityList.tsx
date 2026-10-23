import Link from "next/link";
import type { DatePrefs } from "@/components/dates";
import { absoluteTime, describeActivity, relativeTime, type ActivityRow } from "./format";

export function ActivityItem({ row, now, datePrefs }: { row: ActivityRow; now: Date; datePrefs?: DatePrefs }) {
  const d = describeActivity(row);
  return (
    <li className="rounded-md bg-surface-muted px-3 py-2 text-sm">
      <strong>{d.actor}</strong> {d.verb} {d.noun}
      {d.title ? <> &lsquo;{d.title}&rsquo;</> : null}
      <time dateTime={row.createdAt} title={absoluteTime(row.createdAt, datePrefs)} className="block text-xs text-muted">
        {relativeTime(row.createdAt, now, datePrefs)} &middot; {absoluteTime(row.createdAt, datePrefs)}
      </time>
    </li>
  );
}

export function ActivityList({
  rows,
  now,
  nextBefore,
  error,
  datePrefs,
}: {
  rows: readonly ActivityRow[];
  now: Date;
  nextBefore: string | null;
  error?: boolean;
  datePrefs?: DatePrefs;
}) {
  if (error) return <p className="text-sm text-muted">Could not load activity. Try again shortly.</p>;
  if (rows.length === 0) return <p className="text-sm text-muted">No activity yet.</p>;
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Activity timeline" className="flex flex-col gap-2">
        {rows.map((r) => (
          <ActivityItem key={r.id} row={r} now={now} datePrefs={datePrefs} />
        ))}
      </ul>
      {nextBefore ? (
        <Link
          href={`/activity?before=${encodeURIComponent(nextBefore)}`}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Older activity
        </Link>
      ) : null}
    </div>
  );
}
