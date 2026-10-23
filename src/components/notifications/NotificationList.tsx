import Link from "next/link";
import { formatDate, type DatePrefs } from "@/components/dates";
import { groupNotifications, safeLink, type NotificationItem } from "./types";

type FormAction = (formData: FormData) => void | Promise<void>;

export function NotificationRow({ n, datePrefs, markRead }: { n: NotificationItem; datePrefs: DatePrefs; markRead?: FormAction }) {
  const href = safeLink(n.link);
  return (
    <li data-unread={n.read ? "false" : "true"} className="rounded-md bg-surface-muted px-3 py-2 text-sm">
      <p className={n.read ? "text-muted" : "font-semibold"}>
        {href ? <Link href={href} className="inline-flex min-h-11 items-center underline">{n.title}</Link> : n.title}
      </p>
      {n.body ? <p className="text-muted">{n.body}</p> : null}
      <p className="text-xs text-muted">{formatDate(n.createdAt, datePrefs)}</p>
      {!n.read && markRead ? (
        <form action={markRead}>
          <input type="hidden" name="id" value={n.id} />
          <button type="submit" className="min-h-11 text-sm font-medium underline">Mark read</button>
        </form>
      ) : null}
    </li>
  );
}

export function NotificationList({ items, now, datePrefs, markRead, markAllRead }: {
  items: NotificationItem[];
  now: Date;
  datePrefs: DatePrefs;
  markRead?: FormAction;
  markAllRead?: () => void | Promise<void>;
}) {
  if (items.length === 0) return <p className="text-sm text-muted">No notifications yet.</p>;
  const unread = items.filter((i) => !i.read).length;
  return (
    <div className="flex flex-col gap-4">
      {unread > 0 && markAllRead ? (
        <form action={markAllRead}>
          <button type="submit" className="min-h-11 rounded-md border border-border px-4 text-sm font-medium">Mark all read</button>
        </form>
      ) : null}
      {groupNotifications(items, now).map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h2 className="mb-2 text-base font-semibold">{g.label}</h2>
          <ul className="flex flex-col gap-2">
            {g.items.map((n) => <NotificationRow key={n.id} n={n} datePrefs={datePrefs} markRead={markRead} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}
