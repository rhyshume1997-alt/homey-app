import type { FormAction } from "@/components/tasks/types";

export const SHOPPING_LIMITS = { title: 120, quantity: 40, shop: 60 } as const;
export const SUPPLY_LIMITS = { name: 80, location: 60, notes: 300 } as const;

export const SUPPLY_STATUSES = ["ok", "low", "out"] as const;
export type SupplyStatus = (typeof SUPPLY_STATUSES)[number];
export const SUPPLY_STATUS_LABEL: Record<SupplyStatus, string> = { ok: "OK", low: "Low", out: "Out" };

export type ShoppingItem = {
  id: string;
  title: string;
  quantity: string | null;
  shop: string | null;
  done: boolean;
  done_at: string | null;
};

export type Supply = {
  id: string;
  name: string;
  location: string | null;
  status: SupplyStatus;
  notes: string | null;
  last_checked_at: string | null;
};

export type ShoppingActions = {
  add: FormAction;
  toggle: FormAction;
  remove: FormAction;
  clearBought: FormAction;
};

export type SupplyActions = {
  add: FormAction;
  setStatus: FormAction;
  remove: FormAction;
  addLowToShopping: FormAction;
};

/** Out first, then low, then ok; names alphabetical inside each group. */
export function sortSupplies<T extends Pick<Supply, "name" | "status">>(list: readonly T[]): T[] {
  const rank = { out: 0, low: 1, ok: 2 } as const;
  return [...list].sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
}
