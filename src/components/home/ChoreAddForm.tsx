"use client";

import { useActionState, useEffect, useRef } from "react";
import { TASK_LIMITS } from "@/contracts/limits";
import type { FormAction, MemberOption } from "@/components/tasks/types";
import { BTN_PRIMARY, FIELD, LABEL } from "@/components/tasks/styles";

/** Quick "add a chore" form. Posts the normal task fields to the existing create action. */
export function ChoreAddForm({ action, members, today }: { action: FormAction; members: readonly MemberOption[]; today: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} aria-label="Add a chore" className="flex flex-col gap-3">
      <input type="hidden" name="due_date" value={today} />
      <label className={LABEL}>
        Chore
        <input name="title" required maxLength={TASK_LIMITS.title} className={FIELD} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          Who
          <select name="assignee_user_id" defaultValue="" className={FIELD}>
            <option value="">Anyone</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          Repeat
          <select name="recurrence" defaultValue="none" className={FIELD}>
            <option value="none">No repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
      </div>
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Chore added.</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>Add chore</button>
    </form>
  );
}
