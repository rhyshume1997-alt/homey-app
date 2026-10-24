"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import type { Room } from "@/contracts/rooms";
import { ROOM_LIMITS } from "@/contracts/rooms";
import type { FormAction } from "@/components/tasks/types";
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL } from "@/components/tasks/styles";
import { RowAction } from "@/components/tasks/RowAction";
import { StatusPill } from "@/components/ui/StatusPill";
import { GlassIcon } from "@/components/ui/GlassIcon";
import { countLabel, type RoomSummary } from "./summary";

export type RoomActions = { create: FormAction; rename: FormAction; move: FormAction; remove: FormAction };

export function AddRoomForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3">
      <label className={LABEL}>
        Room name
        <input name="name" required maxLength={ROOM_LIMITS.name} className={FIELD} />
      </label>
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Room added.</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>Add room</button>
    </form>
  );
}

function RenameForm({ room, action }: { room: Room; action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={room.id} />
      <label className={LABEL}>
        Rename {room.name}
        <input name="name" required maxLength={ROOM_LIMITS.name} defaultValue={room.name} className={FIELD} />
      </label>
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Saved.</p>}
      <button type="submit" disabled={pending} className={`${BTN_SECONDARY} self-start`}>Save name</button>
    </form>
  );
}

function DeleteRoom({ room, action }: { room: Room; action: FormAction }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={`${BTN_DANGER} self-start`}>
        Delete {room.name}
      </button>
    );
  }
  return (
    <div role="alertdialog" aria-label={`Delete ${room.name}`} className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg p-3">
      <p className="text-sm font-medium text-warning-fg">
        Delete {room.name}? Its tasks and snags are kept, just no longer linked to a room.
      </p>
      <div className="flex flex-wrap gap-2">
        <RowAction action={action} id={room.id} label="Yes, delete room" variant="danger" />
        <button type="button" onClick={() => setConfirming(false)} className={BTN_SECONDARY}>Cancel</button>
      </div>
    </div>
  );
}

export function RoomList({
  rooms,
  summaries,
  actions,
}: {
  rooms: readonly Room[];
  summaries: Record<string, RoomSummary>;
  actions: RoomActions;
}) {
  if (rooms.length === 0) return <p className="text-sm text-muted">No rooms yet. Tap a room above or add your own below.</p>;
  return (
    <ul className="flex flex-col gap-3" aria-label="Rooms">
      {rooms.map((room, i) => {
        const s = summaries[room.id] ?? { roomId: room.id, tasks: 0, snags: 0, lights: [], worst: "green" as const };
        return (
          <li key={room.id} className="rounded-lg border border-border bg-surface">
            <Link
              href={`/rooms/${room.id}`}
              className="flex min-h-[var(--touch-target)] items-center gap-3 p-3 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <GlassIcon name="home" tint="lavender" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base font-semibold">{room.name}</span>
                <span className="text-sm text-muted">{countLabel(s)}</span>
              </span>
              <StatusPill light={s.worst} />
            </Link>
            <details className="border-t border-border px-3 py-2">
              <summary className="min-h-[var(--touch-target)] cursor-pointer py-2 text-sm font-medium">
                Manage {room.name}
              </summary>
              <div className="flex flex-col gap-3 pb-2">
                <div className="flex flex-wrap gap-2">
                  {i > 0 && <RowAction action={actions.move} id={room.id} label="Move up" extra={{ direction: "up" }} />}
                  {i < rooms.length - 1 && (
                    <RowAction action={actions.move} id={room.id} label="Move down" extra={{ direction: "down" }} />
                  )}
                </div>
                <RenameForm room={room} action={actions.rename} />
                <DeleteRoom room={room} action={actions.remove} />
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
