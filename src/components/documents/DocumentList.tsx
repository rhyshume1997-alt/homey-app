import { formatDate, type DatePrefs } from "@/components/dates";
import { RowAction } from "@/components/tasks/RowAction";
import type { FormAction } from "@/components/tasks/types";
import { BTN_SECONDARY } from "@/components/tasks/styles";
import { daysUntil, localYmd } from "./files";
import { trafficLight } from "@/components/status";
import { StatusPill } from "@/components/ui/StatusPill";
import { CATEGORY_LABEL, DOCUMENT_CATEGORIES, type RecordOption, type VaultDocument } from "./types";

function Expiry({ doc, today, prefs }: { doc: VaultDocument; today: Date; prefs: DatePrefs }) {
  const n = daysUntil(doc.expires_on, today);
  if (n === null || !doc.expires_on) return null;
  const date = formatDate(doc.expires_on, prefs);
  const light = trafficLight("document", doc.expires_on, localYmd(today));
  const text = n < 0 ? `Expired ${date}` : `Expires ${date}${light !== "green" ? ` (${n} ${n === 1 ? "day" : "days"})` : ""}`;
  return (
    <span data-testid={light === "green" ? undefined : "expiry-badge"} className="inline-flex flex-wrap items-center gap-2 text-xs font-medium">
      <StatusPill light={light} />
      <span className={light === "green" ? "text-sm text-muted" : ""}>{text}</span>
    </span>
  );
}

function Row({
  doc, remove, today, prefs, recordTitle,
}: { doc: VaultDocument; remove: FormAction; today: Date; prefs: DatePrefs; recordTitle?: string }) {
  return (
    <li data-testid="document-row" className="rounded-md bg-surface-muted px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 break-words font-medium">{doc.title}</p>
        <Expiry doc={doc} today={today} prefs={prefs} />
      </div>
      <p className="text-sm text-muted">
        Added {formatDate(doc.created_at, prefs)}
        {doc.issued_on ? ` · Issued ${formatDate(doc.issued_on, prefs)}` : ""}
        {doc.renewal_date ? ` · Renewal ${formatDate(doc.renewal_date, prefs)}` : ""}
        {recordTitle ? ` · Record: ${recordTitle}` : ""}
      </p>
      {doc.notes && <p className="mt-1 whitespace-pre-line text-sm">{doc.notes}</p>}
      <div className="mt-2 flex flex-wrap items-start gap-2">
        <a href={`/documents/${doc.id}/open`} target="_blank" rel="noopener noreferrer" className={`${BTN_SECONDARY} inline-flex items-center`}>
          Open
        </a>
        <details>
          <summary className="min-h-[var(--touch-target)] cursor-pointer py-2 text-sm font-medium">Delete</summary>
          <p className="mb-2 text-sm text-muted">This removes the file and cannot be undone.</p>
          <RowAction action={remove} id={doc.id} label="Confirm delete" variant="danger" />
        </details>
      </div>
    </li>
  );
}

export function DocumentList({
  documents, remove, datePrefs, records = [], today = new Date(),
}: {
  documents: readonly VaultDocument[];
  remove: FormAction;
  datePrefs: DatePrefs;
  records?: readonly RecordOption[];
  today?: Date;
}) {
  if (documents.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
        No documents yet. Upload one above.
      </p>
    );
  }
  const titles = new Map(records.map((r) => [r.id, r.title]));
  return (
    <div className="flex flex-col gap-4">
      {DOCUMENT_CATEGORIES.filter((c) => documents.some((d) => d.category === c)).map((c) => {
        const rows = documents.filter((d) => d.category === c);
        return (
          <section key={c} data-testid="document-group" aria-label={CATEGORY_LABEL[c]} className="rounded-lg border border-border bg-surface p-4">
            <h2 className="mb-3 text-base font-semibold">{CATEGORY_LABEL[c]} ({rows.length})</h2>
            <ul className="flex flex-col gap-2">
              {rows.map((d) => (
                <Row key={d.id} doc={d} remove={remove} today={today} prefs={datePrefs} recordTitle={d.record_id ? titles.get(d.record_id) : undefined} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
