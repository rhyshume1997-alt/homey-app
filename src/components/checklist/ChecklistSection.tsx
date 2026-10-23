"use client";

import { useActionState, useState } from "react";
import { formatDate, type DatePrefs } from "@/components/dates";
import { trafficLight } from "@/components/status";
import { StatusPill } from "@/components/ui/StatusPill";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/components/tasks/styles";
import type { FormAction } from "@/components/tasks/types";
import {
  confirmText, groupBySeason, isCoveredByTask, scheduleLabel, type ChecklistActions, type ChecklistItem,
} from "./types";

function MarkDone({ id, title, action }: { id: string; title: string; action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} aria-label={`Mark ${title} done`} className={BTN_SECONDARY}>
        Mark done
      </button>
      {state?.error && <p role="alert" className="text-sm text-warning-fg">{state.error}</p>}
    </form>
  );
}

function AddTask({ item, today, action, datePrefs }: { item: ChecklistItem; today: string; action: FormAction; datePrefs?: DatePrefs }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: Awaited<ReturnType<FormAction>>, fd: FormData) => {
    const r = await action(prev, fd);
    if (r?.ok) setOpen(false);
    return r;
  }, null);
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className={BTN_SECONDARY} aria-label={`Add ${item.title} to Tasks`} onClick={() => setOpen(true)}>
        + Task
      </button>
      {open && (
        <div role="alertdialog" aria-label={`Confirm adding ${item.title} to Tasks`} className="rounded-md border border-border bg-surface p-3">
          <p className="text-sm font-medium">{confirmText(item, today, datePrefs)}</p>
          <form action={formAction} className="mt-2 flex gap-2">
            <input type="hidden" name="id" value={item.id} />
            <button type="submit" disabled={pending} className={BTN_PRIMARY}>Confirm</button>
            <button type="button" className={BTN_SECONDARY} onClick={() => setOpen(false)}>Cancel</button>
          </form>
        </div>
      )}
      {state?.error && <p role="alert" className="text-sm text-warning-fg">{state.error}</p>}
    </div>
  );
}

export function ChecklistSection({
  items, today, actions, datePrefs,
}: {
  items: readonly ChecklistItem[];
  today: string;
  actions: ChecklistActions;
  datePrefs?: DatePrefs;
}) {
  if (items.length === 0) return <p className="text-sm text-muted">No checklist items yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      {groupBySeason(items, today).map((g) => (
        <section key={g.season} aria-label={g.label} className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{g.label}</h2>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {g.items.map((i) => {
              const covered = isCoveredByTask(i);
              return (
                <li key={i.id} data-testid="checklist-row" className="flex flex-col gap-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{i.title}</p>
                      <p className="text-sm text-muted">
                        {scheduleLabel(i)}
                        {i.last_done_on ? ` · done ${formatDate(i.last_done_on, datePrefs)}` : " · not marked done yet"}
                      </p>
                      {i.notes && <p className="text-sm text-muted">{i.notes}</p>}
                    </div>
                    {!covered && <StatusPill light={trafficLight("checklist", i.next_due_on, today)} />}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <MarkDone id={i.id} title={i.title} action={actions.markDone} />
                    {!covered && <AddTask item={i} today={today} action={actions.addTask} datePrefs={datePrefs} />}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="text-center text-sm text-muted">+ Task proposes a task; it is added only after Confirm.</p>
    </div>
  );
}
