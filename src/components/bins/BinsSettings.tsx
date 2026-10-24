"use client";

import { useActionState, useState } from "react";
import type { FormAction } from "@/components/tasks/types";
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL } from "@/components/tasks/styles";
import { BIN_COLOURS, BIN_LIMITS, type BinSchedule } from "./schedule";
import { FIND_COUNCIL_URL } from "./council-url";

export type BinsActions = { saveUrl: FormAction; saveSchedule: FormAction; remove: FormAction };

const LINK = "inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-base font-medium underline";
const COLOUR_DOT: Record<string, string> = {
  black: "#111827", blue: "#2563eb", green: "#16a34a", brown: "#92400e", grey: "#6b7280", purple: "#7c3aed", red: "#dc2626", yellow: "#eab308",
};

function Msg({ state }: { state: { ok?: boolean; error?: string } | null }) {
  return (
    <>
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Saved.</p>}
    </>
  );
}

function CouncilLink({ url, action }: { url: string | null; action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <section aria-label="Your council's bin page" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-lg font-semibold">Your council&apos;s bin page</h2>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className={`${BTN_PRIMARY} inline-flex items-center justify-center self-start`}>
          Your council&apos;s bin page
        </a>
      ) : (
        <p className="text-sm text-muted">Save the link to your council&apos;s bin page and it will be one tap away.</p>
      )}
      <form action={formAction} className="flex flex-col gap-2">
        <label className={LABEL}>
          {url ? "Change the link" : "Council bin page link"}
          <input
            name="council_url" type="url" inputMode="url" autoComplete="off" maxLength={BIN_LIMITS.url}
            defaultValue={url ?? ""} placeholder="https://" className={FIELD}
          />
        </label>
        <Msg state={state} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={BTN_PRIMARY}>Save link</button>
        </div>
        <p className="text-sm text-muted">Leave it blank and save to remove the link.</p>
      </form>
      <a href={FIND_COUNCIL_URL} target="_blank" rel="noopener noreferrer" className={`${LINK} self-start`}>
        Find your council&apos;s bin day
      </a>
    </section>
  );
}

function ScheduleForm({ schedule, action, submitLabel, onDone }: { schedule?: BinSchedule; action: FormAction; submitLabel: string; onDone?: () => void }) {
  const [state, formAction, pending] = useActionState(async (p: Parameters<FormAction>[0], fd: FormData) => {
    const r = await action(p, fd);
    if (r?.ok) onDone?.();
    return r;
  }, null);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {schedule && <input type="hidden" name="id" value={schedule.id} />}
      <label className={LABEL}>
        Bin name
        <input name="bin_name" required maxLength={BIN_LIMITS.name} defaultValue={schedule?.bin_name} placeholder="Recycling" className={FIELD} />
      </label>
      <label className={LABEL}>
        Colour
        <select name="colour" defaultValue={schedule?.colour ?? "green"} className={FIELD}>
          {BIN_COLOURS.map((c) => <option key={c} value={c}>{c[0]!.toUpperCase() + c.slice(1)}</option>)}
        </select>
      </label>
      <label className={LABEL}>
        A collection day (any one, past or future)
        <input name="first_date" type="date" required defaultValue={schedule?.first_date} className={FIELD} />
      </label>
      <label className={LABEL}>
        Collected every
        <select name="every_weeks" defaultValue={String(schedule?.every_weeks ?? 1)} className={FIELD}>
          {Array.from({ length: BIN_LIMITS.every }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n === 1 ? "week" : `${n} weeks`}</option>
          ))}
        </select>
      </label>
      <Msg state={state} />
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>{submitLabel}</button>
    </form>
  );
}

function RemoveForm({ id, action }: { id: string; action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className={BTN_DANGER}>Confirm remove</button>
      {state?.error && <p role="alert" className="text-sm text-warning-fg">{state.error}</p>}
    </form>
  );
}

function ScheduleItem({ schedule, actions }: { schedule: BinSchedule; actions: BinsActions }) {
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0 rounded-full border border-border" style={{ backgroundColor: COLOUR_DOT[schedule.colour] }} />
        <p className="min-w-0 break-words text-base font-semibold">{schedule.bin_name}</p>
      </div>
      <p className="text-sm text-muted">
        {schedule.colour[0]!.toUpperCase() + schedule.colour.slice(1)}, every {schedule.every_weeks === 1 ? "week" : `${schedule.every_weeks} weeks`}
      </p>
      {mode === "view" && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode("edit")} className={BTN_SECONDARY}>Edit</button>
          <button type="button" onClick={() => setMode("remove")} className={BTN_SECONDARY}>Remove</button>
        </div>
      )}
      {mode === "edit" && (
        <div className="mt-3 flex flex-col gap-2">
          <ScheduleForm schedule={schedule} action={actions.saveSchedule} submitLabel="Save changes" onDone={() => setMode("view")} />
          <button type="button" onClick={() => setMode("view")} className={`${BTN_SECONDARY} self-start`}>Cancel</button>
        </div>
      )}
      {mode === "remove" && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm">Remove {schedule.bin_name}?</p>
          <RemoveForm id={schedule.id} action={actions.remove} />
          <button type="button" onClick={() => setMode("view")} className={`${BTN_SECONDARY} self-start`}>Cancel</button>
        </div>
      )}
    </li>
  );
}

export function BinsSettings({ councilUrl, schedules, actions }: { councilUrl: string | null; schedules: readonly BinSchedule[]; actions: BinsActions }) {
  return (
    <div className="flex flex-col gap-4">
      <CouncilLink url={councilUrl} action={actions.saveUrl} />
      <section aria-label="Your bins" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Your bins</h2>
        {schedules.length === 0 ? (
          <p className="text-sm text-muted">Add your bins once and the next collections appear here and on the home page.</p>
        ) : (
          <ul aria-label="Bin schedules" className="flex flex-col gap-2">
            {schedules.map((s) => <ScheduleItem key={s.id} schedule={s} actions={actions} />)}
          </ul>
        )}
        <details className="rounded-lg border border-border bg-surface p-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-base font-semibold">Add a bin</summary>
          <div className="mt-3">
            <ScheduleForm action={actions.saveSchedule} submitLabel="Add bin" />
          </div>
        </details>
      </section>
    </div>
  );
}
