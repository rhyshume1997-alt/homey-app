import Link from "next/link";
import { WISHLIST_STATUS_LABEL, formatRoughPrice, type WishlistItem } from "@/contracts/wishlist";
import { ShopLink } from "./ShopLink";

/** Read-only "Things to get" section for the room detail page. Edit on /things-to-get. */
export function RoomWishlist({ items }: { items: readonly WishlistItem[] }) {
  return (
    <section aria-labelledby="room-wishlist-heading" className="flex flex-col gap-2">
      <h2 id="room-wishlist-heading" className="text-lg font-semibold">Things to get</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing to get for this room.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((i) => {
            const price = formatRoughPrice(i.price_estimate);
            return (
              <li key={i.id} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3">
                <span className="text-base font-medium">{i.title}</span>
                <span className="text-sm text-muted">
                  {WISHLIST_STATUS_LABEL[i.status]}
                  {price ? ` · ${price}` : ""}
                </span>
                <ShopLink url={i.url} />
              </li>
            );
          })}
        </ul>
      )}
      <Link href="/things-to-get#new" className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-2">
        Add something to get
      </Link>
      <p className="text-sm text-muted">Links open the shop. Nothing is ever bought automatically.</p>
    </section>
  );
}
