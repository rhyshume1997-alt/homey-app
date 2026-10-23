import { requireSession } from "@/server/auth/session";
import { listShopping, listSupplies } from "@/server/data/shopping";
import { ShoppingSection } from "@/components/shopping/ShoppingSection";
import { SuppliesSection } from "@/components/shopping/SuppliesSection";
import {
  addLowToShoppingAction, addShoppingItemAction, addSupplyAction, clearBoughtAction, removeShoppingItemAction,
  removeSupplyAction, setSupplyStatusAction, toggleShoppingItemAction,
} from "./actions";

export const dynamic = "force-dynamic";

const alertCls = "rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg";

export default async function ShoppingPage() {
  const session = await requireSession();
  const [items, supplies] = await Promise.all([listShopping(), listSupplies()]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Shopping and supplies</h1>
      {items.ok ? (
        <ShoppingSection
          items={items.data}
          datePrefs={session.datePrefs}
          actions={{
            add: addShoppingItemAction,
            toggle: toggleShoppingItemAction,
            remove: removeShoppingItemAction,
            clearBought: clearBoughtAction,
          }}
        />
      ) : (
        <p role="alert" className={alertCls}>{items.error}</p>
      )}
      {supplies.ok ? (
        <SuppliesSection
          supplies={supplies.data}
          datePrefs={session.datePrefs}
          actions={{
            add: addSupplyAction,
            setStatus: setSupplyStatusAction,
            remove: removeSupplyAction,
            addLowToShopping: addLowToShoppingAction,
          }}
        />
      ) : (
        <p role="alert" className={alertCls}>{supplies.error}</p>
      )}
    </div>
  );
}
