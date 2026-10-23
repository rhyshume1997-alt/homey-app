import { formatDate, type DatePrefs } from "@/components/dates";
import { ActionButton } from "./ActionButton";
import { AddForm } from "./AddForm";
import { SHOPPING_LIMITS, type ShoppingActions, type ShoppingItem } from "./types";

const detail = (i: ShoppingItem) => [i.quantity, i.shop].filter(Boolean).join(" · ");

function Row({ item, actions, datePrefs }: { item: ShoppingItem; actions: ShoppingActions; datePrefs?: DatePrefs }) {
  return (
    <li data-testid="shopping-row" className="flex flex-wrap items-center gap-2 rounded-md bg-surface-muted px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className={`font-medium ${item.done ? "text-muted line-through" : ""}`}>{item.title}</p>
        {detail(item) && <p className="text-sm text-muted">{detail(item)}</p>}
        {item.done && item.done_at && <p className="text-sm text-muted">Bought {formatDate(item.done_at, datePrefs)}</p>}
      </div>
      <ActionButton
        action={actions.toggle}
        id={item.id}
        extra={{ done: item.done ? "false" : "true" }}
        label={item.done ? "Undo" : "Bought"}
        ariaLabel={item.done ? `Undo bought: ${item.title}` : `Mark bought: ${item.title}`}
      />
      <ActionButton action={actions.remove} id={item.id} label="Remove" ariaLabel={`Remove ${item.title}`} variant="danger" />
    </li>
  );
}

export function ShoppingSection({
  items,
  actions,
  datePrefs,
}: {
  items: readonly ShoppingItem[];
  actions: ShoppingActions;
  datePrefs?: DatePrefs;
}) {
  const open = items.filter((i) => !i.done);
  const bought = items.filter((i) => i.done);
  return (
    <section aria-label="Shopping list" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-lg font-semibold">Shopping list</h2>
      <AddForm
        action={actions.add}
        submitLabel="Add to list"
        fields={[
          { name: "title", label: "Item", maxLength: SHOPPING_LIMITS.title, required: true },
          { name: "quantity", label: "Quantity", maxLength: SHOPPING_LIMITS.quantity },
          { name: "shop", label: "Shop", maxLength: SHOPPING_LIMITS.shop },
        ]}
      />
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing on the list yet.</p>
      ) : (
        <>
          {open.length === 0 ? (
            <p className="text-sm text-muted">Nothing left to buy.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {open.map((i) => <Row key={i.id} item={i} actions={actions} datePrefs={datePrefs} />)}
            </ul>
          )}
          {bought.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">Bought ({bought.length})</h3>
              <ul className="flex flex-col gap-2">
                {bought.map((i) => <Row key={i.id} item={i} actions={actions} datePrefs={datePrefs} />)}
              </ul>
              <ActionButton action={actions.clearBought} label="Clear bought" className="self-start" />
            </div>
          )}
        </>
      )}
    </section>
  );
}
