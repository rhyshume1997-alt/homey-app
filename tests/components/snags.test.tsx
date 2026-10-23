// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SnagList, type SnagActions } from "@/components/snags/SnagList";
import { groupSnags } from "@/components/snags/group";
import type { Snag } from "@/contracts/snags";

afterEach(cleanup);

let n = 0;
const snag = (o: Partial<Snag>): Snag => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  household_id: "22222222-2222-4222-8222-222222222222",
  title: "S", location: null, notes: null, status: "open", priority: "medium", fixed_at: null,
  created_by: null, created_at: `2026-10-0${(n % 9) + 1}T10:00:00Z`, updated_at: "2026-10-01T10:00:00Z", ...o,
});
const noop = async () => null;
const actions: SnagActions = { create: noop, update: noop, setStatus: noop, remove: noop };

describe("groupSnags", () => {
  it("groups by status and orders by priority", () => {
    const g = groupSnags([
      snag({ title: "low", priority: "low" }),
      snag({ title: "high", priority: "high" }),
      snag({ title: "med" }),
      snag({ title: "done", status: "fixed" }),
    ]);
    expect(g.open.map((s) => s.title)).toEqual(["high", "med", "low"]);
    expect(g.fixed.map((s) => s.title)).toEqual(["done"]);
    expect(g.reported).toEqual([]);
  });
});

describe("SnagList", () => {
  it("renders status groups in order with priority badges; fixed is collapsed", () => {
    render(
      <SnagList
        actions={actions}
        snags={[
          snag({ title: "Door sticks", location: "Hall", priority: "high" }),
          snag({ title: "Paint chip", status: "in_progress" }),
          snag({ title: "Tap", status: "fixed", fixed_at: "2026-10-02T00:00:00Z" }),
        ]}
      />,
    );
    expect(screen.getAllByTestId("snag-group").map((g) => g.getAttribute("aria-label"))).toEqual([
      "Open", "In progress", "Fixed",
    ]);
    const open = screen.getByRole("region", { name: "Open" });
    const badges = within(open).getAllByText("High priority").filter((el) => el.tagName === "SPAN");
    expect(badges).toHaveLength(1);
    expect(within(open).getByText("Hall")).toBeTruthy();
    const fixed = screen.getAllByTestId("snag-group")[2] as HTMLDetailsElement;
    expect(fixed.open).toBe(false);
  });

  it("labels snags Stale after 30 days open, On track otherwise, and Fixed", () => {
    render(
      <SnagList
        actions={actions}
        today="2026-10-21"
        snags={[
          snag({ title: "Old", created_at: "2026-08-01T10:00:00Z" }),
          snag({ title: "New", created_at: "2026-10-15T10:00:00Z" }),
          snag({ title: "Done", status: "fixed", created_at: "2026-01-01T10:00:00Z" }),
        ]}
      />,
    );
    const rows = screen.getAllByTestId("snag-row");
    expect(within(rows[0]!).getByText("Stale")).toBeTruthy();
    expect(within(rows[1]!).getByText("On track")).toBeTruthy();
    expect(within(rows[2]!).getByText("Fixed")).toBeTruthy();
  });

  it("passes rooms to the edit form so the room picker shows", () => {
    const R = "33333333-3333-4333-8333-333333333331";
    render(<SnagList actions={actions} rooms={[{ id: R, name: "Hall" }]} snags={[snag({ title: "Door", room_id: R })]} />);
    const details = screen.getByText("Update or delete").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect((screen.getByLabelText("Room (optional)") as HTMLSelectElement).value).toBe(R);
  });

  it("shows an empty state", () => {
    render(<SnagList actions={actions} snags={[]} />);
    expect(screen.getByText(/No snags logged yet/)).toBeTruthy();
    expect(screen.queryAllByTestId("snag-row")).toHaveLength(0);
  });
});
