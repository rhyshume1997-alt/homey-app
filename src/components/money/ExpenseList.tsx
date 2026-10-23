import type { HouseholdRecord } from "@/contracts/records";
import type { FormAction } from "@/components/tasks/types";
import { CATEGORY_LABEL, KIND_LABEL, expenseRecords, formatGBP } from "./format";
import { VerifyButton } from "./VerifyButton";

export function groupByCategory(rows: readonly HouseholdRecord[]) {
  const map = new Map<HouseholdRecord["category"], HouseholdRecord[]>();
  for (const r of rows) map.set(r.category, [...(map.get(r.category) ?? []), r]);
  return [...map.entries()]
    .sort((a, b) => CATEGORY_LABEL[a[0]].localeCompare(CATEGORY_LABEL[b[0]]))
    .map(([category, items]) => ({ category, items: [...items].sort((a, b) => a.title.localeCompare(b.title)) }));
}

/** Deliberately shows no totals: figures are unverified and frequencies are mixed. */
export function ExpenseList({
  records,
  verifyAction,
}: {
  records: readonly HouseholdRecord[] | null;
  verifyAction: FormAction;
}) {
  const rows = records ? expenseRecords(records) : [];
  return (
    <section aria-label="Bills and budget" className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">Bills and budget</h2>
      {records === null ? (
        <p className="mt-3 text-sm text-muted">Could not load this right now.</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing recorded yet.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {groupByCategory(rows).map((g) => (
            <div key={g.category} data-testid="expense-group">
              <h3 className="text-sm font-semibold">{CATEGORY_LABEL[g.category]}</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {g.items.map((r) => (
                  <li key={r.id} data-testid="expense-row" className="rounded-md bg-surface-muted px-3 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      {r.provider && <strong className="min-w-0 break-words">{r.provider}</strong>}
                      <span className="min-w-0 break-words">{r.title}</span>
                    </div>
                    <p className="mt-1">
                      <strong>{formatGBP(r.amount as number)}</strong>
                      {r.frequency && <span className="text-muted"> {r.frequency}</span>}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {r.amount_kind && (
                        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium">
                          {KIND_LABEL[r.amount_kind]}
                        </span>
                      )}
                      {!r.verified && (
                        <span className="rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-fg">
                          Unverified
                        </span>
                      )}
                    </div>
                    {!r.verified && <VerifyButton action={verifyAction} id={r.id} />}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
