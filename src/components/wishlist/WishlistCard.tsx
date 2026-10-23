import { ActionButton } from "@/components/shopping/ActionButton";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  WISHLIST_STATUSES, WISHLIST_STATUS_LABEL, formatRoughPrice, type WishlistItem, type WishlistRoom,
} from "@/contracts/wishlist";
import { ShopLink } from "./ShopLink";
import { WishlistForm } from "./WishlistForm";
import type { WishlistActions } from "./types";

export function WishlistCard({
  item, rooms, actions,
}: { item: WishlistItem; rooms: readonly WishlistRoom[]; actions: WishlistActions }) {
  const price = formatRoughPrice(item.price_estimate);
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3" data-status={item.status}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{item.title}</h3>
        <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs font-semibold">
          {WISHLIST_STATUS_LABEL[item.status]}
        </span>
        {item.priority === "high" && item.status !== "bought" && <StatusPill light="amber" label="High priority" />}
      </div>
      {price && <p className="text-sm text-muted">{price}</p>}
      {item.notes && <p className="text-sm text-muted">{item.notes}</p>}
      <ShopLink url={item.url} />
      <div className="flex flex-wrap gap-2">
        {WISHLIST_STATUSES.filter((s) => s !== item.status).map((s) => (
          <ActionButton
            key={s}
            action={actions.setStatus}
            id={item.id}
            extra={{ status: s }}
            label={s === "bought" ? "Mark bought" : s === "saving" ? "Move to Saving for" : "Move to Idea"}
            ariaLabel={`${s === "bought" ? "Mark bought" : s === "saving" ? "Move to Saving for" : "Move to Idea"}: ${item.title}`}
          />
        ))}
        <ActionButton action={actions.remove} id={item.id} label="Delete" ariaLabel={`Delete: ${item.title}`} variant="danger" />
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Edit {item.title}</summary>
        <div className="pt-2">
          <WishlistForm action={actions.update} rooms={rooms} item={item} submitLabel="Save changes" />
        </div>
      </details>
    </li>
  );
}
