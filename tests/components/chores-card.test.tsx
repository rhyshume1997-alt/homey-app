// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ChoresCard, groupChores, type ChoreItem } from "@/components/home/ChoresCard";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
afterEach(cleanup);

const RHYS = "11111111-1111-4111-8111-111111111111";
const RACHEL = "22222222-2222-4222-8222-222222222222";
const members = [{ user_id: RHYS, display_name: "Alex" }, { user_id: RACHEL, display_name: "Sam" }];
const chores: ChoreItem[] = [
  { id: "a", title: "Clean oven", dueDate: "2026-10-19", overdue: true, assigneeId: RACHEL },
  { id: "b", title: "Take bins out", dueDate: "2026-10-21", overdue: false, assigneeId: null },
  { id: "c", title: "Hoover", dueDate: "2026-10-21", overdue: false, assigneeId: RHYS },
];
const noop = async () => null;
const actions = { create: noop, complete: noop, nudge: noop };

describe("ChoresCard", () => {
  it("groups by person, viewer first, Anyone last", () => {
    expect(groupChores(chores, members, RHYS).map((g) => g.name)).toEqual(["Alex", "Sam", "Anyone"]);
  });

  it("shows chores per person, Nudge only for someone else's, and the add form", () => {
    render(<ChoresCard chores={chores} members={members} viewerId={RHYS} today="2026-10-21" actions={actions} />);
    const sam = within(screen.getByRole("group", { name: "Chores for Sam" }));
    expect(sam.getByText("Clean oven")).toBeTruthy();
    expect(sam.getByRole("button", { name: "Nudge" })).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Chores for Alex" })).queryByRole("button", { name: "Nudge" })).toBeNull();
    expect(within(screen.getByRole("group", { name: "Chores for Anyone" })).queryByRole("button", { name: "Nudge" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Done" })).toHaveLength(3);
    const form = within(screen.getByRole("form", { name: "Add a chore" }));
    expect(form.getByLabelText("Chore")).toBeTruthy();
    expect(within(form.getByLabelText("Who")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Anyone", "Alex", "Sam"]);
    expect(within(form.getByLabelText("Repeat")).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual(["none", "daily", "weekly", "monthly"]);
  });

  it("does not offer Nudge for a person no longer in the household", () => {
    render(<ChoresCard chores={[{ ...chores[0], assigneeId: "33333333-3333-4333-8333-333333333333" }]} members={members} viewerId={RHYS} today="2026-10-21" actions={actions} />);
    expect(screen.queryByRole("button", { name: "Nudge" })).toBeNull();
  });

  it("handles empty and unavailable states", () => {
    const { rerender } = render(<ChoresCard chores={[]} members={members} today="2026-10-21" />);
    expect(screen.getByText("No chores due today or overdue.")).toBeTruthy();
    rerender(<ChoresCard chores={null} members={null} today="2026-10-21" />);
    expect(screen.getByText("Could not load this right now.")).toBeTruthy();
  });
});
