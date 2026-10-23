"use client";

import { useActionState } from "react";
import { ROOM_LIMITS } from "@/contracts/rooms";
import type { FormAction } from "@/components/tasks/types";
import { BTN_PRIMARY, FIELD, LABEL } from "@/components/tasks/styles";

export function RoomNotesForm({ action, roomId, notes }: { action: FormAction; roomId: string; notes: string | null }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={roomId} />
      <label className={LABEL}>
        Measurements, paint colours and other notes
        <textarea name="notes" rows={5} maxLength={ROOM_LIMITS.notes} defaultValue={notes ?? ""} className={FIELD} />
      </label>
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Saved.</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>Save notes</button>
    </form>
  );
}
