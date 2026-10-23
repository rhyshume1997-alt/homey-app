import { Suspense, cache } from "react";
import { AppNav } from "./AppNav";
import { QuickAdd } from "./QuickAdd";
import { NotificationBell } from "./notifications/NotificationBell";
import { getAuthUser, getSession } from "@/server/auth/session";
import { unreadCount } from "@/server/data/notifications";
import { loadMembers } from "@/server/data/members";
import { todayInLondon } from "@/server/data/dashboard";
import { getNeedsDoing, worstLightFor } from "@/server/homey/needs-doing";
import { countNeeds } from "@/components/homey/needs-doing";
import { expressionFor } from "@/components/homey/types";
import { parseHomeyPrefs } from "@/components/homey/prefs";
import { HomeyHost } from "@/components/homey/HomeyHost";

/** Unread badge count for the signed-in user; null (no badge) when it cannot be loaded. Once per render. */
const loadUnread = cache(async (): Promise<number | null> => {
  try {
    const session = await getSession();
    if (!session) return null;
    const r = await unreadCount(session.userId);
    return r.ok ? r.data : null;
  } catch {
    return null;
  }
});

async function UnreadBell() {
  const unread = await loadUnread();
  return <NotificationBell unread={unread ?? 0} />;
}

/** The badge streams in: the shell and the page never wait for the unread count. */
function Bell() {
  return (
    <Suspense fallback={<NotificationBell unread={0} />}>
      <UnreadBell />
    </Suspense>
  );
}

const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Homey streams in like the badge: the page never waits for the needs list. The list is computed
 * server-side from household data; the browser only gets item text, keys and internal links.
 */
async function loadHomeyProps(): Promise<React.ComponentProps<typeof HomeyHost> | null> {
  try {
    const [session, auth] = await Promise.all([getSession(), getAuthUser()]);
    if (!session || !auth) return null;
    const today = todayInLondon();
    const [{ items }, members] = await Promise.all([getNeedsDoing(session, today), loadMembers(session.householdId)]);
    const other = (members ?? []).find((m) => m.displayName !== session.displayName);
    const suggestions = items
      .filter((i) => i.light !== "green" && i.href.startsWith("/") && !i.href.startsWith("//"))
      .slice(0, 3)
      .map((i) => ({ key: i.key, text: i.text, href: i.href }));
    return {
      userId: session.userId,
      firstName: firstWord(session.displayName),
      otherName: other ? firstWord(other.displayName) : "",
      count: countNeeds(items, today),
      expression: expressionFor(worstLightFor(items)),
      suggestions,
      prefs: parseHomeyPrefs(auth.user.user_metadata),
    };
  } catch {
    return null;
  }
}

async function HomeyMount() {
  const props = await loadHomeyProps();
  return props ? <HomeyHost {...props} /> : null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="hidden w-[var(--sidebar-width)] shrink-0 border-r border-border bg-surface p-4 lg:block">
        <div className="mb-4 flex items-center justify-between pl-3">
          <p className="text-xl font-semibold">Our Home</p>
          <Bell />
        </div>
        <AppNav variant="sidebar" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-[var(--topbar-height)] items-center border-b border-border bg-surface px-4 justify-between lg:hidden">
          <p className="text-lg font-semibold">Our Home</p>
          <Bell />
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-5xl flex-1 p-4 pb-[calc(var(--tabbar-height)+6rem)] lg:p-8 lg:pb-24"
        >
          {children}
        </main>
      </div>
      <AppNav variant="tabs" />
      <QuickAdd />
      <Suspense fallback={null}>
        <HomeyMount />
      </Suspense>
    </div>
  );
}
