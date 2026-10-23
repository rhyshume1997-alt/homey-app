"use client";

import { useActionState, useEffect, useRef } from "react";
import type { FormAction } from "@/components/tasks/types";
import { BTN_PRIMARY, FIELD, LABEL } from "@/components/tasks/styles";

export type AddField = { name: string; label: string; maxLength: number; required?: boolean };

export function AddForm({ action, fields, submitLabel }: { action: FormAction; fields: AddField[]; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3">
      {fields.map((f) => (
        <label key={f.name} className={LABEL}>
          {f.label}
          <input name={f.name} required={f.required} maxLength={f.maxLength} className={FIELD} />
        </label>
      ))}
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>{submitLabel}</button>
    </form>
  );
}
