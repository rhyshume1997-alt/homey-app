"use client";

import { useActionState, useEffect, useRef } from "react";
import type { FormAction } from "@/components/tasks/types";
import { BTN_PRIMARY, FIELD, LABEL } from "@/components/tasks/styles";
import {
  WISHLIST_LIMITS, WISHLIST_PRIORITIES, WISHLIST_PRIORITY_LABEL, type WishlistItem, type WishlistRoom,
} from "@/contracts/wishlist";

export function WishlistForm({
  action, rooms, item, submitLabel, defaultRoomId,
}: {
  action: FormAction;
  rooms: readonly WishlistRoom[];
  item?: WishlistItem;
  submitLabel: string;
  defaultRoomId?: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && !item) ref.current?.reset();
  }, [state, item]);
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3">
      {item && <input type="hidden" name="id" value={item.id} />}
      <label className={LABEL}>
        What is it?
        <input name="title" required maxLength={WISHLIST_LIMITS.title} defaultValue={item?.title} className={FIELD} />
      </label>
      <label className={LABEL}>
        Room
        <select name="room_id" defaultValue={item?.room_id ?? defaultRoomId ?? ""} className={FIELD}>
          <option value="">No room</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        Rough price (£, a guess is fine)
        <input
          name="price_estimate"
          inputMode="decimal"
          maxLength={12}
          defaultValue={item?.price_estimate ?? ""}
          className={FIELD}
        />
      </label>
      <label className={LABEL}>
        Link to the shop (https only)
        <input
          name="url"
          type="url"
          inputMode="url"
          maxLength={WISHLIST_LIMITS.url}
          defaultValue={item?.url ?? ""}
          placeholder="https://"
          className={FIELD}
        />
      </label>
      <label className={LABEL}>
        Priority
        <select name="priority" defaultValue={item?.priority ?? "medium"} className={FIELD}>
          {WISHLIST_PRIORITIES.map((p) => (
            <option key={p} value={p}>{WISHLIST_PRIORITY_LABEL[p]}</option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        Notes
        <textarea name="notes" maxLength={WISHLIST_LIMITS.notes} defaultValue={item?.notes ?? ""} rows={2} className={FIELD} />
      </label>
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>{submitLabel}</button>
    </form>
  );
}
