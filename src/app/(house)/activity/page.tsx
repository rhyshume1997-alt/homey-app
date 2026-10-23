import { ActivityList } from "@/components/activity/ActivityList";
import { requireSession } from "@/server/auth/session";
import { ACTIVITY_PAGE_SIZE, loadActivity, parseBefore } from "@/server/data/activity";

export const dynamic = "force-dynamic";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ before?: string | string[] }> }) {
  const session = await requireSession();
  const before = parseBefore((await searchParams).before);
  const result = await loadActivity(ACTIVITY_PAGE_SIZE, before);
  const rows = result?.rows ?? [];
  const nextBefore = result?.hasMore && rows.length ? rows[rows.length - 1]!.id : null;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Activity</h1>
      <ActivityList rows={rows} now={new Date()} nextBefore={nextBefore} error={result === null} datePrefs={session.datePrefs} />
    </div>
  );
}
