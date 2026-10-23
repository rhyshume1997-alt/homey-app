"use client";

import { useActionState } from "react";
import type { FormAction } from "@/components/tasks/types";
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY } from "@/components/tasks/styles";

/** A single-button form with optional id and extra hidden fields. Shows a fixed failure message. */
export function ActionButton({
  action,
  id,
  extra,
  label,
  ariaLabel,
  variant = "secondary",
  pressed,
  className = "",
}: {
  action: FormAction;
  id?: string;
  extra?: Record<string, string>;
  label: string;
  ariaLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  pressed?: boolean;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const cls = variant === "danger" ? BTN_DANGER : variant === "primary" ? BTN_PRIMARY : BTN_SECONDARY;
  return (
    <form action={formAction} className={`flex flex-col gap-1 ${className}`}>
      {id && <input type="hidden" name="id" value={id} />}
      {extra && Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" disabled={pending} aria-label={ariaLabel} aria-pressed={pressed} className={cls}>
        {label}
      </button>
      {state?.error && <p role="alert" className="text-sm text-warning-fg">{state.error}</p>}
    </form>
  );
}
