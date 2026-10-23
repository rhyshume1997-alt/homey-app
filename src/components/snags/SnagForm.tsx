"use client";

import { useActionState, useEffect, useRef } from "react";
import { SNAG_LIMITS } from "@/contracts/limits";
import type { Snag } from "@/contracts/snags";
import type { FormAction } from "@/components/tasks/types";
import { RoomPicker, type RoomOption } from "@/components/rooms/RoomPicker";
import { BTN_PRIMARY, FIELD, LABEL } from "@/components/tasks/styles";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_ORDER } from "./group";

export function SnagForm({
  action,
  snag,
  submitLabel,
  rooms,
}: {
  action: FormAction;
  snag?: Snag;
  submitLabel: string;
  /** Rooms for the optional picker. Omit on pages that have not loaded rooms. */
  rooms?: readonly RoomOption[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const editing = Boolean(snag);
  useEffect(() => {
    if (state?.ok && !editing) ref.current?.reset();
  }, [state, editing]);

  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3">
      {snag && <input type="hidden" name="id" value={snag.id} />}
      <label className={LABEL}>
        Title
        <input name="title" required maxLength={SNAG_LIMITS.title} defaultValue={snag?.title} className={FIELD} />
      </label>
      <label className={LABEL}>
        Location
        <input name="location" maxLength={SNAG_LIMITS.location} defaultValue={snag?.location ?? ""} className={FIELD} />
      </label>
      <label className={LABEL}>
        Notes
        <textarea name="notes" rows={2} maxLength={SNAG_LIMITS.notes} defaultValue={snag?.notes ?? ""} className={FIELD} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          Status
          <select name="status" defaultValue={snag?.status ?? "open"} className={FIELD}>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          Priority
          <select name="priority" defaultValue={snag?.priority ?? "medium"} className={FIELD}>
            {(["high", "medium", "low"] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </label>
      </div>
      <RoomPicker rooms={rooms} value={snag?.room_id} />
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Saved.</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>{submitLabel}</button>
    </form>
  );
}
