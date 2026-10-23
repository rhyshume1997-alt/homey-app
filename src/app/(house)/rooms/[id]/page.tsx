import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { getRoom, listRoomItems } from "@/server/data/rooms";
import { listWishlistForRoom } from "@/server/data/wishlist";
import { listAppliancesForRoom } from "@/server/data/appliances";
import type { Appliance } from "@/contracts/appliances";
import { todayInLondon } from "@/components/tasks/group";
import { RoomItems } from "@/components/rooms/RoomItems";
import { RoomNotesForm } from "@/components/rooms/RoomNotesForm";
import { RoomExtras, type Soft } from "@/components/rooms/RoomExtras";
import { summariseRoom } from "@/components/rooms/summary";
import { LightSummary } from "@/components/ui/StatusPill";
import { saveRoomNotesAction } from "../actions";

export const dynamic = "force-dynamic";

const ERR = "rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg";
const CARD = "rounded-lg border border-border bg-surface p-4";
const LOAD_FAILED = "Could not load this right now.";

/** Never throws: a failed or rejected loader becomes a soft error for its own section. */
async function soft<T>(p: Promise<Soft<T>>): Promise<Soft<T>> {
  try {
    return await p;
  } catch {
    return { ok: false, error: LOAD_FAILED };
  }
}

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [room, items, wishlist, appliances] = await Promise.all([
    getRoom(id),
    listRoomItems(id),
    soft(listWishlistForRoom(id)),
    soft<Appliance[]>(listAppliancesForRoom(id).then((data) => ({ ok: true, data }))),
  ]);
  if (!room.ok) return <p role="alert" className={ERR}>{room.error}</p>;
  if (!room.data) notFound();
  const today = todayInLondon();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/rooms" className="inline-flex min-h-[var(--touch-target)] items-center text-sm font-medium underline">
          All rooms
        </Link>
        <h1 className="text-2xl font-semibold">{room.data.name}</h1>
      </div>
      {items.ok ? (
        <>
          <LightSummary lights={summariseRoom(id, items.data.tasks, items.data.snags, today).lights} />
          <section aria-label="Tasks and snags" className={CARD}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Tasks and snags</h2>
            <RoomItems tasks={items.data.tasks} snags={items.data.snags} today={today} />
          </section>
        </>
      ) : (
        <p role="alert" className={ERR}>{items.error}</p>
      )}
      <RoomExtras wishlist={wishlist} appliances={appliances} today={today} prefs={session.datePrefs} />
      <section aria-label="Notes" className={CARD}>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Notes</h2>
        <RoomNotesForm action={saveRoomNotesAction} roomId={id} notes={room.data.notes} />
      </section>
    </div>
  );
}
