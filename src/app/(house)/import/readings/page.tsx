import { requireSession } from "@/server/auth/session";
import { importSavers } from "@/server/integrations/gmail-import/savers";
import { listReadingDrafts } from "@/server/integrations/gmail-import/service";
import { ReadingImportReview } from "@/components/import/ReadingImportReview";
import { ConnectGoogleNotice, ImportError } from "@/components/import/shared";
import { saveReadingDraftAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ImportReadingsPage() {
  const s = await requireSession();
  const r = await listReadingDrafts(s, { saver: importSavers().reading });
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Review readings</h1>
        <p className="text-sm text-muted">From email · draft</p>
      </header>
      {r.status === "not_connected" ? (
        <ConnectGoogleNotice />
      ) : r.status === "error" ? (
        <ImportError message={r.message} />
      ) : (
        <ReadingImportReview drafts={r.drafts} action={saveReadingDraftAction} prefs={s.datePrefs} />
      )}
    </div>
  );
}
