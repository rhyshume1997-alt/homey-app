"use client";

import { useActionState, useState } from "react";
import type { FormAction } from "@/components/tasks/types";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL } from "@/components/tasks/styles";

/** "+ Service task": nothing is created until the person confirms the title and due date. */
export function ServiceTaskButton({ action, applianceId, applianceName }: { action: FormAction; applianceId: string; applianceName: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, null);
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={`${BTN_SECONDARY} self-start`}>+ Service task</button>;
  }
  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md bg-surface-muted p-3" aria-label="Confirm service task">
      <input type="hidden" name="id" value={applianceId} />
      <p className="text-sm">Create the task &ldquo;Service: {applianceName}&rdquo;?</p>
      <label className={LABEL}>
        Due date (optional)
        <input type="date" name="due_date" className={FIELD} />
      </label>
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Task created.</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending || state?.ok === true} className={BTN_PRIMARY}>Create task</button>
        <button type="button" onClick={() => setOpen(false)} className={BTN_SECONDARY}>Cancel</button>
      </div>
    </form>
  );
}
