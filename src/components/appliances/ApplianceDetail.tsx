import type { ReactNode } from "react";
import type { Appliance } from "@/contracts/appliances";
import { formatDate, type DatePrefs } from "@/components/dates";
import { BTN_SECONDARY } from "@/components/tasks/styles";
import { WarrantyPill } from "./ApplianceList";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

/** Read-only facts. Documents open through the authorised /documents/[id]/open route (60 second signed URL). */
export function ApplianceDetail({
  appliance: a, roomName, manualTitle, receiptTitle, today, prefs,
}: {
  appliance: Appliance;
  roomName?: string;
  manualTitle?: string;
  receiptTitle?: string;
  today: string;
  prefs: DatePrefs;
}) {
  const link = (id: string, label: string) => (
    <a href={`/documents/${id}/open`} target="_blank" rel="noopener noreferrer" className={`${BTN_SECONDARY} inline-flex items-center`}>
      {label}
    </a>
  );
  return (
    <div className="flex flex-col gap-3">
      <WarrantyPill warrantyEnd={a.warranty_end} today={today} prefs={prefs} />
      <dl className="grid gap-3 sm:grid-cols-2">
        <Row label="Make">{a.make ?? "Not recorded"}</Row>
        <Row label="Model">{a.model ?? "Not recorded"}</Row>
        <Row label="Serial (last 4)">{a.serial_last4 ?? "Not recorded"}</Row>
        <Row label="Room">{roomName ?? "No room"}</Row>
        <Row label="Purchased">{a.purchase_date ? formatDate(a.purchase_date, prefs) : "Not recorded"}</Row>
        <Row label="Warranty ends">{a.warranty_end ? formatDate(a.warranty_end, prefs) : "Not recorded"}</Row>
        <Row label="Added from">{a.source === "email" ? "Email import" : "Entered by hand"}</Row>
      </dl>
      {a.notes && <p className="whitespace-pre-line text-sm">{a.notes}</p>}
      <div className="flex flex-wrap gap-2">
        {a.manual_document_id && link(a.manual_document_id, manualTitle ? `Manual: ${manualTitle}` : "Open manual")}
        {a.receipt_document_id && link(a.receipt_document_id, receiptTitle ? `Receipt: ${receiptTitle}` : "Open receipt")}
        {!a.manual_document_id && !a.receipt_document_id && <p className="text-sm text-muted">No documents linked.</p>}
      </div>
    </div>
  );
}
