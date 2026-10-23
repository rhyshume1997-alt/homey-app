"use client";

import { useActionState } from "react";
import { EMERGENCY_LIMITS, phoneHref, type EmergencyItem } from "@/contracts/emergency";
import { ActionButton } from "@/components/shopping/ActionButton";
import { BTN_PRIMARY, FIELD, LABEL } from "@/components/tasks/styles";
import { NOT_SET, type EmergencyActions } from "./types";

function EditForm({ item, action }: { item: EmergencyItem; action: EmergencyActions["update"] }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="mt-2 flex flex-col gap-3">
      <input type="hidden" name="id" value={item.id} />
      <label className={LABEL}>
        Name
        <input name="label" defaultValue={item.label} required maxLength={EMERGENCY_LIMITS.label} className={FIELD} />
      </label>
      <label className={LABEL}>
        Details
        <textarea name="detail" defaultValue={item.detail} required maxLength={EMERGENCY_LIMITS.detail} rows={2} className={FIELD} />
      </label>
      {state?.error && <p role="alert" className="text-base font-medium text-warning-fg">{state.error}</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`} aria-label={`Save ${item.label}`}>
        Save
      </button>
    </form>
  );
}

export function EmergencyItemRow({ item, actions, step }: { item: EmergencyItem; actions: EmergencyActions; step?: number }) {
  const tel = item.section === "number" ? phoneHref(item.detail) : null;
  const notSet = item.detail === NOT_SET;
  return (
    <li data-testid="emergency-row" className="flex flex-col gap-1 rounded-md bg-surface-muted px-4 py-3">
      <p className="text-lg font-semibold">
        {step !== undefined && <span className="mr-2">{step}.</span>}
        {item.label}
      </p>
      {tel ? (
        <a
          href={tel}
          aria-label={`Call ${item.label} on ${item.detail}`}
          className="inline-flex min-h-[var(--touch-target)] items-center text-xl font-semibold text-foreground underline"
        >
          {item.detail}
        </a>
      ) : (
        <p className={notSet ? "text-lg text-muted" : "text-lg"}>{item.detail}</p>
      )}
      <details className="mt-1">
        <summary className="flex min-h-[var(--touch-target)] cursor-pointer items-center text-base font-medium">
          Edit {item.label}
        </summary>
        <EditForm item={item} action={actions.update} />
      </details>
      <details>
        <summary className="flex min-h-[var(--touch-target)] cursor-pointer items-center text-base font-medium">
          Remove {item.label}
        </summary>
        <ActionButton
          action={actions.remove}
          id={item.id}
          label="Confirm remove"
          ariaLabel={`Confirm remove ${item.label}`}
          variant="danger"
        />
      </details>
    </li>
  );
}
