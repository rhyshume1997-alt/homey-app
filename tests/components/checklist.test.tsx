// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ChecklistSection } from "@/components/checklist/ChecklistSection";
import { confirmText, groupBySeason, type ChecklistActions, type ChecklistItem } from "@/components/checklist/types";

afterEach(cleanup);

const TODAY = "2026-10-22";
let n = 0;
const item = (o: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  title: "Bleed radiators",
  season: "autumn",
  frequency: "yearly",
  month: 10,
  room_id: null,
  last_done_on: null,
  next_due_on: "2026-10-01",
  notes: null,
  ...o,
});
const noop = async () => null;
const actions: ChecklistActions = { markDone: noop, addTask: noop };

describe("groupBySeason", () => {
  it("groups in season order and puts overdue first", () => {
    const g = groupBySeason(
      [
        item({ title: "Later", next_due_on: "2027-03-01" }),
        item({ title: "Overdue", next_due_on: "2026-10-01" }),
        item({ title: "Spring one", season: "spring" }),
      ],
      TODAY,
    );
    expect(g.map((x) => x.label)).toEqual(["Autumn", "Spring"]);
    expect(g[0].items.map((i) => i.title)).toEqual(["Overdue", "Later"]);
  });
});

describe("confirmText", () => {
  it("names the item and its due date", () => {
    expect(confirmText({ title: "Bleed radiators", next_due_on: "2026-10-01" }, TODAY, { order: "DMY", month: "short" })).toBe(
      "Add 'Bleed radiators' to Tasks, due 01/Oct/2026?",
    );
  });
});

describe("ChecklistSection", () => {
  it("shows season headings with status pills", () => {
    render(<ChecklistSection items={[item(), item({ title: "Clear gutters", next_due_on: "2026-10-25" })]} today={TODAY} actions={actions} />);
    expect(screen.getByRole("region", { name: "Autumn" })).toBeTruthy();
    const rows = screen.getAllByTestId("checklist-row");
    expect(within(rows[0]).getByText("Overdue")).toBeTruthy();
    expect(within(rows[1]).getByText("Due soon")).toBeTruthy();
  });

  it("does not create a task until Confirm, and Cancel closes the dialog", () => {
    const addTask = vi.fn(async () => ({ ok: true }));
    render(<ChecklistSection items={[item()]} today={TODAY} actions={{ markDone: noop, addTask }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Bleed radiators to Tasks" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/Add 'Bleed radiators' to Tasks, due/)).toBeTruthy();
    expect(addTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(addTask).not.toHaveBeenCalled();
  });

  it("has Mark done, and hides the pill and + Task for items covered by a task", () => {
    render(
      <ChecklistSection
        items={[item({ title: "Boiler service", season: "any", notes: "Covered by task: already tracked." })]}
        today={TODAY}
        actions={actions}
      />,
    );
    expect(screen.getByRole("button", { name: "Mark Boiler service done" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /to Tasks/ })).toBeNull();
    expect(screen.queryByText("Overdue")).toBeNull();
    expect(screen.getByText(/Covered by task/)).toBeTruthy();
  });
});
