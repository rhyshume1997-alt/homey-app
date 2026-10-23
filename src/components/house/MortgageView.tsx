import { formatDate, type DatePrefs } from "@/components/dates";
import { daysBetween, relativeDays } from "@/components/money/format";
import type { HouseholdRecord } from "@/contracts/records";
import type { FormAction } from "@/components/tasks/types";
import { Empty, RecordCard, Section } from "./RecordCard";
import { fixedRateEnd, splitMortgage } from "./model";

export const SNAPSHOT_LABEL = "Historic snapshot, not the live balance";

export function MortgageView({
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
  const s = splitMortgage(records ?? []);
  const end = fixedRateEnd(records ?? []);
  const list = (rows: HouseholdRecord[], snapshot = false) =>
    records === null ? (
      <Empty failed />
    ) : rows.length === 0 ? (
      <Empty />
    ) : (
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id} className="list-none">
            {snapshot && <p className="mb-1 text-xs font-semibold text-warning-fg">{SNAPSHOT_LABEL}</p>}
            <ul>
              <RecordCard r={r} datePrefs={datePrefs} verifyAction={verifyAction} showDates={!snapshot} />
            </ul>
            {snapshot && !r.as_of && <p className="mt-1 text-xs text-muted">As of: Unknown</p>}
          </li>
        ))}
      </ul>
    );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Mortgage</h1>
      <p className="text-sm text-muted">Figures are as recorded. Nothing here is calculated or estimated.</p>
      <Section title="Fixed rate">
        {records === null ? (
          <Empty failed />
        ) : end ? (
          <p className="mt-3 text-sm" data-testid="fixed-end">
            Fixed rate ends <strong>{formatDate(end.date, datePrefs)}</strong>{" "}
            <span className="text-muted">({relativeDays(daysBetween(today, end.date))})</span>
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">Fixed-rate end date: Unknown</p>
        )}
      </Section>
      <Section title="Terms" note="Agreed contract terms.">{list(s.terms)}</Section>
      <Section title="Payments" note="Monthly figures, unverified until marked.">{list(s.payments)}</Section>
      <Section title="Balance snapshots" note="Each is a dated record from the past.">{list(s.snapshots, true)}</Section>
      <Section title="Options being considered" note="Proposals only, not agreed.">{list(s.options)}</Section>
      <Section title="Account notes">{list(s.notes)}</Section>
    </div>
  );
}
