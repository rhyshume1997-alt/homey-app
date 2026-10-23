export type NotificationKind =
  | "renewal_due" | "task_due" | "task_overdue" | "bin_tomorrow" | "snag_stale" | "document_expiring" | "system";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  read: boolean;
}

/** Only same-site relative paths are ever rendered as links. */
export function safeLink(link: string | null | undefined): string | null {
  if (!link) return null;
  return /^\/[A-Za-z0-9/_?=&.-]*$/.test(link) && !link.startsWith("//") ? link : null;
}

const DAY = 86_400_000;

/** Unread first (newest first), then read; grouped Today / This week / Earlier by age. */
export function groupNotifications(items: readonly NotificationItem[], now: Date) {
  const sorted = [...items].sort(
    (a, b) => Number(a.read) - Number(b.read) || b.createdAt.localeCompare(a.createdAt),
  );
  const groups = { Today: [] as NotificationItem[], "This week": [] as NotificationItem[], Earlier: [] as NotificationItem[] };
  for (const n of sorted) {
    const age = now.getTime() - new Date(n.createdAt).getTime();
    (age < DAY ? groups.Today : age < 7 * DAY ? groups["This week"] : groups.Earlier).push(n);
  }
  return (Object.entries(groups) as [keyof typeof groups, NotificationItem[]][])
    .filter(([, v]) => v.length > 0)
    .map(([label, list]) => ({ label, items: list }));
}
