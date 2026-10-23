"use client";

import { useActionState } from "react";
import type { FormAction } from "./types";
import { BTN_DANGER, BTN_SECONDARY } from "./styles";

/** A single-button form (complete, reopen, delete, status change) that shows a failure message. */
export function RowAction({
  action,
  id,
  label,
  variant = "secondary",
  extra,
}: {
  action: FormAction;
  id: string;
  label: string;
  variant?: "secondary" | "danger";
  extra?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      {extra && Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" disabled={pending} className={variant === "danger" ? BTN_DANGER : BTN_SECONDARY}>
        {label}
      </button>
      {state?.error && <p role="alert" className="text-sm text-warning-fg">{state.error}</p>}
    </form>
  );
}
