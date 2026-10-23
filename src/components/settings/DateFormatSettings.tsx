"use client";

import { useActionState } from "react";
import {
  DATE_ORDERS,
  MONTH_LABELS,
  MONTH_STYLES,
  ORDER_LABELS,
  formatDate,
  type DatePrefs,
} from "@/components/dates";
import type { SettingsState } from "@/app/(house)/settings-actions";

export function DateFormatSettings({
  prefs,
  example,
  action,
}: {
  prefs: DatePrefs;
  /** ISO date shown as a preview, e.g. today. */
  example: string;
  action: (prev: SettingsState, fd: FormData) => Promise<SettingsState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const field = "min-h-[var(--touch-target)] rounded-md border border-border bg-surface px-3 text-sm";
  return (
    <section aria-labelledby="date-format-heading" className="rounded-lg border border-border bg-surface p-4">
      <h2 id="date-format-heading" className="text-base font-semibold">Date format</h2>
      <p className="mt-1 text-sm text-muted">
        Today shows as <strong data-testid="date-example">{formatDate(example, prefs)}</strong>. Applies to every date in the app, for you only.
      </p>
      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Order
          <select name="date_order" defaultValue={prefs.order} className={field}>
            {DATE_ORDERS.map((o) => <option key={o} value={o}>{ORDER_LABELS[o]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Month
          <select name="date_month" defaultValue={prefs.month} className={field}>
            {MONTH_STYLES.map((m) => <option key={m} value={m}>{MONTH_LABELS[m]}</option>)}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="min-h-[var(--touch-target)] rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-60"
        >
          Save
        </button>
      </form>
      <p role="status" aria-live="polite" className="mt-2 text-sm">
        {state ? state.message : null}
      </p>
    </section>
  );
}
