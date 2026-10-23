import Link from "next/link";
import { CardTitle } from "@/components/home/CardTitle";
import { formatDate, type DatePrefs } from "@/components/dates";
import type { BinDay } from "@/components/bins/group";

/** Dashboard-style card. `days` null means it could not be loaded. */
export function BinsCard({ days, datePrefs }: { days: readonly BinDay[] | null; datePrefs?: DatePrefs }) {
  const next = days?.[0];
  return (
    <section aria-label="Next bin collection" className="rounded-lg border border-border bg-surface p-4">
      <CardTitle icon="bins" tint="lavender">Next bin collection</CardTitle>
      <div className="mt-3 text-sm">
        {days === null ? <p className="text-muted">Could not load this right now.</p> : !next ? (
          <p className="text-muted">Not connected yet</p>
        ) : (
          <>
            {next.putOutTonight ? <p className="font-semibold">Put out tonight</p> : null}
            <p className="font-medium"><time dateTime={next.date}>{formatDate(next.date, datePrefs)}</time></p>
            <ul>{next.bins.map((b) => <li key={b} className="text-muted">{b}</li>)}</ul>
          </>
        )}
      </div>
      <Link href="/bins" className="inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2">
        All collections
      </Link>
    </section>
  );
}
