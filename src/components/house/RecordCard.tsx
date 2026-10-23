import { formatDate, type DatePrefs } from "@/components/dates";
import type { HouseholdRecord } from "@/contracts/records";
import type { FormAction } from "@/components/tasks/types";
import { KIND_LABEL } from "@/components/money/format";
import { VerifyButton } from "@/components/money/VerifyButton";
import { formatAmount } from "./model";

const U = "Unknown";

/** One record with provider, dates, status, next action, amount and kind. Nulls show as Unknown. */
export function RecordCard({
  r,
  datePrefs,
  verifyAction,
  showDates = true,
}: {
  r: HouseholdRecord;
  datePrefs?: DatePrefs;
  verifyAction: FormAction;
  showDates?: boolean;
}) {
  const d = (x: string) => formatDate(x, datePrefs);
  const dates = [
    r.start_date && `Start ${d(r.start_date)}`,
    r.renewal_date && `Renews ${d(r.renewal_date)}`,
    r.end_date && `Ends ${d(r.end_date)}`,
  ].filter(Boolean);
  return (
    <li data-testid="record-row" className="rounded-md bg-surface-muted px-3 py-3 text-sm">
      <p className="break-words font-medium">{r.title}</p>
      <p className="mt-1 break-words text-muted">Provider: {r.provider ?? U}</p>
      {(r.amount !== null || r.amount_kind !== null) && (
        <p className="mt-1">
          <strong>{formatAmount(r)}</strong>
          {r.amount_kind && <span className="text-muted"> ({KIND_LABEL[r.amount_kind].toLowerCase()})</span>}
          {r.frequency && <span className="text-muted"> {r.frequency}</span>}
        </p>
      )}
      {showDates && <p className="mt-1 text-muted">{dates.length ? dates.join(" · ") : `Dates: ${U}`}</p>}
      <p className="mt-1">Status: {r.status ?? U}</p>
      {r.next_action && <p className="mt-1 break-words">Next: {r.next_action}</p>}
      {r.reference_last4 && <p className="mt-1 text-muted">ref ••{r.reference_last4}</p>}
      {r.as_of && <p className="mt-1 text-muted">As of {d(r.as_of)}</p>}
      {r.amount !== null && !r.verified && (
        <>
          <span className="mt-1 inline-block rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-fg">
            Unverified
          </span>
          <VerifyButton action={verifyAction} id={r.id} />
        </>
      )}
    </li>
  );
}

export function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
      {children}
    </section>
  );
}

export function Empty({ failed }: { failed?: boolean }) {
  return <p className="mt-3 text-sm text-muted">{failed ? "Could not load this right now." : "Nothing recorded yet."}</p>;
}
