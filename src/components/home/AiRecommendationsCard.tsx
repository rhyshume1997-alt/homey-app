import Link from "next/link";
import type { Task } from "@/contracts/tasks";
import type { Snag } from "@/contracts/snags";
import type { HouseholdRecord } from "@/contracts/records";
import { computeNeedsDoing, type NeedsInput } from "@/components/homey/needs-doing";
import { StatusPill } from "@/components/ui/StatusPill";
import { OpenHomeyButton } from "@/components/home/OpenHomeyButton";

const TOP = 3;

/**
 * The top "what needs doing" items, from the rule engine. Works with no API key and makes no
 * network calls. Pass null for any list that could not be loaded. Bins, maintenance and supplies
 * are optional extras; the full list lives in the Homey panel.
 */
export function AiRecommendationsCard({
  tasks,
  snags,
  records,
  today,
  bins,
  maintenance,
  supplies,
}: {
  tasks: Task[] | null;
  snags: Snag[] | null;
  records: HouseholdRecord[] | null;
  today: string;
  bins?: NeedsInput["bins"] | null;
  maintenance?: NeedsInput["maintenance"] | null;
  supplies?: NeedsInput["supplies"] | null;
}) {
  const items = computeNeedsDoing({
    tasks: tasks ?? [], snags: snags ?? [], records: records ?? [],
    bins: bins ?? [], maintenance: maintenance ?? [], supplies: supplies ?? [], today,
  });
  const top = items.slice(0, TOP);
  const partial = tasks === null || snags === null || records === null;
  return (
    <section aria-label="Suggestions" data-testid="ai-recommendations" className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">Suggestions</h2>
      <div className="mt-3">
        {top.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {top.map((i) => (
              <li key={i.key} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-muted px-3 py-2">
                <StatusPill light={i.light} />
                <Link href={i.href} className="underline focus-visible:outline-2 focus-visible:outline-offset-2">
                  {i.text}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing needs attention right now.</p>
        )}
        {partial ? <p className="mt-2 text-sm text-muted">Some data could not be loaded, so this may be incomplete.</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4">
        <OpenHomeyButton />
        <Link
          href="/assistant"
          className="inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Ask the assistant
        </Link>
      </div>
    </section>
  );
}
