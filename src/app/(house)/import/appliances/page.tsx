import { requireSession } from "@/server/auth/session";
import { importSavers } from "@/server/integrations/gmail-import/savers";
import { listApplianceDrafts } from "@/server/integrations/gmail-import/service";
import { ApplianceImportReview } from "@/components/import/ApplianceImportReview";
import { ConnectGoogleNotice, ImportError } from "@/components/import/shared";
import { saveApplianceDraftAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ImportAppliancesPage() {
  const s = await requireSession();
  const r = await listApplianceDrafts(s, { saver: importSavers().appliance });
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Review import</h1>
        <p className="text-sm text-muted">From email · draft</p>
      </header>
      {r.status === "not_connected" ? (
        <ConnectGoogleNotice />
      ) : r.status === "error" ? (
        <ImportError message={r.message} />
      ) : (
        <ApplianceImportReview drafts={r.drafts} action={saveApplianceDraftAction} prefs={s.datePrefs} />
      )}
    </div>
  );
}
