"use client";

import { useActionState, useEffect, useRef } from "react";
import type { FormAction } from "@/components/tasks/types";
import { BTN_PRIMARY, FIELD, LABEL } from "@/components/tasks/styles";
import { MAINT_LIMITS, SEASON_LABEL, SEASONS } from "./constants";
import type { MaintenanceItem } from "./model";

export function ItemForm({ action, item, submitLabel }: { action: FormAction; item?: MaintenanceItem; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const editing = Boolean(item);
  useEffect(() => {
    if (state?.ok && !editing) ref.current?.reset();
  }, [state, editing]);

  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3">
      {item && <input type="hidden" name="id" value={item.id} />}
      <label className={LABEL}>
        What needs doing
        <input name="title" required maxLength={MAINT_LIMITS.title} defaultValue={item?.title} className={FIELD} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          Area
          <input name="area" maxLength={MAINT_LIMITS.area} defaultValue={item?.area ?? ""} className={FIELD} />
        </label>
        <label className={LABEL}>
          Who does it (optional)
          <input name="provider" maxLength={MAINT_LIMITS.provider} defaultValue={item?.provider ?? ""} className={FIELD} />
        </label>
        <label className={LABEL}>
          Repeats every (months, blank for one-off)
          <input
            type="number" name="interval_months" min={1} max={MAINT_LIMITS.maxInterval} inputMode="numeric"
            defaultValue={item?.interval_months ?? ""} className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Best season
          <select name="season" defaultValue={item?.season ?? ""} className={FIELD}>
            <option value="">Any time</option>
            {SEASONS.map((s) => <option key={s} value={s}>{SEASON_LABEL[s]}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          Next due
          <input type="date" name="next_due_on" defaultValue={item?.next_due_on ?? ""} className={FIELD} />
        </label>
      </div>
      <label className={LABEL}>
        Notes
        <textarea name="notes" rows={2} maxLength={MAINT_LIMITS.notes} defaultValue={item?.notes ?? ""} className={FIELD} />
      </label>
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Saved.</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>{submitLabel}</button>
    </form>
  );
}
