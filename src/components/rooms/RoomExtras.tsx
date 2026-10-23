import type { Appliance } from "@/contracts/appliances";
import type { WishlistItem } from "@/contracts/wishlist";
import type { DatePrefs } from "@/components/dates";
import { RoomWishlist } from "@/components/wishlist/RoomWishlist";
import { RoomAppliances } from "@/components/appliances/RoomAppliances";

const ERR = "rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg";
const CARD = "rounded-lg border border-border bg-surface p-4";

/** Result of one soft-failing loader: the data, or a message to show in place of the section. */
export type Soft<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * "Things to get" and "Appliances" for a room. Each section fails soft on its own: a failed load
 * shows a short message instead of that section, never blocks the page and never invents rows.
 */
export function RoomExtras({ wishlist, appliances, today, prefs }: {
  wishlist: Soft<readonly WishlistItem[]>;
  appliances: Soft<Appliance[]>;
  today: string;
  prefs: DatePrefs;
}) {
  return (
    <>
      {wishlist.ok ? (
        <div className={CARD}><RoomWishlist items={wishlist.data} /></div>
      ) : (
        <p role="alert" className={ERR}>Things to get: {wishlist.error}</p>
      )}
      {appliances.ok ? (
        <RoomAppliances appliances={appliances.data} today={today} prefs={prefs} />
      ) : (
        <p role="alert" className={ERR}>Appliances: {appliances.error}</p>
      )}
    </>
  );
}
