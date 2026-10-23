import Link from "next/link";
import { CardTitle } from "@/components/home/CardTitle";
import { daysWaiting, waitingLabel, type EmailThread } from "@/components/replies/types";

export interface AwaitingSummaryData { count: number; top: EmailThread[]; everSynced: boolean }

/** Dashboard card. `data` null means it could not be loaded. */
export function AwaitingRepliesCard({ data, now }: { data: AwaitingSummaryData | null; now: Date }) {
  return (
    <section aria-label="Awaiting company replies" data-testid="dashboard-card" className="rounded-lg border border-border bg-surface p-4">
      <CardTitle icon="mail" tint="slate">Awaiting company replies</CardTitle>
      <div className="mt-3">
        {data === null ? (
          <p className="text-sm text-muted">Could not load this right now.</p>
        ) : !data.everSynced ? (
          <p className="text-sm text-muted">Not connected yet</p>
        ) : data.count === 0 ? (
          <p className="text-sm text-muted">Nothing is waiting on a reply.</p>
        ) : (
          <>
            <p className="mb-2 text-sm"><strong>{data.count}</strong> waiting</p>
            <ul className="flex flex-col gap-2 text-sm">
              {data.top.slice(0, 3).map((t) => (
                <li key={t.id} className="rounded-md bg-surface-muted px-3 py-2">
                  <strong>{t.counterpart_domain}</strong>
                  <span className="text-muted"> {waitingLabel(daysWaiting(t.last_message_at, now))}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <Link href="/replies" className="inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2">
        All replies
      </Link>
    </section>
  );
}
