import Link from "next/link";
import type { WishlistItem, WishlistRoom } from "@/contracts/wishlist";
import { WishlistCard } from "./WishlistCard";
import { WishlistForm } from "./WishlistForm";
import { WISHLIST_FILTERS, type WishlistActions, type WishlistFilter } from "./types";

export function groupByRoom(items: readonly WishlistItem[], rooms: readonly WishlistRoom[]) {
  const groups: { key: string; name: string; items: WishlistItem[] }[] = [];
  for (const r of rooms) {
    const list = items.filter((i) => i.room_id === r.id);
    if (list.length) groups.push({ key: r.id, name: r.name, items: list });
  }
  const known = new Set(rooms.map((r) => r.id));
  const rest = items.filter((i) => !i.room_id || !known.has(i.room_id));
  if (rest.length) groups.push({ key: "none", name: "No room", items: rest });
  return groups;
}

export function WishlistView({
  items, rooms, actions, filter = "all",
}: { items: readonly WishlistItem[]; rooms: readonly WishlistRoom[]; actions: WishlistActions; filter?: WishlistFilter }) {
  const shown = filter === "all" ? items : items.filter((i) => i.status === filter);
  const groups = groupByRoom(shown, rooms);
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {WISHLIST_FILTERS.map((f) => (
          <Link
            key={f.id}
            href={f.id === "all" ? "/things-to-get" : `/things-to-get?status=${f.id}`}
            aria-current={f.id === filter ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${
              f.id === filter ? "border-transparent bg-accent text-accent-foreground" : "border-border bg-surface"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-muted">Links open the shop. Nothing is ever bought automatically.</p>
      {groups.length === 0 ? (
        <p className="rounded-md border border-border bg-surface-muted p-4 text-sm">Nothing here yet.</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-labelledby={`room-${g.key}`} className="flex flex-col gap-2">
            <h2 id={`room-${g.key}`} className="text-lg font-semibold">{g.name}</h2>
            <ul className="flex flex-col gap-2">
              {g.items.map((i) => (
                <WishlistCard key={i.id} item={i} rooms={rooms} actions={actions} />
              ))}
            </ul>
          </section>
        ))
      )}
      <section id="new" aria-labelledby="new-heading" className="flex scroll-mt-4 flex-col gap-3 rounded-md border border-border bg-surface p-4">
        <h2 id="new-heading" className="text-lg font-semibold">Add something</h2>
        <WishlistForm action={actions.add} rooms={rooms} submitLabel="Add to Things to get" />
      </section>
    </div>
  );
}
