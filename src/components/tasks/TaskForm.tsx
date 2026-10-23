"use client";

import { useActionState, useEffect, useRef } from "react";
import { TASK_LIMITS } from "@/contracts/limits";
import type { Task } from "@/contracts/tasks";
import type { FormAction, MemberOption } from "./types";
import { RoomPicker, type RoomOption } from "@/components/rooms/RoomPicker";
import { BTN_PRIMARY, FIELD, LABEL } from "./styles";

export function TaskForm({
  action,
  members,
  task,
  submitLabel,
  rooms,
}: {
  action: FormAction;
  members: readonly MemberOption[];
  task?: Task;
  submitLabel: string;
  /** Rooms for the optional picker. Omit on pages that have not loaded rooms. */
  rooms?: readonly RoomOption[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const editing = Boolean(task);
  useEffect(() => {
    if (state?.ok && !editing) ref.current?.reset();
  }, [state, editing]);

  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3">
      {task && <input type="hidden" name="id" value={task.id} />}
      <label className={LABEL}>
        Title
        <input name="title" required maxLength={TASK_LIMITS.title} defaultValue={task?.title} className={FIELD} />
      </label>
      <label className={LABEL}>
        Notes
        <textarea name="notes" rows={2} maxLength={TASK_LIMITS.notes} defaultValue={task?.notes ?? ""} className={FIELD} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={LABEL}>
          Assigned to
          <select name="assignee_user_id" defaultValue={task?.assignee_user_id ?? ""} className={FIELD}>
            <option value="">Either</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Due date
          <input type="date" name="due_date" defaultValue={task?.due_date ?? ""} className={FIELD} />
        </label>
        <label className={LABEL}>
          Repeats
          <select name="recurrence" defaultValue={task?.recurrence ?? "none"} className={FIELD}>
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
      </div>
      <RoomPicker rooms={rooms} value={task?.room_id} />
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Saved.</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>{submitLabel}</button>
    </form>
  );
}
