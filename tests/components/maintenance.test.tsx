// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MaintenanceList, type MaintenanceActions } from "@/components/maintenance/MaintenanceList";
import { Suggestions } from "@/components/maintenance/Suggestions";
import { MaintenanceCard } from "@/components/home/MaintenanceCard";
import { SUGGESTIONS, daysUntil, describeInterval, groupMaintenance, type MaintenanceItem, type MaintenanceLog } from "@/components/maintenance/model";

afterEach(cleanup);

const H = "22222222-2222-4222-8222-222222222222";
let n = 0;
const item = (o: Partial<MaintenanceItem>): MaintenanceItem => ({
  id: `3a170000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  household_id: H, title: "Item", area: null, interval_months: 12, season: null, last_done_on: null, next_due_on: null,
  notes: null, provider: null, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z", ...o,
});
const noop = async () => null;
const actions: MaintenanceActions = { update: noop, remove: noop, done: noop };
const TODAY = "2026-10-21";

describe("groupMaintenance", () => {
  it("splits overdue, next 30 days, later and no date", () => {
    const g = groupMaintenance(
      [
        item({ title: "late", next_due_on: "2026-10-20" }),
        item({ title: "today", next_due_on: "2026-10-21" }),
        item({ title: "edge", next_due_on: "2026-11-20" }),
        item({ title: "far", next_due_on: "2026-11-21" }),
        item({ title: "none" }),
      ],
      TODAY,
    );
    expect(g.overdue.map((i) => i.title)).toEqual(["late"]);
    expect(g.soon.map((i) => i.title)).toEqual(["today", "edge"]);
    expect(g.later.map((i) => i.title)).toEqual(["far"]);
    expect(g.noDate.map((i) => i.title)).toEqual(["none"]);
  });
  it("counts days across a year end", () => {
    expect(daysUntil("2026-12-31", "2027-01-01")).toBe(1);
    expect(describeInterval(null)).toBe("One-off");
    expect(describeInterval(24)).toBe("Every 2 years");
  });
});

describe("MaintenanceList", () => {
  it("shows a pill word from next_due_on", () => {
    render(
      <MaintenanceList
        items={[
          item({ title: "Late", next_due_on: "2026-10-01" }),
          item({ title: "Soon", next_due_on: "2026-10-25" }),
          item({ title: "Far", next_due_on: "2027-03-01" }),
        ]}
        log={[]} today={TODAY} actions={actions}
      />,
    );
    const rows = screen.getAllByTestId("maintenance-row");
    expect(within(rows[0]!).getByText("Overdue")).toBeTruthy();
    expect(within(rows[1]!).getByText("Due soon")).toBeTruthy();
    expect(within(rows[2]!).getByText("On track")).toBeTruthy();
  });

  it("shows groups, history and Done today", () => {
    const a = item({ title: "Boiler service", next_due_on: "2026-10-01", last_done_on: "2025-10-01" });
    const log: MaintenanceLog[] = [
      { id: "3a170000-0000-4000-8000-0000000000f1", item_id: a.id, done_on: "2025-10-01", notes: "All fine", cost_gbp: 85, created_at: "2025-10-01T10:00:00Z" },
      { id: "3a170000-0000-4000-8000-0000000000f2", item_id: a.id, done_on: "2024-10-01", notes: null, cost_gbp: null, created_at: "2024-10-01T10:00:00Z" },
    ];
    render(<MaintenanceList items={[a, item({ title: "Gutters" })]} log={log} today={TODAY} actions={actions} />);
    const groups = screen.getAllByTestId("maintenance-group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Overdue", "No date set"]);
    const row = within(groups[0]).getByTestId("maintenance-row");
    expect(within(row).getByText("Done today")).toBeTruthy();
    expect(within(row).getByText("History (2)")).toBeTruthy();
    expect(row.textContent).toContain("£85.00");
    expect(row.textContent).toContain("All fine");
    expect(row.textContent).toContain("Due 01/Oct/2026");
  });
  it("shows an empty state", () => {
    render(<MaintenanceList items={[]} log={[]} today={TODAY} actions={actions} />);
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy();
  });
});

describe("Suggestions", () => {
  it("is labelled as suggestions, lists every item and marks existing ones", () => {
    render(<Suggestions action={noop} existingTitles={["boiler service"]} />);
    expect(screen.getByText("Suggested checklist")).toBeTruthy();
    expect(screen.getByText(/Suggestions only/)).toBeTruthy();
    expect(screen.getAllByTestId("suggestion")).toHaveLength(SUGGESTIONS.length);
    expect(screen.getAllByText("Already added")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Add" })).toHaveLength(SUGGESTIONS.length - 1);
  }, 30000);
  it("covers the expected upkeep and sets no dates", () => {
    const titles = SUGGESTIONS.map((s) => s.title.toLowerCase()).join("|");
    for (const w of ["boiler", "smoke", "radiators", "gutters", "tap", "trickle", "extractor"]) expect(titles).toContain(w);
    for (const s of SUGGESTIONS) expect(Object.keys(s)).not.toContain("next_due_on");
  });
});

describe("MaintenanceCard", () => {
  it("shows Nothing scheduled yet when empty", () => {
    render(<MaintenanceCard items={[]} today={TODAY} />);
    expect(screen.getByText("Nothing scheduled yet")).toBeTruthy();
  });
  it("shows at most three, flagging overdue", () => {
    const items = ["2026-10-01", "2026-10-25", "2026-11-01", "2026-11-10"].map((d, i) => item({ title: `T${i}`, next_due_on: d }));
    render(<MaintenanceCard items={items} today={TODAY} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/Overdue, due 01\/Oct\/2026/)).toBeTruthy();
  });
  it("handles a load failure", () => {
    render(<MaintenanceCard items={null} today={TODAY} />);
    expect(screen.getByText("Could not load this right now.")).toBeTruthy();
  });
});
