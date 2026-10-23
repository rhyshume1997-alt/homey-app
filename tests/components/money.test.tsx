// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { RenewalList } from "@/components/money/RenewalList";
import { ExpenseList } from "@/components/money/ExpenseList";
import { FigureCheckList } from "@/components/money/FigureCheckList";
import type { HouseholdRecord } from "@/contracts/records";

afterEach(cleanup);
const action = vi.fn(async () => null);
let n = 0;
const rec = (o: Partial<HouseholdRecord>): HouseholdRecord => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  household_id: "00000000-0000-4000-8000-0000000000aa",
  category: "insurance", provider: null, title: "Item", amount: null, unit: null, amount_kind: null,
  frequency: null, start_date: null, renewal_date: null, end_date: null, next_action: null,
  reference_last4: null, status: null, source: null, verified: false, as_of: null, import_key: null,
  created_by: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...o,
});
const today = "2026-10-21";

describe("RenewalList", () => {
  const rows = [
    rec({ title: "Later", renewal_date: "2027-03-01" }),
    rec({ title: "Sooner by end", renewal_date: "2027-06-01", end_date: "2026-12-01", provider: "Acme", next_action: "Switch", reference_last4: "9876" }),
    rec({ title: "Past", end_date: "2026-10-11" }),
    rec({ title: "No dates" }),
  ];

  it("sorts by earliest date, drops undated, shows relative days and formatted dates", () => {
    render(<RenewalList records={rows} today={today} verifyAction={action} />);
    const items = screen.getAllByTestId("renewal-row");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("Past");
    expect(items[0]!.textContent).toContain("11/Oct/2026 (10 days ago)");
    expect(items[1]!.textContent).toContain("Sooner by end");
    expect(items[1]!.textContent).toContain("01/Dec/2026 (in 41 days)");
    expect(items[2]!.textContent).toContain("Later");
    expect(screen.queryByText("No dates")).toBeNull();
  });

  it("shows a traffic-light pill word on every row, shows next action and masked ref only when present", () => {
    render(<RenewalList records={rows} today={today} verifyAction={action} />);
    const items = screen.getAllByTestId("renewal-row");
    expect(within(items[0]!).getByText("Overdue")).toBeTruthy();
    expect(within(items[1]!).getByText("On track")).toBeTruthy();
    expect(within(items[2]!).getByText("On track")).toBeTruthy();
    expect(within(items[0]!).getByText("Overdue").closest("[data-light]")?.getAttribute("data-light")).toBe("red");
    expect(screen.queryByText("Upcoming")).toBeNull();
    expect(within(items[1]!).getByText("Switch")).toBeTruthy();
    expect(within(items[1]!).getByText("ref ••9876")).toBeTruthy();
    expect(within(items[0]!).queryByText(/ref/)).toBeNull();
  });

  it("has Mark verified buttons, empty and error states", () => {
    const { rerender } = render(<RenewalList records={rows} today={today} verifyAction={action} />);
    expect(screen.getAllByRole("button", { name: "Mark verified" })).toHaveLength(3);
    rerender(<RenewalList records={[]} today={today} verifyAction={action} />);
    expect(screen.getByText("Nothing recorded yet.")).toBeTruthy();
    rerender(<RenewalList records={null} today={today} verifyAction={action} />);
    expect(screen.getByText("Could not load this right now.")).toBeTruthy();
  });
});

describe("ExpenseList", () => {
  const rows = [
    rec({ category: "broadband", title: "Broadband", amount: 1234.56, unit: "GBP", amount_kind: "estimate", frequency: "annual estimated" }),
    rec({ category: "electricity", title: "Electricity budget", amount: 95, unit: "GBP", amount_kind: "budget", frequency: "monthly budget", verified: true }),
    rec({ category: "electricity", title: "Electricity usage", amount: 3100, unit: "kWh", amount_kind: "estimate" }),
    rec({ category: "council_tax", title: "Unknown amount", amount: null, unit: "GBP" }),
  ];

  it("groups by label, formats currency, shows kind and frequency, excludes kWh and null amounts", () => {
    render(<ExpenseList records={rows} verifyAction={action} />);
    const groups = screen.getAllByTestId("expense-group");
    expect(groups.map((g) => within(g).getByRole("heading").textContent)).toEqual(["Broadband", "Electricity"]);
    expect(screen.getByText("£1,234.56")).toBeTruthy();
    expect(screen.getByText(/annual estimated/)).toBeTruthy();
    expect(screen.getByText("Estimate")).toBeTruthy();
    expect(screen.getByText("Budget")).toBeTruthy();
    expect(screen.queryByText("Electricity usage")).toBeNull();
    expect(screen.queryByText(/3,?100/)).toBeNull();
    expect(screen.queryByText("Unknown amount")).toBeNull();
  });

  it("marks unverified only, and shows no totals", () => {
    render(<ExpenseList records={rows} verifyAction={action} />);
    expect(screen.getAllByText("Unverified")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Mark verified" })).toHaveLength(1);
    expect(screen.queryByText(/total/i)).toBeNull();
    expect(screen.queryByText("£1,226.96")).toBeNull();
  });

  it("empty and error states", () => {
    const { rerender } = render(<ExpenseList records={[]} verifyAction={action} />);
    expect(screen.getByText("Nothing recorded yet.")).toBeTruthy();
    rerender(<ExpenseList records={null} verifyAction={action} />);
    expect(screen.getByText("Could not load this right now.")).toBeTruthy();
  });
});

describe("FigureCheckList", () => {
  const rows = [
    rec({ title: "Electric bill", category: "electricity", amount: 42.17, unit: "GBP", amount_kind: "bill", frequency: "monthly", source: "master record", as_of: "2026-01-15" }),
    rec({ title: "Usage", category: "electricity", amount: 2900, unit: "kWh", amount_kind: "estimate" }),
    rec({ title: "Council tax", category: "council_tax", amount: 150, unit: "GBP", verified: true }),
    rec({ title: "No figure" }),
  ];

  it("lists only unchecked figures with an editable amount, and shows progress", () => {
    render(<FigureCheckList records={rows} action={action} />);
    expect(screen.getByTestId("figure-progress").textContent).toBe("1 of 3 figures checked");
    const items = screen.getAllByTestId("figure-row");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("£42.17");
    expect(items[0]!.textContent).toContain("as of 15/Jan/2026");
    expect((within(items[0]!).getByLabelText(/Correct amount \(£\)/) as HTMLInputElement).value).toBe("42.17");
    expect(items[1]!.textContent).toContain("2,900 kWh");
    expect(within(items[1]!).getByLabelText(/Correct amount \(kWh\)/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Mark checked" })).toHaveLength(2);
    expect(screen.queryByText("Council tax")).toBeNull();
    expect(screen.queryByText("No figure")).toBeNull();
  });

  it("all checked, empty and error states", () => {
    const { rerender } = render(<FigureCheckList records={[rows[2]!]} action={action} />);
    expect(screen.getByText("All figures are checked.")).toBeTruthy();
    rerender(<FigureCheckList records={[]} action={action} />);
    expect(screen.getByText("No figures recorded yet.")).toBeTruthy();
    rerender(<FigureCheckList records={null} action={action} />);
    expect(screen.getByText("Could not load this right now.")).toBeTruthy();
  });
});
