"use client";

import { useActionState, useEffect, useRef } from "react";
import type { FormAction } from "@/components/tasks/types";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL } from "@/components/tasks/styles";
import { MAINT_LIMITS } from "./constants";

/** "Done today" with an optional note and cost. The date defaults to today but can be changed. */
export function DoneForm({ action, id, today }: { action: FormAction; id: string; today: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <details>
      <summary className={`${BTN_SECONDARY} inline-flex cursor-pointer items-center`}>Done today</summary>
      <form ref={ref} action={formAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="id" value={id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={LABEL}>
            Date done
            <input type="date" name="done_on" required defaultValue={today} max={today} className={FIELD} />
          </label>
          <label className={LABEL}>
            Cost in pounds (optional)
            <input type="number" name="cost_gbp" min={0} step="0.01" inputMode="decimal" className={FIELD} />
          </label>
        </div>
        <label className={LABEL}>
          Note (optional)
          <textarea name="notes" rows={2} maxLength={MAINT_LIMITS.logNotes} className={FIELD} />
        </label>
        {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
        {state?.ok && <p role="status" className="text-sm text-muted">Logged.</p>}
        <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>Save as done</button>
      </form>
    </details>
  );
}
