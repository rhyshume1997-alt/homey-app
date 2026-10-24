// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Dashboard, type DashboardData } from "@/components/Dashboard";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

afterEach(cleanup);
const now = new Date("2026-10-21T08:00:00Z");
const contributionsSlot = <section aria-label="Joint account contributions" />;

const base: Omit<DashboardData, "tasks" | "snags" | "openSnagCount" | "activity" | "renewals" | "expenses"> = {
  today: "2026-10-21",
  chores: [],
  members: [],
  bins: [{ date: "2026-10-22", bins: ["Green"], putOutTonight: true }],
  notifications: [],
  awaiting: { count: 0, top: [], everSynced: true },
  supplies: { lowSupplies: [], totalSupplies: 3, openShoppingCount: 1 },
  maintenance: [],
  energy: { tariffs: [], bills: [], usage: [], solar: [], efficiency: [] },
  documents: { count: 2, expiring: [] },
  suggestionInput: { tasks: [], snags: [], records: [] },
};
const failed: typeof base = {
  today: "2026-10-21", chores: null, members: null, bins: null, notifications: null, awaiting: null,
  supplies: null, maintenance: null, energy: null, documents: null,
  suggestionInput: { tasks: null, snags: null, records: null },
};

const data: DashboardData = {
  ...base,
  renewals: [
    { id: "r1", title: "Home insurance", provider: "Acme Insure", date: "2026-11-05", days: 15 },
  ],
  expenses: {
    count: 4,
    lines: [
      { id: "e1", title: "Broadband", amount: 1234.56, frequency: "annual estimated", verified: false },
      { id: "e2", title: "Water", amount: 20, frequency: null, verified: true },
    ],
  },
  tasks: [
    { id: "t1", title: "Take out recycling", dueDate: "2026-10-21", overdue: false },
    { id: "t2", title: "Clean oven", dueDate: "2026-10-19", overdue: true },
  ],
  openSnagCount: 7,
  snags: [{ id: "s1", title: "Cracked tile", priority: "high", status: "open" }],
  activity: [
    { id: "9", action: "task.completed", entityType: "task", summary: "Clean oven", createdAt: "2026-10-21T11:00:00Z", actorName: "Sam" },
  ],
};

describe("Dashboard", () => {
  it("greets the user and shows real sections with links", () => {
    render(<Dashboard displayName="Alex" data={data} now={now} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Good morning, Alex");
    const tasks = within(screen.getByRole("region", { name: "Tasks due today" }));
    expect(tasks.getByText("Take out recycling")).toBeTruthy();
    expect(tasks.getByText(/Overdue, due 19\/Oct\/2026/)).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("Cracked tile")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Recent activity" })).getByText(/Sam/).closest("li")?.textContent).toContain("completed task");
    expect(screen.getByRole("link", { name: "All tasks" }).getAttribute("href")).toBe("/tasks");
    expect(screen.getByRole("link", { name: "All snags" }).getAttribute("href")).toBe("/snags");
    expect(screen.getByRole("link", { name: "All activity" }).getAttribute("href")).toBe("/activity");
  });

  it("shows real renewals and expenses cards linking to /money", () => {
    render(<Dashboard displayName="Alex" data={data} now={now} />);
    const ren = screen.getByRole("region", { name: "Upcoming renewals" });
    expect(within(ren).getByText(/Acme Insure: Home insurance/)).toBeTruthy();
    expect(within(ren).getByText(/05\/Nov\/2026 \(in 15 days\)/)).toBeTruthy();
    expect(within(ren).getByRole("link").getAttribute("href")).toBe("/money");
    const exp = screen.getByRole("region", { name: "Household expenses" });
    expect(within(exp).getByText("4")).toBeTruthy();
    expect(within(exp).getByText(/£1,234\.56 annual estimated \(unverified\)/)).toBeTruthy();
    expect(within(exp).getByText(/£20\.00$/)).toBeTruthy();
    expect(within(exp).getByRole("link").getAttribute("href")).toBe("/money");
  });

  it("greets by London time of day with the date, a Today card and quick links", () => {
    render(<Dashboard displayName="Alex Example" data={data} now={new Date("2026-10-21T19:30:00Z")} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Good evening, Alex");
    expect(screen.getByText("21/Oct/2026")).toBeTruthy();
    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).getByTestId("light-summary").textContent).toContain("1 overdue");
    const pills = within(today).getAllByText(/Overdue|Due soon|On track/).filter((e) => e.hasAttribute("data-light"));
    expect(pills[0].textContent).toContain("Overdue");
    expect(within(today).getByText("Clean oven")).toBeTruthy();
    const links = within(screen.getByRole("navigation", { name: "Quick links" })).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/calendar", "/rooms", "/wifi", "/meals"]);
  });

  it("shows every card in phone order, with no placeholder cards", () => {
    render(<Dashboard displayName="Alex" data={data} now={now} contributions={contributionsSlot} />);
    const names = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(names).toEqual([
      "Suggestions", "Today", "Chores", "Tasks due today", "Next bin collection", "Notifications", "Open snags", "Upcoming renewals",
      "Household expenses", "Joint account contributions", "Awaiting company replies", "Supplies",
      "Maintenance", "Energy", "Documents", "Recent activity",
    ]);
    expect(screen.queryByText("Not set up yet")).toBeNull();
    expect(screen.queryByText(/sample data/i)).toBeNull();
  });

  it("renders empty and unavailable states", () => {
    const { rerender } = render(
      <Dashboard displayName="Alex" data={{ ...base, tasks: [], snags: [], openSnagCount: 0, activity: [], renewals: [], expenses: { count: 0, lines: [] } }} now={now} />,
    );
    expect(screen.getByText("Nothing due today or overdue.")).toBeTruthy();
    expect(screen.getByText(/No open snags\./)).toBeTruthy();
    expect(screen.getByText("No activity yet.")).toBeTruthy();
    expect(screen.getByText("Nothing due in the next 90 days.")).toBeTruthy();
    expect(screen.getByText("Nothing recorded yet.")).toBeTruthy();
    rerender(<Dashboard displayName="Alex" data={{ ...failed, tasks: null, snags: null, openSnagCount: null, activity: null, renewals: null, expenses: null }} now={now} />);
    expect(screen.getAllByText("Could not load this right now.").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Good morning, Alex");
  });
});

describe("Dashboard with the snag list hidden", () => {
  it("leaves out the snag card", () => {
    render(<Dashboard displayName="Alex" data={data} now={now} contributions={contributionsSlot} showSnags={false} />);
    expect(screen.queryByRole("link", { name: "All snags" })).toBeNull();
    expect(screen.queryByText("Cracked tile")).toBeNull();
  });

  it("points to Settings when every snag is closed", () => {
    render(<Dashboard displayName="Alex" data={{ ...data, openSnagCount: 0, snags: [] }} now={now} contributions={contributionsSlot} />);
    expect(screen.getByRole("link", { name: "Hide the snag list in Settings" }).getAttribute("href")).toBe("/settings");
  });
});

