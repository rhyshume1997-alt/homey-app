// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { CalendarItem } from "@/contracts/calendar";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { Agenda } from "@/components/calendar/Agenda";
import { monthGrid, parseDay, parseMonth, shiftMonth, summariseByDay } from "@/components/calendar/grid";

vi.mock("@/server/db/supabase", () => ({ createUserClient: async () => null }));
import { loadCalendarItems } from "@/server/data/calendar";

afterEach(cleanup);

const item = (o: Partial<CalendarItem> = {}): CalendarItem => ({
  key: "k", date: "2026-10-22", title: "Thing", kind: "task", light: "green", href: "/tasks", ...o,
});

describe("grid helpers", () => {
  it("builds six Monday-first weeks", () => {
    const g = monthGrid("2026-10");
    expect(g).toHaveLength(42);
    expect(g[0]!.date).toBe("2026-09-28");
    expect(g.filter((c) => c.inMonth)).toHaveLength(31);
  });
  it("shifts months across years and validates params", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(parseMonth("2026-13", "2026-10-22")).toBe("2026-10");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("2026-02-28")).toBe("2026-02-28");
  });
  it("summarises worst light and count", () => {
    const m = summariseByDay([item({ light: "green" }), item({ key: "b", light: "red" })]);
    expect(m.get("2026-10-22")).toEqual({ count: 2, light: "red" });
  });
});

describe("MonthGrid", () => {
  it("highlights today and shows counts", () => {
    render(<MonthGrid month="2026-10" today="2026-10-22" selected="2026-10-22" items={[item({ light: "amber" })]} />);
    const today = screen.getByRole("link", { name: /^2026-10-22, today, 1 item, Due soon/ });
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(screen.getByRole("link", { name: "Next month" }).getAttribute("href")).toBe("/calendar?m=2026-11");
    expect(within(screen.getByTestId("month-grid")).getAllByRole("link")).toHaveLength(42);
  });
});

describe("Agenda", () => {
  it("lists the selected day and the next days with pills and links", () => {
    const items = [item({ title: "Bins", kind: "bins", href: "/bins" }), item({ key: "z", date: "2026-10-25", title: "Boiler", kind: "maintenance", light: "amber", href: "/maintenance" })];
    render(<Agenda selected="2026-10-22" today="2026-10-22" items={items} upcoming={items} />);
    expect(screen.getAllByRole("link", { name: /Boiler/ })[0]!.getAttribute("href")).toBe("/maintenance");
    expect(screen.getAllByText("Due soon").length).toBeGreaterThan(0);
  });
  it("shows empty states", () => {
    render(<Agenda selected="2026-10-22" today="2026-10-22" items={[]} upcoming={[]} />);
    expect(screen.getByText("Nothing scheduled.")).toBeTruthy();
  });
});

describe("loadCalendarItems", () => {
  it("keeps good sources, counts failures and sorts by date", async () => {
    const range = { from: "2026-10-01", to: "2026-10-31", today: "2026-10-22" };
    const r = await loadCalendarItems(range, [
      async () => [item({ key: "b", date: "2026-10-25" })],
      async () => { throw new Error("boom"); },
      async () => [item({ key: "a", date: "2026-10-23" })],
    ]);
    expect(r.failed).toBe(1);
    expect(r.items.map((i) => i.key)).toEqual(["a", "b"]);
  });
});
