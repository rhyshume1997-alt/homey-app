import { requireSession } from "@/server/auth/session";
import { loadBinsPage } from "@/server/data/bins";
import { BinsList } from "@/components/bins/BinsList";
import { BinsSettings } from "@/components/bins/BinsSettings";
import { removeScheduleAction, saveCouncilUrlAction, saveScheduleAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function BinsPage() {
  const session = await requireSession();
  const r = await loadBinsPage();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Bins</h1>
      {r.ok ? (
        <>
          <BinsList days={r.data.days} datePrefs={session.datePrefs} lastSynced={r.data.lastSynced} />
          <BinsSettings
            councilUrl={r.data.councilUrl}
            schedules={r.data.schedules}
            actions={{ saveUrl: saveCouncilUrlAction, saveSchedule: saveScheduleAction, remove: removeScheduleAction }}
          />
        </>
      ) : (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
          {r.error}
        </p>
      )}
    </div>
  );
}
