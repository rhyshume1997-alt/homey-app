import { requireSession } from "@/server/auth/session";
import { listWishlist, listWishlistRooms } from "@/server/data/wishlist";
import { WishlistView } from "@/components/wishlist/WishlistView";
import { parseFilter } from "@/components/wishlist/types";
import {
  addWishlistItemAction, removeWishlistItemAction, setWishlistStatusAction, updateWishlistItemAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function ThingsToGetPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireSession();
  const { status } = await searchParams;
  const [items, rooms] = await Promise.all([listWishlist(), listWishlistRooms()]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Things to get</h1>
      {items.ok && rooms.ok ? (
        <WishlistView
          items={items.data}
          rooms={rooms.data}
          filter={parseFilter(status)}
          actions={{
            add: addWishlistItemAction,
            update: updateWishlistItemAction,
            setStatus: setWishlistStatusAction,
            remove: removeWishlistItemAction,
          }}
        />
      ) : (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
          {items.ok ? (rooms.ok ? "" : rooms.error) : items.error}
        </p>
      )}
    </div>
  );
}
