import type { Snag } from "@/contracts/snags";
import { RowAction } from "@/components/tasks/RowAction";
import type { FormAction } from "@/components/tasks/types";
import { BTN_SECONDARY } from "@/components/tasks/styles";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_ORDER, groupSnags, snagLight } from "./group";
import { SnagForm } from "./SnagForm";
import { LazyDetails } from "@/components/LazyDetails";
import { StatusPill } from "@/components/ui/StatusPill";
import { todayInLondon } from "@/components/tasks/group";
import type { RoomOption } from "@/components/rooms/RoomPicker";

export { STALE_SNAG_DAYS } from "./group";

export type SnagActions = {
  create: FormAction;
  update: FormAction;
  setStatus: FormAction;
  remove: FormAction;
};

const PRIORITY_STYLE: Record<Snag["priority"], string> = {
  high: "border-warning-border bg-warning-bg text-warning-fg",
  medium: "border-border bg-surface text-foreground",
  low: "border-border bg-surface text-muted",
};

function SnagRow({ snag, actions, today, rooms }: { snag: Snag; actions: SnagActions; today: string; rooms?: readonly RoomOption[] }) {
  const pill = snagLight(snag, today);
  const next = STATUS_ORDER.filter((s) => s !== snag.status);
  return (
    <li data-testid="snag-row" className="rounded-md bg-surface-muted px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 font-medium">{snag.title}</p>
        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[snag.priority]}`}>
          {PRIORITY_LABEL[snag.priority]}
        </span>
        <StatusPill light={pill.light} label={pill.label} />
      </div>
      {snag.location && <p className="text-sm text-muted">{snag.location}</p>}
      {snag.notes && <p className="mt-1 whitespace-pre-line text-sm">{snag.notes}</p>}
      <LazyDetails className="mt-2" summaryClassName={`${BTN_SECONDARY} inline-flex cursor-pointer items-center`} summary="Update or delete">
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {next.map((s) => (
              <RowAction key={s} action={actions.setStatus} id={snag.id} label={`Mark ${STATUS_LABEL[s].toLowerCase()}`} extra={{ status: s }} />
            ))}
          </div>
          <SnagForm action={actions.update} rooms={rooms} snag={snag} submitLabel="Save changes" />
          <details>
            <summary className="min-h-[var(--touch-target)] cursor-pointer py-2 text-sm font-medium">Delete this snag</summary>
            <p className="mb-2 text-sm text-muted">This cannot be undone.</p>
            <RowAction action={actions.remove} id={snag.id} label="Confirm delete" variant="danger" />
          </details>
        </div>
      </LazyDetails>
    </li>
  );
}

export function SnagList({ snags, actions, today = todayInLondon(), rooms }: {
  snags: readonly Snag[]; actions: SnagActions; today?: string;
  /** Rooms for the edit forms' picker. Omit and the existing room link is kept unchanged. */
  rooms?: readonly RoomOption[];
}) {
  const g = groupSnags(snags);
  if (snags.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
        No snags logged yet. Add one above when you spot something to fix.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {STATUS_ORDER.filter((s) => g[s].length > 0).map((s) => {
        const rows = g[s].map((sn) => <SnagRow key={sn.id} snag={sn} actions={actions} today={today} rooms={rooms} />);
        const heading = `${STATUS_LABEL[s]} (${g[s].length})`;
        return s === "fixed" ? (
          <details key={s} data-testid="snag-group" aria-label={STATUS_LABEL[s]} className="rounded-lg border border-border bg-surface p-4">
            <summary className="min-h-[var(--touch-target)] cursor-pointer text-base font-semibold">{heading}</summary>
            <ul className="mt-3 flex flex-col gap-2">{rows}</ul>
          </details>
        ) : (
          <section key={s} data-testid="snag-group" aria-label={STATUS_LABEL[s]} className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-base font-semibold">{heading}</h2>
            <ul className="mt-3 flex flex-col gap-2">{rows}</ul>
          </section>
        );
      })}
    </div>
  );
}
