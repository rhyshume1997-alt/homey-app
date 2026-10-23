"use client";

import { useActionState, useEffect, useRef } from "react";
import type { FormAction } from "@/components/tasks/types";
import { BTN_PRIMARY, FIELD, LABEL } from "@/components/tasks/styles";

export function EventForm({
  action, defaultDate, rooms,
}: { action: FormAction; defaultDate: string; rooms: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <details className="rounded-md border border-border bg-surface">
      <summary className="flex min-h-[var(--touch-target)] cursor-pointer items-center px-4 text-base font-semibold">
        + Event
      </summary>
      <form ref={ref} action={formAction} className="flex flex-col gap-3 px-4 pb-4">
        <label className={LABEL}>
          Title
          <input name="title" required maxLength={120} className={FIELD} />
        </label>
        <label className={LABEL}>
          Date
          <input name="starts_on" type="date" required defaultValue={defaultDate} className={FIELD} />
        </label>
        <label className={LABEL}>
          Time (optional)
          <input name="starts_at" type="time" className={FIELD} />
        </label>
        <label className={LABEL}>
          Room (optional)
          <select name="room_id" defaultValue="" className={FIELD}>
            <option value="">No room</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
        {state?.ok && <p role="status" className="text-sm font-medium text-success-fg">Event added.</p>}
        <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>Add event</button>
      </form>
    </details>
  );
}
