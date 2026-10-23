"use client";

import { useActionState, useEffect, useRef } from "react";
import { EMERGENCY_LIMITS, EMERGENCY_SECTIONS, EMERGENCY_SECTION_TITLE } from "@/contracts/emergency";
import { BTN_PRIMARY, FIELD, LABEL } from "@/components/tasks/styles";
import type { FormAction } from "@/components/tasks/types";

export function AddEmergencyForm({ action, defaultSection }: { action: FormAction; defaultSection?: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3">
      <label className={LABEL}>
        Section
        <select name="section" defaultValue={defaultSection ?? "location"} className={FIELD}>
          {EMERGENCY_SECTIONS.map((s) => (
            <option key={s} value={s}>{EMERGENCY_SECTION_TITLE[s]}</option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        Name
        <input name="label" required maxLength={EMERGENCY_LIMITS.label} placeholder="Stopcock" className={FIELD} />
      </label>
      <label className={LABEL}>
        Details
        <textarea name="detail" required maxLength={EMERGENCY_LIMITS.detail} rows={2} placeholder="Under the stairs" className={FIELD} />
      </label>
      {state?.error && <p role="alert" className="text-base font-medium text-warning-fg">{state.error}</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>Add to emergency card</button>
    </form>
  );
}
