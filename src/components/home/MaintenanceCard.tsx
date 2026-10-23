import Link from "next/link";
import { CardTitle } from "@/components/home/CardTitle";
import { formatDate, type DatePrefs } from "@/components/dates";
import { daysUntil, type MaintenanceItem } from "@/components/maintenance/model";

/**
 * Dashboard card: overdue and due-within-30-days upkeep, top 3.
 * `items` is null when it could not be loaded; empty means nothing is scheduled.
 */
export function MaintenanceCard({
  items, today, datePrefs,
}: { items: readonly Pick<MaintenanceItem, "id" | "title" | "next_due_on">[] | null; today: string; datePrefs?: DatePrefs }) {
  const due = items?.filter((i) => i.next_due_on !== null).slice(0, 3) ?? [];
  return (
    <section aria-label="Maintenance" data-testid="dashboard-card" className="rounded-lg border border-border bg-surface p-4">
      <CardTitle icon="wrench" tint="blue">Maintenance</CardTitle>
      <div className="mt-3">
        {items === null ? (
          <p className="text-sm text-muted">Could not load this right now.</p>
        ) : due.length === 0 ? (
          <p className="text-sm text-muted">Nothing scheduled yet</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {due.map((i) => {
              const overdue = daysUntil(today, i.next_due_on as string) < 0;
              return (
                <li key={i.id} className="rounded-md bg-surface-muted px-3 py-2">
                  <strong>{i.title}</strong>
                  <span className="text-muted">
                    {" "}{overdue ? "Overdue, due" : "Due"} {formatDate(i.next_due_on as string, datePrefs)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Link href="/maintenance" className="inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2">
        All maintenance
      </Link>
    </section>
  );
}
