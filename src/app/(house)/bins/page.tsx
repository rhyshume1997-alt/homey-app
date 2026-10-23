import { requireSession } from "@/server/auth/session";
import { loadBins } from "@/server/data/bins";
import { BinsList } from "@/components/bins/BinsList";

export const dynamic = "force-dynamic";

export default async function BinsPage() {
  const session = await requireSession();
  const r = await loadBins();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Bins</h1>
      {r.ok ? (
        <BinsList days={r.days} datePrefs={session.datePrefs} lastSynced={r.lastSynced} />
      ) : (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
          {r.error}
        </p>
      )}
    </div>
  );
}
