import { Suspense } from "react";
import { Dashboard } from "@/components/Dashboard";
import { ContributionsCard, contributionsFromCosts } from "@/components/home/ContributionsCard";
import { DateFormatSettings } from "@/components/settings/DateFormatSettings";
import { requireSession } from "@/server/auth/session";
import { getDashboardData, todayInLondon } from "@/server/data/dashboard";
import { loadCosts } from "@/server/integrations/sheets/load";
import { saveDateFormatAction } from "./settings-actions";

export const dynamic = "force-dynamic";

/** Reads the shared sheet (may call Google), so it streams in behind a skeleton. */
async function ContributionsLoader() {
  const data = await loadCosts().then(contributionsFromCosts, () => ({ status: "error" }) as const);
  return <ContributionsCard data={data} />;
}

function ContributionsSkeleton() {
  return (
    <section aria-label="Joint account contributions" aria-busy="true" data-testid="contributions-skeleton" className="rounded-lg border border-border bg-surface p-4">
      <div className="h-8 w-48 animate-pulse rounded-md bg-surface-muted" />
      <div className="mt-3 h-20 animate-pulse rounded-md bg-surface-muted" />
      <span className="sr-only">Loading contributions</span>
    </section>
  );
}

export default async function HomePage() {
  const session = await requireSession();
  const now = new Date();
  const data = await getDashboardData(now, session.userId);
  return (
    <div className="flex flex-col gap-4">
      <Dashboard
        displayName={session.displayName}
        data={data}
        now={now}
        datePrefs={session.datePrefs}
        contributions={<Suspense fallback={<ContributionsSkeleton />}><ContributionsLoader /></Suspense>}
      />
      <DateFormatSettings prefs={session.datePrefs} example={todayInLondon(now)} action={saveDateFormatAction} />
    </div>
  );
}
