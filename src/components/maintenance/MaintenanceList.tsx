import { formatDate, type DatePrefs } from "@/components/dates";
import { RowAction } from "@/components/tasks/RowAction";
import { BTN_SECONDARY } from "@/components/tasks/styles";
import type { FormAction } from "@/components/tasks/types";
import { DoneForm } from "./DoneForm";
import { ItemForm } from "./ItemForm";
import { LazyDetails } from "@/components/LazyDetails";
import { trafficLight } from "@/components/status";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  describeInterval, groupMaintenance, SEASON_LABEL, type MaintenanceItem, type MaintenanceLog,
} from "./model";

export type MaintenanceActions = { update: FormAction; remove: FormAction; done: FormAction };

const gbp = (n: number) => `£${n.toFixed(2)}`;

function ItemRow({
  item, log, today, actions, datePrefs,
}: { item: MaintenanceItem; log: readonly MaintenanceLog[]; today: string; actions: MaintenanceActions; datePrefs?: DatePrefs }) {
  const meta = [
    item.area,
    describeInterval(item.interval_months),
    item.season ? SEASON_LABEL[item.season] : null,
    item.provider,
    item.next_due_on ? `Due ${formatDate(item.next_due_on, datePrefs)}` : "No date set",
    item.last_done_on ? `Last done ${formatDate(item.last_done_on, datePrefs)}` : "Not logged yet",
  ].filter(Boolean);
  return (
    <li data-testid="maintenance-row" className="rounded-md bg-surface-muted px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{item.title}</p>
        {item.next_due_on && <StatusPill light={trafficLight("maintenance", item.next_due_on, today)} />}
      </div>
      <p className="text-sm text-muted">{meta.join(" · ")}</p>
      {item.notes && <p className="mt-1 whitespace-pre-line text-sm">{item.notes}</p>}
      <div className="mt-2">
        <DoneForm action={actions.done} id={item.id} today={today} />
      </div>
      <details className="mt-2" data-testid="maintenance-history">
        <summary className={`${BTN_SECONDARY} inline-flex cursor-pointer items-center`}>History ({log.length})</summary>
        {log.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing logged yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {log.map((l) => (
              <li key={l.id}>
                <strong>{formatDate(l.done_on, datePrefs)}</strong>
                {l.cost_gbp !== null ? ` · ${gbp(l.cost_gbp)}` : ""}
                {l.notes ? ` · ${l.notes}` : ""}
              </li>
            ))}
          </ul>
        )}
      </details>
      <LazyDetails className="mt-2" summaryClassName={`${BTN_SECONDARY} inline-flex cursor-pointer items-center`} summary="Edit or delete">
        <div className="mt-3 flex flex-col gap-3">
          <ItemForm action={actions.update} item={item} submitLabel="Save changes" />
          <details>
            <summary className="min-h-[var(--touch-target)] cursor-pointer py-2 text-sm font-medium">Delete this item</summary>
            <p className="mb-2 text-sm text-muted">This also deletes its history and cannot be undone.</p>
            <RowAction action={actions.remove} id={item.id} label="Confirm delete" variant="danger" />
          </details>
        </div>
      </LazyDetails>
    </li>
  );
}

export function MaintenanceList({
  items, log, logUnavailable, today, actions, datePrefs,
}: {
  items: readonly MaintenanceItem[];
  log: readonly MaintenanceLog[];
  logUnavailable?: boolean;
  today: string;
  actions: MaintenanceActions;
  datePrefs?: DatePrefs;
}) {
  const g = groupMaintenance(items, today);
  const sections: [string, MaintenanceItem[]][] = [
    ["Overdue", g.overdue],
    ["Due in the next 30 days", g.soon],
    ["Later", g.later],
    ["No date set", g.noDate],
  ];
  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 && (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
          Nothing here yet. Add an item above, or pick from the suggested checklist below.
        </p>
      )}
      {logUnavailable && (
        <p role="alert" className="text-sm font-medium text-warning-fg">History could not be loaded right now.</p>
      )}
      {sections.map(([title, list]) =>
        list.length === 0 ? null : (
          <section key={title} aria-label={title} data-testid="maintenance-group" className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-base font-semibold">{title} <span className="font-normal text-muted">({list.length})</span></h2>
            <ul className="mt-3 flex flex-col gap-2">
              {list.map((i) => (
                <ItemRow key={i.id} item={i} log={log.filter((l) => l.item_id === i.id)} today={today} actions={actions} datePrefs={datePrefs} />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
