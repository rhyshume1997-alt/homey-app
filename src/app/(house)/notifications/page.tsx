import { requireSession } from "@/server/auth/session";
import { listNotifications, refreshNotifications } from "@/server/data/notifications";
import { NotificationList } from "@/components/notifications/NotificationList";
import { markAllReadAction, markReadAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await requireSession();
  await refreshNotifications();
  const list = await listNotifications(session.userId);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Notifications</h1>
      {list.ok ? (
        <NotificationList items={list.data} now={new Date()} datePrefs={session.datePrefs} markRead={markReadAction} markAllRead={markAllReadAction} />
      ) : (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
          {list.error}
        </p>
      )}
    </div>
  );
}
