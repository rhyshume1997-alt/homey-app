import { formatDate, type DatePrefs } from "@/components/dates";
import { ActionButton } from "./ActionButton";
import { AddForm } from "./AddForm";
import { SUPPLY_LIMITS, SUPPLY_STATUSES, SUPPLY_STATUS_LABEL, sortSupplies, type Supply, type SupplyActions } from "./types";

function Row({ supply, actions, datePrefs }: { supply: Supply; actions: SupplyActions; datePrefs?: DatePrefs }) {
  return (
    <li data-testid="supply-row" className="rounded-md bg-surface-muted px-3 py-3">
      <p className="font-medium">{supply.name}</p>
      {supply.location && <p className="text-sm text-muted">{supply.location}</p>}
      {supply.notes && <p className="text-sm">{supply.notes}</p>}
      <p className="text-sm text-muted">
        {supply.last_checked_at ? `Status last set ${formatDate(supply.last_checked_at, datePrefs)}` : "Status not changed yet"}
      </p>
      <div role="group" aria-label={`Stock level for ${supply.name}`} className="mt-2 grid grid-cols-3 gap-2">
        {SUPPLY_STATUSES.map((s) => (
          <ActionButton
            key={s}
            action={actions.setStatus}
            id={supply.id}
            extra={{ status: s }}
            label={SUPPLY_STATUS_LABEL[s]}
            ariaLabel={`Set ${supply.name} to ${SUPPLY_STATUS_LABEL[s]}`}
            pressed={supply.status === s}
            variant={supply.status === s ? "primary" : "secondary"}
          />
        ))}
      </div>
      <details className="mt-2">
        <summary className="min-h-[var(--touch-target)] cursor-pointer py-2 text-sm font-medium">Remove {supply.name}</summary>
        <ActionButton
          action={actions.remove}
          id={supply.id}
          label="Confirm remove"
          ariaLabel={`Confirm remove ${supply.name}`}
          variant="danger"
        />
      </details>
    </li>
  );
}

export function SuppliesSection({
  supplies,
  actions,
  datePrefs,
}: {
  supplies: readonly Supply[];
  actions: SupplyActions;
  datePrefs?: DatePrefs;
}) {
  const sorted = sortSupplies(supplies);
  return (
    <section aria-label="Supplies" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-lg font-semibold">Supplies</h2>
      <p className="text-sm text-muted">Stock levels are only what you set here.</p>
      <AddForm
        action={actions.add}
        submitLabel="Add supply"
        fields={[
          { name: "name", label: "Supply", maxLength: SUPPLY_LIMITS.name, required: true },
          { name: "location", label: "Where it is kept", maxLength: SUPPLY_LIMITS.location },
        ]}
      />
      {supplies.some((s) => s.status !== "ok") && (
        <ActionButton action={actions.addLowToShopping} label="Add low/out items to shopping list" className="self-start" />
      )}
      {sorted.length === 0 ? (
        <p className="text-sm text-muted">No supplies tracked yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((s) => <Row key={s.id} supply={s} actions={actions} datePrefs={datePrefs} />)}
        </ul>
      )}
    </section>
  );
}
