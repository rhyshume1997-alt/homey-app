import type { FormAction } from "@/components/tasks/types";

export type WishlistActions = {
  add: FormAction;
  update: FormAction;
  setStatus: FormAction;
  remove: FormAction;
};

export type WishlistFilter = "all" | "idea" | "saving" | "bought";
export const WISHLIST_FILTERS: readonly { id: WishlistFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "idea", label: "Idea" },
  { id: "saving", label: "Saving for" },
  { id: "bought", label: "Bought" },
];

export function parseFilter(v: unknown): WishlistFilter {
  return WISHLIST_FILTERS.some((f) => f.id === v) ? (v as WishlistFilter) : "all";
}
