"use client";

import { useActionState } from "react";
import type { Appliance } from "@/contracts/appliances";
import { APPLIANCE_LIMITS } from "@/contracts/appliances";
import type { FormAction } from "@/components/tasks/types";
import { BTN_PRIMARY, FIELD, LABEL } from "@/components/tasks/styles";

export type RoomOption = { id: string; name: string };
export type DocOption = { id: string; title: string };

export function ApplianceForm({
  action, appliance, rooms, documents, submitLabel,
}: {
  action: FormAction;
  appliance?: Appliance;
  rooms: RoomOption[];
  documents: DocOption[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const a = appliance;
  return (
    <form action={formAction} className="flex flex-col gap-3" aria-label={a ? "Edit appliance" : "Add appliance"}>
      {a && <input type="hidden" name="id" value={a.id} />}
      <label className={LABEL}>
        Name
        <input name="name" required maxLength={APPLIANCE_LIMITS.name} defaultValue={a?.name ?? ""} className={FIELD} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          Make
          <input name="make" maxLength={APPLIANCE_LIMITS.make} defaultValue={a?.make ?? ""} className={FIELD} />
        </label>
        <label className={LABEL}>
          Model
          <input name="model" maxLength={APPLIANCE_LIMITS.model} defaultValue={a?.model ?? ""} className={FIELD} />
        </label>
        <label className={LABEL}>
          Serial number, last 4 characters only
          <input
            name="serial_last4" maxLength={APPLIANCE_LIMITS.serial} pattern="[A-Za-z0-9]{4}" autoComplete="off"
            defaultValue={a?.serial_last4 ?? ""} className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Room
          <select name="room_id" defaultValue={a?.room_id ?? ""} className={FIELD}>
            <option value="">No room</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          Purchase date
          <input type="date" name="purchase_date" defaultValue={a?.purchase_date ?? ""} className={FIELD} />
        </label>
        <label className={LABEL}>
          Warranty ends
          <input type="date" name="warranty_end" defaultValue={a?.warranty_end ?? ""} className={FIELD} />
        </label>
        <label className={LABEL}>
          Manual
          <select name="manual_document_id" defaultValue={a?.manual_document_id ?? ""} className={FIELD}>
            <option value="">None</option>
            {documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          Receipt
          <select name="receipt_document_id" defaultValue={a?.receipt_document_id ?? ""} className={FIELD}>
            <option value="">None</option>
            {documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </label>
      </div>
      <label className={LABEL}>
        Notes
        <textarea name="notes" rows={3} maxLength={APPLIANCE_LIMITS.notes} defaultValue={a?.notes ?? ""} className={FIELD} />
      </label>
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Saved.</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>{submitLabel}</button>
    </form>
  );
}
