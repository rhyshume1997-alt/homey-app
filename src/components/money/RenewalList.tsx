import { formatDate, type DatePrefs } from "@/components/dates";
import type { HouseholdRecord } from "@/contracts/records";
import type { FormAction } from "@/components/tasks/types";
import { daysBetween, relativeDays, sortRenewals } from "./format";
import { VerifyButton } from "./VerifyButton";
import { trafficLight } from "@/components/status";
import { StatusPill } from "@/components/ui/StatusPill";

/** `today` is a London calendar date (YYYY-MM-DD). `records` null means loading failed. */
export function RenewalList({
  records,
  today,
  datePrefs,
  verifyAction,
}: {
  records: readonly HouseholdRecord[] | null;
  today: string;
  datePrefs?: DatePrefs;
  verifyAction: FormAction;
}) {
  const rows = records ? sortRenewals(records) : [];
  return (
    <section aria-label="Renewals and deadlines" className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">Renewals and deadlines</h2>
      {records === null ? (
        <p className="mt-3 text-sm text-muted">Could not load this right now.</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing recorded yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((r) => {
            const days = daysBetween(today, r.date);
            return (
              <li key={r.id} data-testid="renewal-row" className="rounded-md bg-surface-muted px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {r.provider && <strong className="min-w-0 break-words">{r.provider}</strong>}
                  <span className="min-w-0 break-words">{r.title}</span>
                  <StatusPill light={trafficLight("renewal", r.date, today)} />
                  {!r.verified && (
                    <span className="rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-fg">
                      Unverified
                    </span>
                  )}
                </div>
                <p className="mt-1">
                  {formatDate(r.date, datePrefs)} <span className="text-muted">({relativeDays(days)})</span>
                </p>
                {r.next_action && <p className="mt-1 break-words">{r.next_action}</p>}
                {r.reference_last4 && <p className="mt-1 text-muted">ref ••{r.reference_last4}</p>}
                {!r.verified && <VerifyButton action={verifyAction} id={r.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
