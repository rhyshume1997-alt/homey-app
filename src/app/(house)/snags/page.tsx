import { requireSession } from "@/server/auth/session";
import { listSnags } from "@/server/data/snags";
import { listRooms } from "@/server/data/rooms";
import { SnagList } from "@/components/snags/SnagList";
import { SnagForm } from "@/components/snags/SnagForm";
import { createSnagAction, deleteSnagAction, setSnagStatusAction, updateSnagAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SnagsPage() {
  await requireSession();
  const [snags, roomList] = await Promise.all([listSnags(), listRooms()]);
  // A failed rooms load leaves the picker out; edit forms then keep the existing room unchanged.
  const rooms = roomList.ok ? roomList.data.map(({ id, name }) => ({ id, name })) : undefined;
  const actions = {
    create: createSnagAction,
    update: updateSnagAction,
    setStatus: setSnagStatusAction,
    remove: deleteSnagAction,
  };
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Snags</h1>
      <section aria-label="Add a snag" className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-base font-semibold">Add a snag</h2>
        <SnagForm action={createSnagAction} rooms={rooms} submitLabel="Add snag" />
      </section>
      {snags.ok ? (
        <SnagList snags={snags.data} actions={actions} rooms={rooms} />
      ) : (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
          {snags.error}
        </p>
      )}
    </div>
  );
}
