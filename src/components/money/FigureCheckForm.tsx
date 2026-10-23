"use client";

import { useActionState } from "react";
import type { FormAction } from "@/components/tasks/types";
import { BTN_PRIMARY, FIELD, LABEL } from "@/components/tasks/styles";

/** Confirm a figure as is, or correct it first. Either way it is marked checked. */
export function FigureCheckForm({ action, id, amount, unit }: { action: FormAction; id: string; amount: number; unit: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <label className={LABEL}>
        Correct amount ({unit === "kWh" ? "kWh" : "£"})
        <input name="amount" inputMode="decimal" autoComplete="off" required defaultValue={amount.toFixed(2)} className={FIELD} />
      </label>
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>
        Mark checked
      </button>
      {state?.error && <p role="alert" className="text-sm text-warning-fg">{state.error}</p>}
    </form>
  );
}
