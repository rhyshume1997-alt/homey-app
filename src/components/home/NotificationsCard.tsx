import Link from "next/link";
import { CardTitle } from "@/components/home/CardTitle";
import { safeLink, type NotificationItem } from "@/components/notifications/types";

/** Latest 3 unread notifications. Null items means they could not be loaded. */
export function NotificationsCard({ items }: { items: NotificationItem[] | null }) {
  const unread = (items ?? []).filter((i) => !i.read).slice(0, 3);
  return (
    <section aria-label="Notifications" data-testid="dashboard-card" className="rounded-lg border border-border bg-surface p-4">
      <CardTitle icon="bell" tint="lavender">Notifications</CardTitle>
      <div className="mt-3">
        {items === null ? (
          <p className="text-sm text-muted">Could not load this right now.</p>
        ) : unread.length === 0 ? (
          <p className="text-sm text-muted">Nothing new.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {unread.map((n) => {
              const href = safeLink(n.link);
              return (
                <li key={n.id} className="rounded-md bg-surface-muted px-3 py-2">
                  {href ? <Link href={href} className="underline">{n.title}</Link> : n.title}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Link href="/notifications" className="inline-flex min-h-11 items-center text-sm font-medium underline">All notifications</Link>
    </section>
  );
}
