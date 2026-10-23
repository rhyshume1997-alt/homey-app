import type { HouseholdRecord } from "@/contracts/records";
import type { FormAction } from "@/components/tasks/types";
import { formatDate, type DatePrefs } from "@/components/dates";
import { CATEGORY_LABEL, KIND_LABEL, formatGBP } from "./format";
import { groupByCategory } from "./ExpenseList";
import { FigureCheckForm } from "./FigureCheckForm";

const formatAmount = (r: HouseholdRecord) =>
  r.unit === "kWh" ? `${(r.amount as number).toLocaleString("en-GB")} kWh` : formatGBP(r.amount as number);

/** Every recorded figure that nobody has checked yet, with a way to confirm or correct it. */
export function FigureCheckList({
  records,
  action,
  datePrefs,
}: {
  records: readonly HouseholdRecord[] | null;
  action: FormAction;
  datePrefs?: DatePrefs;
}) {
  if (records === null) return <p className="text-sm text-muted">Could not load this right now.</p>;
  const withAmount = records.filter((r) => r.amount !== null);
  const todo = withAmount.filter((r) => !r.verified);
  const done = withAmount.length - todo.length;
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-sm font-medium" data-testid="figure-progress">
        {done} of {withAmount.length} figures checked
      </p>
      {withAmount.length === 0 ? (
        <p className="text-sm text-muted">No figures recorded yet.</p>
      ) : todo.length === 0 ? (
        <p className="text-sm text-muted">All figures are checked.</p>
      ) : (
        groupByCategory(todo).map((g) => (
          <section key={g.category} aria-label={CATEGORY_LABEL[g.category]} className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-base font-semibold">{CATEGORY_LABEL[g.category]}</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {g.items.map((r) => (
                <li key={r.id} data-testid="figure-row" className="rounded-md bg-surface-muted px-3 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.provider && <strong className="min-w-0 break-words">{r.provider}</strong>}
                    <span className="min-w-0 break-words">{r.title}</span>
                  </div>
                  <p className="mt-1">
                    Recorded as <strong>{formatAmount(r)}</strong>
                    {r.frequency && <span className="text-muted"> {r.frequency}</span>}
                    {r.amount_kind && <span className="text-muted"> ({KIND_LABEL[r.amount_kind].toLowerCase()})</span>}
                  </p>
                  {(r.source || r.as_of) && (
                    <p className="mt-1 text-xs text-muted break-words">
                      {r.source && <>From {r.source}</>}
                      {r.source && r.as_of && ", "}
                      {r.as_of && <>as of {formatDate(r.as_of, datePrefs)}</>}
                    </p>
                  )}
                  <FigureCheckForm action={action} id={r.id} amount={r.amount as number} unit={r.unit ?? "GBP"} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
