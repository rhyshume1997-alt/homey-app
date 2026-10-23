import { requireSession } from "@/server/auth/session";
import { loadCosts } from "@/server/integrations/sheets/load";
import { formatDate } from "@/components/dates";
import { BudgetView } from "@/components/budget/BudgetView";
import { SetupCard, SheetError } from "@/components/budget/SetupCard";

export const dynamic = "force-dynamic";

export default async function BudgetPage() {
  const session = await requireSession();
  const res = await loadCosts();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Budget</h1>
      {res.status === "off" ? (
        <SetupCard />
      ) : res.status === "error" ? (
        <SheetError message={res.message} />
      ) : (
        <BudgetView
          sheet={res.sheet}
          flags={res.flags}
          source={{ live: res.live, at: formatDate(new Date(res.fetchedAt), session.datePrefs, true), by: res.fetchedBy }}
        />
      )}
    </div>
  );
}
