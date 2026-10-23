import Link from "next/link";
import { CardTitle } from "@/components/home/CardTitle";
import { formatGBP } from "@/components/money/format";

export type ContributionsData =
  | { status: "off" }
  | { status: "error" }
  | { status: "ok"; rhys: number | null; rachel: number | null; unreconciled: boolean };

/** Monthly joint account contributions as written in the shared sheet (read-only). */
export function ContributionsCard({ data }: { data: ContributionsData }) {
  return (
    <section aria-label="Joint account contributions" data-testid="dashboard-card" className="rounded-lg border border-border bg-surface p-4">
      <CardTitle icon="money" tint="amber">Joint account contributions</CardTitle>
      <div className="mt-3 text-sm">
        {data.status === "off" ? (
          <p className="text-muted">Not connected yet</p>
        ) : data.status === "error" ? (
          <p className="text-muted">Could not load this right now.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              <li className="rounded-md bg-surface-muted px-3 py-2"><strong>Rhys</strong> <span className="text-muted">{data.rhys === null ? "not in sheet" : `${formatGBP(data.rhys)} a month`}</span></li>
              <li className="rounded-md bg-surface-muted px-3 py-2"><strong>Rachel</strong> <span className="text-muted">{data.rachel === null ? "not in sheet" : `${formatGBP(data.rachel)} a month`}</span></li>
            </ul>
            {data.unreconciled ? (
              <p className="mt-2 rounded-md bg-amber-100 px-3 py-2 text-amber-950" data-testid="unreconciled">
                Unreconciled: the sheet has figures that do not add up.
              </p>
            ) : null}
          </>
        )}
      </div>
      <Link href="/budget" className="inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2">
        See the budget
      </Link>
    </section>
  );
}

/** Pure mapping so the dashboard owner can wire it from a loadCosts() result. */
export function contributionsFromCosts(
  res: { status: "off" } | { status: "error" } | { status: "ok"; sheet: { summary: { jointAccountTotal: { rhys: number | null; rachel: number | null } | null } }; flags: unknown[] },
): ContributionsData {
  if (res.status !== "ok") return { status: res.status };
  const j = res.sheet.summary.jointAccountTotal;
  return { status: "ok", rhys: j?.rhys ?? null, rachel: j?.rachel ?? null, unreconciled: res.flags.length > 0 };
}
