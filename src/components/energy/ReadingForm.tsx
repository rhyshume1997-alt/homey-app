"use client";

import { useActionState, useEffect, useRef } from "react";
import type { FormAction } from "@/components/tasks/types";
import { BTN_PRIMARY, FIELD, LABEL } from "@/components/tasks/styles";
import { METER_LIMITS } from "@/contracts/meter-readings";

export function ReadingForm({ action, today }: { action: FormAction; today: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3" aria-label="Add a meter reading">
      <label className={LABEL}>
        Fuel
        <select name="fuel" required className={FIELD} defaultValue="electricity">
          <option value="electricity">Electricity</option>
          <option value="gas">Gas</option>
        </select>
      </label>
      <label className={LABEL}>
        Date read
        <input name="read_on" type="date" required max={today} defaultValue={today} className={FIELD} />
      </label>
      <label className={LABEL}>
        Reading
        <input name="value" type="text" inputMode="decimal" required className={FIELD} />
      </label>
      <label className={LABEL}>
        Unit
        <select name="unit" required className={FIELD} defaultValue="kWh">
          <option value="kWh">kWh</option>
          <option value="m3">m3 (gas volume)</option>
        </select>
      </label>
      <label className={LABEL}>
        Note (optional)
        <input name="note" maxLength={METER_LIMITS.note} className={FIELD} />
      </label>
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>Save reading</button>
    </form>
  );
}
