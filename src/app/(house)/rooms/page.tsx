import { requireSession } from "@/server/auth/session";
import { listRooms, listRoomItems } from "@/server/data/rooms";
import { todayInLondon } from "@/components/tasks/group";
import { AddRoomForm, RoomList } from "@/components/rooms/RoomList";
import { summariseRoom, type RoomSummary } from "@/components/rooms/summary";
import { LightSummary } from "@/components/ui/StatusPill";
import { createRoomAction, deleteRoomAction, moveRoomAction, renameRoomAction } from "./actions";

export const dynamic = "force-dynamic";

const ERR = "rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg";

export default async function RoomsPage() {
  await requireSession();
  const [rooms, items] = await Promise.all([listRooms(), listRoomItems()]);
  const today = todayInLondon();
  const summaries: Record<string, RoomSummary> = {};
  if (rooms.ok && items.ok) {
    for (const r of rooms.data) summaries[r.id] = summariseRoom(r.id, items.data.tasks, items.data.snags, today);
  }
  const all = Object.values(summaries).flatMap((s) => s.lights);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Rooms</h1>
      {items.ok && rooms.ok && <LightSummary lights={all} />}
      {rooms.ok ? (
        <RoomList
          rooms={rooms.data}
          summaries={summaries}
          actions={{ create: createRoomAction, rename: renameRoomAction, move: moveRoomAction, remove: deleteRoomAction }}
        />
      ) : (
        <p role="alert" className={ERR}>{rooms.error}</p>
      )}
      {!items.ok && rooms.ok && <p role="alert" className={ERR}>{items.error}</p>}
      <section aria-label="Add a room" className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-base font-semibold">Add a room</h2>
        <AddRoomForm action={createRoomAction} />
      </section>
    </div>
  );
}
