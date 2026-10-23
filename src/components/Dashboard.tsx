import Link from "next/link";
import type { ReactNode } from "react";
import { ActivityItem } from "@/components/activity/ActivityList";
import type { ActivityRow } from "@/components/activity/format";
import { DEFAULT_DATE_PREFS, formatDate, type DatePrefs } from "@/components/dates";
import { formatGBP, relativeDays } from "@/components/money/format";
import type { Task } from "@/contracts/tasks";
import type { Snag } from "@/contracts/snags";
import type { HouseholdRecord } from "@/contracts/records";
import type { BinDay } from "@/components/bins/group";
import type { NotificationItem } from "@/components/notifications/types";
import type { VaultDocument } from "@/components/documents/types";
import type { MaintenanceItem } from "@/components/maintenance/model";
import type { EnergyData } from "@/components/energy/group";
import { AiRecommendationsCard } from "@/components/home/AiRecommendationsCard";
import { AwaitingRepliesCard, type AwaitingSummaryData } from "@/components/home/AwaitingRepliesCard";
import { BinsCard } from "@/components/home/BinsCard";
import { CardTitle } from "@/components/home/CardTitle";
import { GlassIcon, type IconName, type Tint } from "@/components/ui/GlassIcon";
import { LightSummary, StatusPill } from "@/components/ui/StatusPill";
import { LIGHT_ORDER, trafficLight, type DueKind, type Light } from "@/components/status";
import { DocumentsCard } from "@/components/home/DocumentsCard";
import { EnergyCard } from "@/components/home/EnergyCard";
import { MaintenanceCard } from "@/components/home/MaintenanceCard";
import { NotificationsCard } from "@/components/home/NotificationsCard";
import { SuppliesCard, type SuppliesCardData } from "@/components/home/SuppliesCard";

export interface DashboardTask { id: string; title: string; dueDate: string; overdue: boolean }
export interface DashboardSnag { id: string; title: string; priority: "low" | "medium" | "high"; status: string }

export interface DashboardRenewal { id: string; title: string; provider: string | null; date: string; days: number }
export interface DashboardExpenseLine { id: string; title: string; amount: number; frequency: string | null; verified: boolean }
export interface DashboardExpenses { count: number; lines: DashboardExpenseLine[] }

/** Null means the section could not be loaded. */
export interface DashboardData {
  renewals: DashboardRenewal[] | null;
  expenses: DashboardExpenses | null;
  tasks: DashboardTask[] | null;
  snags: DashboardSnag[] | null;
  openSnagCount: number | null;
  activity: ActivityRow[] | null;
  /** YYYY-MM-DD in London. */
  today: string;
  bins: readonly BinDay[] | null;
  notifications: NotificationItem[] | null;
  awaiting: AwaitingSummaryData | null;
  supplies: SuppliesCardData | null;
  maintenance: Pick<MaintenanceItem, "id" | "title" | "next_due_on">[] | null;
  energy: EnergyData | null;
  documents: { count: number; expiring: readonly VaultDocument[] } | null;
  /** Raw lists for rule-based suggestions; null when that list could not be loaded. */
  suggestionInput: { tasks: Task[] | null; snags: Snag[] | null; records: HouseholdRecord[] | null };
}

const linkCls = "inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2";

function Card({ title, icon, tint, children, href, hrefLabel }: { title: string; icon: IconName; tint: Tint; children: ReactNode; href?: string; hrefLabel?: string }) {
  return (
    <section aria-label={title} data-testid="dashboard-card" className="rounded-lg border border-border bg-surface p-4">
      <CardTitle icon={icon} tint={tint}>{title}</CardTitle>
      <div className="mt-3">{children}</div>
      {href ? <Link href={href} className={linkCls}>{hrefLabel}</Link> : null}
    </section>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-muted"> {children}</span>;
const Note = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted">{children}</p>;
const Unavailable = () => <Note>Could not load this right now.</Note>;
const Row = ({ children }: { children: ReactNode }) => <li className="rounded-md bg-surface-muted px-3 py-2">{children}</li>;
const List = ({ children }: { children: ReactNode }) => <ul className="flex flex-col gap-2 text-sm">{children}</ul>;

export function greeting(now: Date): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/London" }).format(now));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

interface TodayRow { key: string; kind: string; title: string; light: Light; note: string }

/** Today's items across tasks, bins, renewals and maintenance, most urgent first. */
export function todayRows(data: DashboardData, datePrefs?: DatePrefs): TodayRow[] {
  const rows: TodayRow[] = [];
  const add = (key: string, kind: string, due: DueKind, title: string, date: string | null, note: string) =>
    rows.push({ key, kind, title, light: trafficLight(due, date, data.today), note });
  for (const t of data.tasks ?? []) add("t" + t.id, "Task", "task", t.title, t.dueDate, t.overdue ? `Due ${formatDate(t.dueDate, datePrefs)}` : "Due today");
  const bin = data.bins?.[0];
  if (bin) add("bins", "Bins", "bins", bin.bins.join(", "), bin.date, bin.putOutTonight ? "Put out tonight" : formatDate(bin.date, datePrefs));
  for (const r of data.renewals ?? []) add("r" + r.id, "Renewal", "renewal", r.provider ? `${r.provider}: ${r.title}` : r.title, r.date, `${formatDate(r.date, datePrefs)} (${relativeDays(r.days)})`);
  for (const m of data.maintenance ?? []) if (m.next_due_on) add("m" + m.id, "Maintenance", "maintenance", m.title, m.next_due_on, formatDate(m.next_due_on, datePrefs));
  return rows.sort((a, b) => LIGHT_ORDER[a.light] - LIGHT_ORDER[b.light]);
}

function TodayCard({ data, datePrefs }: { data: DashboardData; datePrefs?: DatePrefs }) {
  const rows = todayRows(data, datePrefs);
  return (
    <section aria-label="Today" data-testid="today-card" className="rounded-lg border border-border bg-surface p-4">
      <CardTitle icon="sparkle" tint="homey">Today</CardTitle>
      <div className="mt-3 flex flex-col gap-3">
        {rows.length === 0 ? <Note>Nothing dated coming up.</Note> : (
          <>
            <LightSummary lights={rows.map((r) => r.light)} />
            <ul className="flex flex-col gap-2 text-sm">
              {rows.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 rounded-md bg-surface-muted px-3 py-2">
                  <span className="min-w-0"><strong>{r.title}</strong><span className="block text-muted">{r.kind}: {r.note}</span></span>
                  <StatusPill light={r.light} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

const QUICK: { href: string; label: string; icon: IconName; tint: Tint }[] = [
  { href: "/calendar", label: "Calendar", icon: "calendar", tint: "blue" },
  { href: "/rooms", label: "Rooms", icon: "room", tint: "lavender" },
  { href: "/wifi", label: "Wifi", icon: "wifi", tint: "teal" },
  { href: "/meals", label: "Meals", icon: "meal", tint: "amber" },
];

function QuickLinks() {
  return (
    <nav aria-label="Quick links" className="grid grid-cols-4 gap-2">
      {QUICK.map((q) => (
        <Link key={q.href} href={q.href} prefetch={false} className="flex min-h-11 flex-col items-center gap-1.5 rounded-lg border border-border bg-surface px-1 py-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2">
          <GlassIcon name={q.icon} tint={q.tint} />
          {q.label}
        </Link>
      ))}
    </nav>
  );
}

export function Dashboard({
  displayName,
  data,
  now,
  datePrefs,
  contributions,
}: {
  displayName: string;
  data: DashboardData;
  now: Date;
  datePrefs?: DatePrefs;
  /** Joint contributions card, streamed separately because it may call Google. */
  contributions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">{greeting(now)}, {firstName(displayName)}</h1>
        <p className="text-sm text-muted"><time dateTime={data.today}>{formatDate(data.today, datePrefs)}</time></p>
      </header>
      <div className="[&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center">
        <AiRecommendationsCard tasks={data.suggestionInput.tasks} snags={data.suggestionInput.snags} records={data.suggestionInput.records} today={data.today} />
      </div>
      <TodayCard data={data} datePrefs={datePrefs} />
      <QuickLinks />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center">
        <Card title="Tasks due today" icon="tasks" tint="blue" href="/tasks" hrefLabel="All tasks">
          {data.tasks === null ? <Unavailable /> : data.tasks.length === 0 ? <Note>Nothing due today or overdue.</Note> : (
            <List>
              {data.tasks.map((t) => (
                <Row key={t.id}><strong>{t.title}</strong><Muted>{t.overdue ? `Overdue, due ${formatDate(t.dueDate, datePrefs)}` : "Due today"}</Muted></Row>
              ))}
            </List>
          )}
        </Card>
        <BinsCard days={data.bins} datePrefs={datePrefs} />
        <NotificationsCard items={data.notifications} />
        <Card title="Open snags" icon="snags" tint="rose" href="/snags" hrefLabel="All snags">
          {data.snags === null || data.openSnagCount === null ? <Unavailable /> : data.openSnagCount === 0 ? <Note>No open snags.</Note> : (
            <>
              <p className="mb-2 text-sm"><strong>{data.openSnagCount}</strong> open</p>
              <List>
                {data.snags.map((s) => (
                  <Row key={s.id}><strong>{s.title}</strong><Muted>{s.priority} priority</Muted></Row>
                ))}
              </List>
            </>
          )}
        </Card>
        <Card title="Upcoming renewals" icon="calendar" tint="amber" href="/money" hrefLabel="All renewals">
          {data.renewals === null ? <Unavailable /> : data.renewals.length === 0 ? <Note>Nothing due in the next 90 days.</Note> : (
            <List>
              {data.renewals.map((r) => (
                <Row key={r.id}>
                  <strong>{r.provider ? `${r.provider}: ${r.title}` : r.title}</strong>
                  <Muted>{formatDate(r.date, datePrefs)} ({relativeDays(r.days)})</Muted>
                </Row>
              ))}
            </List>
          )}
        </Card>
        <Card title="Household expenses" icon="money" tint="amber" href="/money" hrefLabel="Bills and budget">
          {data.expenses === null ? <Unavailable /> : data.expenses.count === 0 ? <Note>Nothing recorded yet.</Note> : (
            <>
              <p className="mb-2 text-sm"><strong>{data.expenses.count}</strong> recorded</p>
              <List>
                {data.expenses.lines.map((l) => (
                  <Row key={l.id}>
                    <strong>{l.title}</strong>
                    <Muted>{formatGBP(l.amount)}{l.frequency ? ` ${l.frequency}` : ""}{l.verified ? "" : " (unverified)"}</Muted>
                  </Row>
                ))}
              </List>
            </>
          )}
        </Card>
        {contributions}
        <AwaitingRepliesCard data={data.awaiting} now={now} />
        <SuppliesCard data={data.supplies} />
        <MaintenanceCard items={data.maintenance} today={data.today} datePrefs={datePrefs} />
        <EnergyCard data={data.energy} today={data.today} datePrefs={datePrefs} />
        <DocumentsCard summary={data.documents} datePrefs={datePrefs ?? DEFAULT_DATE_PREFS} />
        <Card title="Recent activity" icon="bell" tint="slate" href="/activity" hrefLabel="All activity">
          {data.activity === null ? <Unavailable /> : data.activity.length === 0 ? <Note>No activity yet.</Note> : (
            <ul className="flex flex-col gap-2">
              {data.activity.map((r) => <ActivityItem key={r.id} row={r} now={now} datePrefs={datePrefs} />)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
