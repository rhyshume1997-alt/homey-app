import Link from "next/link";
import { CardTitle } from "@/components/home/CardTitle";
import { formatDate, type DatePrefs } from "@/components/dates";
import type { VaultDocument } from "@/components/documents/types";

/** Dashboard card. `summary` null means the section could not be loaded. */
export function DocumentsCard({
  summary, datePrefs,
}: { summary: { count: number; expiring: readonly VaultDocument[] } | null; datePrefs: DatePrefs }) {
  return (
    <section aria-label="Documents" data-testid="dashboard-card" className="rounded-lg border border-border bg-surface p-4">
      <CardTitle icon="document" tint="slate">Documents</CardTitle>
      <div className="mt-3 text-sm">
        {summary === null ? (
          <p className="text-muted">Could not load this right now.</p>
        ) : (
          <>
            <p>{summary.count} {summary.count === 1 ? "document" : "documents"} stored</p>
            {summary.expiring.length === 0 ? (
              <p className="text-muted">Nothing expiring in the next 30 days.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {summary.expiring.slice(0, 5).map((d) => (
                  <li key={d.id} className="rounded-md bg-surface-muted px-3 py-2">
                    {d.title} <span className="text-muted">expires {formatDate(d.expires_on ?? "", datePrefs)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <Link href="/documents" className="inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2">
        Open documents
      </Link>
    </section>
  );
}
