import Link from "next/link";

/** Pure: a 44px link to the notification centre with an unread count badge. */
export function NotificationBell({ unread }: { unread: number }) {
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <Link
      href="/notifications"
      aria-label={label}
      className="relative inline-flex size-11 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unread > 0 ? (
        <span data-testid="notification-badge" aria-hidden="true" className="absolute right-1 top-1 min-w-5 rounded-full bg-foreground px-1 text-center text-xs font-semibold leading-5 text-background">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
