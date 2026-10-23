// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { HouseholdRecord } from "@/contracts/records";
import type { Snag } from "@/contracts/snags";
import type { Task } from "@/contracts/tasks";
import { computeSuggestions } from "@/components/assistant/suggestions";
import { AiRecommendationsCard } from "@/components/home/AiRecommendationsCard";

const H = "11111111-1111-4111-8111-111111111111";
const stamp = { household_id: H, created_by: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
const rec = (o: Partial<HouseholdRecord>): HouseholdRecord => ({
  ...stamp, id: "22222222-2222-4222-8222-222222222222", category: "gas", provider: null, title: "Gas tariff", amount: null,
  unit: null, amount_kind: null, frequency: null, start_date: null, renewal_date: null, end_date: null, next_action: null,
  reference_last4: null, status: null, source: null, verified: true, as_of: null, import_key: null, ...o,
});
const snag = (o: Partial<Snag>): Snag => ({
  ...stamp, id: "44444444-4444-4444-8444-444444444444", title: "Tile", location: null, notes: null, status: "open",
  priority: "medium", fixed_at: null, ...o,
});
const task = (o: Partial<Task>): Task => ({
  ...stamp, id: "33333333-3333-4333-8333-333333333333", title: "Chore", notes: null, assignee_user_id: null, due_date: null,
  recurrence: "none", status: "open", completed_at: null, completed_by: null, next_task_id: null, ...o,
});
const today = "2026-10-21";
afterEach(cleanup);

describe("computeSuggestions (wrapper over computeNeedsDoing)", () => {
  it("flags a renewal within 30 days with no task", () => {
    const s = computeSuggestions({ tasks: [], snags: [], records: [rec({ renewal_date: "2026-11-10" })], today });
    expect(s.map((x) => x.id)).toEqual([`renewal:${rec({}).id}`]);
    expect(s[0].text).toBe("Gas tariff renews in 20 days");
    expect(s[0].href).toBe("/money");
  });
  it("ignores renewals that already have an open task, are far off, or are past", () => {
    const r = [rec({ renewal_date: "2026-11-10" })];
    expect(computeSuggestions({ tasks: [task({ title: "Review gas tariff" })], snags: [], records: r, today })).toEqual([]);
    expect(computeSuggestions({ tasks: [], snags: [], records: [rec({ renewal_date: "2027-03-01" })], today })).toEqual([]);
    expect(computeSuggestions({ tasks: [], snags: [], records: [rec({ renewal_date: "2026-10-01" })], today })).toEqual([]);
  });
  it("flags snags open over 30 days only", () => {
    const old = snag({ created_at: "2026-09-01T00:00:00Z" });
    const fixed = snag({ created_at: "2026-09-01T00:00:00Z", status: "fixed" });
    const recent = snag({ created_at: "2026-10-10T00:00:00Z" });
    const s = computeSuggestions({ tasks: [], snags: [old, fixed, recent], records: [], today });
    expect(s).toHaveLength(1);
    expect(s[0].text).toContain("1 snag has been open");
  });
  it("counts unverified figures but not null amounts", () => {
    const s = computeSuggestions({
      tasks: [], snags: [], today,
      records: [rec({ amount: 5, unit: "GBP", verified: false }), rec({ amount: 6, unit: "GBP", verified: false }), rec({ amount: null, verified: false })],
    });
    expect(s[0].text).toBe("2 figures are still unverified");
  });
  it("returns at most 3, most urgent first", () => {
    const s = computeSuggestions({
      today,
      tasks: [task({ title: "Overdue chore", due_date: "2026-10-01" })],
      snags: [snag({ created_at: "2026-01-01T00:00:00Z" })],
      records: [rec({ renewal_date: "2026-10-25", amount: 1, unit: "GBP", verified: false })],
    });
    expect(s).toHaveLength(3);
    expect(s[0].text).toBe("Overdue chore");
  });
});

describe("AiRecommendationsCard", () => {
  it("renders fully with no API key, with a status pill, and links to the assistant", () => {
    render(<AiRecommendationsCard tasks={[]} snags={[]} records={[rec({ amount: 5, unit: "GBP", verified: false })]} today={today} />);
    expect(screen.getByRole("heading", { name: "Suggestions" })).toBeTruthy();
    expect(screen.getByText("1 figure is still unverified")).toBeTruthy();
    expect(screen.getByRole("link", { name: "1 figure is still unverified" }).getAttribute("href")).toBe("/money/check");
    expect(screen.getAllByText("On track").length).toBe(1);
    expect(screen.getByRole("link", { name: "Ask the assistant" }).getAttribute("href")).toBe("/assistant");
  });
  it("shows only the top 3 items", () => {
    const tasks = [1, 2, 3, 4].map((n) => task({ id: `33333333-3333-4333-8333-33333333333${n}`, title: `Chore ${n}`, due_date: "2026-10-20" }));
    render(<AiRecommendationsCard tasks={tasks} snags={[]} records={[]} today={today} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
  it("Open what needs doing dispatches homey:open", () => {
    const seen = vi.fn();
    window.addEventListener("homey:open", seen);
    render(<AiRecommendationsCard tasks={[]} snags={[]} records={[]} today={today} />);
    fireEvent.click(screen.getByRole("button", { name: "Open what needs doing" }));
    window.removeEventListener("homey:open", seen);
    expect(seen).toHaveBeenCalledTimes(1);
  });
  it("says nothing needs attention when empty, and notes partial data", () => {
    render(<AiRecommendationsCard tasks={[]} snags={null} records={[]} today={today} />);
    expect(screen.getByText("Nothing needs attention right now.")).toBeTruthy();
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
  });
});
