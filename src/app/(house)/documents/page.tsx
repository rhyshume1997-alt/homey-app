import { requireSession } from "@/server/auth/session";
import { listDocuments, listRecordOptions } from "@/server/data/documents";
import { DocumentList } from "@/components/documents/DocumentList";
import { DocumentForm } from "@/components/documents/DocumentForm";
import { deleteDocumentAction, uploadDocumentAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const session = await requireSession();
  const [docs, records] = await Promise.all([listDocuments(), listRecordOptions()]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Documents</h1>
      <section aria-label="Upload a document" className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-base font-semibold">Upload a document</h2>
        <DocumentForm action={uploadDocumentAction} records={records} />
      </section>
      {docs.ok ? (
        <DocumentList documents={docs.data} remove={deleteDocumentAction} datePrefs={session.datePrefs} records={records} />
      ) : (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
          {docs.error}
        </p>
      )}
    </div>
  );
}
