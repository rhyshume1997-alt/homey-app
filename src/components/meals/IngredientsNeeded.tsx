"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/components/tasks/styles";
import { formatDate, type DatePrefs } from "@/components/dates";
import type { FormAction } from "@/components/tasks/types";
import { NEED_LABEL, addDays, formatMoney, isMissing, totalsOf, type NeedStatus, type NeededItem } from "./types";

const LIGHT = { in: "green", low: "amber", need: "red" } as const satisfies Record<NeedStatus, "green" | "amber" | "red">;
const LINK = "min-h-[var(--touch-target)] inline-flex items-center rounded-md border border-border bg-surface px-4 py-2 text-base font-medium";

function AddMissing({ week, missing, action }: { week: string; missing: NeededItem[]; action: FormAction }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, null);
  if (missing.length === 0) return null;
  const done = state?.ok === true;
  return (
    <div className="flex flex-col gap-2">
      {!open && (
        <button type="button" className={`${BTN_PRIMARY} self-start`} onClick={() => setOpen(true)}>
          Add {missing.length} missing to shopping
        </button>
      )}
      {done && <p role="status" className="text-sm font-medium">Added to your shopping list. Items already on it were skipped.</p>}
      {open && (
        <form
          action={formAction}
          role="dialog"
          aria-label="Confirm adding to shopping"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <input type="hidden" name="week" value={week} />
          <p className="font-medium">Add these {missing.length} items to the shopping list?</p>
          <ul className="flex min-w-0 flex-col gap-1 text-sm [overflow-wrap:anywhere]">
            {missing.map((i) => (
              <li key={i.key}>
                <input type="hidden" name="key" value={i.key} />
                {i.name}
                {i.quantity ? ` (${i.quantity})` : ""}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">Nothing is bought. Items already on the open list are skipped.</p>
          {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={BTN_PRIMARY}>Confirm add {missing.length}</button>
            <button type="button" className={BTN_SECONDARY} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function IngredientsNeeded({
  week,
  items,
  addMissing,
  datePrefs,
}: {
  week: string;
  items: NeededItem[];
  addMissing: FormAction;
  datePrefs?: DatePrefs;
}) {
  const totals = totalsOf(items);
  const missing = items.filter(isMissing);
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Week" className="flex flex-wrap items-center gap-2">
        <Link href={`/meals/ingredients?w=${addDays(week, -7)}`} className={LINK}>Previous week</Link>
        <p className="flex-1 text-center font-medium">Week of {formatDate(week, datePrefs)}</p>
        <Link href={`/meals/ingredients?w=${addDays(week, 7)}`} className={LINK}>Next week</Link>
      </nav>
      <Link href={`/meals?w=${week}`} className={`${LINK} self-start`}>Back to the week</Link>

      {items.length === 0 ? (
        <p className="text-muted">No ingredients planned this week. Add ingredients to a meal to see them here.</p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <p data-testid="totals" className="font-semibold">
              {totals.needed} needed · {totals.in} in · {totals.missing} missing
            </p>
            {totals.missing > 0 && (
              <p data-testid="estimate" className="text-sm text-muted">
                {formatMoney(totals.estimate)} est.
                {totals.pricesUnknown > 0 && ` · ${totals.pricesUnknown} ${totals.pricesUnknown === 1 ? "price" : "prices"} unknown`}
              </p>
            )}
            <p className="text-xs text-muted">Stock comes only from your Supplies list. Anything not on it counts as needed.</p>
          </div>
          <ul className="flex flex-col gap-2">
            {items.map((i) => (
              <li key={i.key} data-testid="needed-row" className="flex min-w-0 items-start justify-between gap-3 rounded-md bg-surface-muted px-3 py-3 [overflow-wrap:anywhere]">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {i.name}
                    {i.quantity && <span className="font-normal text-muted"> · {i.quantity}</span>}
                  </p>
                  <p className="text-sm text-muted">{i.meals.join(", ")}</p>
                </div>
                <span className="shrink-0"><StatusPill light={LIGHT[i.status]} label={NEED_LABEL[i.status]} /></span>
              </li>
            ))}
          </ul>
          <AddMissing week={week} missing={missing} action={addMissing} />
        </>
      )}
    </div>
  );
}
