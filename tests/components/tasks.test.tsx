// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TaskList, type TaskActions } from "@/components/tasks/TaskList";
import { groupTasks, todayInLondon } from "@/components/tasks/group";
import type { Task } from "@/contracts/tasks";

afterEach(cleanup);

const U1 = "11111111-1111-4111-8111-111111111111";
const H = "22222222-2222-4222-8222-222222222222";
let n = 0;
const task = (o: Partial<Task>): Task => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  household_id: H, title: "T", notes: null, assignee_user_id: null, due_date: null,
  recurrence: "none", status: "open", completed_at: null, completed_by: null, created_by: null, next_task_id: null,
  created_at: `2026-10-0${(n % 9) + 1}T10:00:00Z`, updated_at: "2026-10-01T10:00:00Z", ...o,
});

const noop = async () => null;
const actions: TaskActions = { create: noop, update: noop, complete: noop, reopen: noop, remove: noop };
const members = [{ user_id: U1, display_name: "Alex" }];

describe("groupTasks", () => {
  it("splits by due date relative to today", () => {
    const g = groupTasks(
      [
        task({ title: "late", due_date: "2026-10-20" }),
        task({ title: "now", due_date: "2026-10-21" }),
        task({ title: "soon", due_date: "2026-10-22" }),
        task({ title: "whenever" }),
        task({ title: "finished", status: "done", due_date: "2026-10-01" }),
      ],
      "2026-10-21",
    );
    expect(g.overdue.map((t) => t.title)).toEqual(["late"]);
    expect(g.today.map((t) => t.title)).toEqual(["now"]);
    expect(g.upcoming.map((t) => t.title)).toEqual(["soon"]);
    expect(g.noDate.map((t) => t.title)).toEqual(["whenever"]);
    expect(g.done.map((t) => t.title)).toEqual(["finished"]);
  });

  it("sorts by due date and done by newest completion", () => {
    const g = groupTasks(
      [
        task({ title: "b", due_date: "2026-11-02" }),
        task({ title: "a", due_date: "2026-11-01" }),
        task({ title: "old", status: "done", completed_at: "2026-10-01T00:00:00Z" }),
        task({ title: "new", status: "done", completed_at: "2026-10-05T00:00:00Z" }),
      ],
      "2026-10-21",
    );
    expect(g.upcoming.map((t) => t.title)).toEqual(["a", "b"]);
    expect(g.done.map((t) => t.title)).toEqual(["new", "old"]);
  });

  it("formats today in London time", () => {
    expect(todayInLondon(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(todayInLondon(new Date("2026-01-01T23:30:00Z"))).toBe("2026-01-01");
  });
});

describe("TaskList", () => {
  it("renders groups, assignee names and a collapsed done list", () => {
    render(
      <TaskList
        today="2026-10-21"
        members={members}
        actions={actions}
        tasks={[
          task({ title: "Bins", due_date: "2026-10-20", assignee_user_id: U1 }),
          task({ title: "Hoover", due_date: "2026-10-21" }),
          task({ title: "Paint" }),
          task({ title: "Washed up", status: "done", completed_at: "2026-10-20T10:00:00Z" }),
        ]}
      />,
    );
    expect(screen.getAllByTestId("task-group").map((g) => g.getAttribute("aria-label"))).toEqual([
      "Overdue", "Today", "No date",
    ]);
    const overdue = screen.getByRole("region", { name: "Overdue" });
    expect(within(overdue).getByText("Bins")).toBeTruthy();
    expect(within(overdue).getByText(/^Alex · /)).toBeTruthy();
    const done = screen.getByTestId("done-tasks") as HTMLDetailsElement;
    expect(done.open).toBe(false);
    expect(within(done).getByText("Done (1)")).toBeTruthy();
    expect(within(done).getByRole("button", { name: "Reopen" })).toBeTruthy();
  });

  it("pairs every row with a pill word and summarises the open list", () => {
    render(
      <TaskList
        today="2026-10-21"
        members={members}
        actions={actions}
        tasks={[
          task({ title: "Bins", due_date: "2026-10-20" }),
          task({ title: "Hoover", due_date: "2026-10-23" }),
          task({ title: "Paint", due_date: "2026-12-01" }),
          task({ title: "Washed up", status: "done", completed_at: "2026-10-20T10:00:00Z" }),
        ]}
      />,
    );
    const rows = screen.getAllByTestId("task-row");
    expect(within(rows[0]!).getByText("Overdue")).toBeTruthy();
    expect(within(rows[1]!).getByText("Due soon")).toBeTruthy();
    expect(within(rows[2]!).getByText("On track")).toBeTruthy();
    expect(within(rows[3]!).getByText("Done")).toBeTruthy();
    expect(screen.getByTestId("light-summary").textContent).toBe("1 overdue1 due soon1 on track");
  });

  it("passes rooms to the edit form so the room picker shows", () => {
    const R = "33333333-3333-4333-8333-333333333331";
    render(
      <TaskList today="2026-10-21" members={members} actions={actions} rooms={[{ id: R, name: "Kitchen" }]}
        tasks={[task({ title: "Paint", room_id: R })]} />,
    );
    const details = screen.getByText("Edit or delete").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const sel = screen.getByLabelText("Room (optional)") as HTMLSelectElement;
    expect(sel.value).toBe(R);
  });

  it("shows an empty state with no tasks and no sample data", () => {
    render(<TaskList today="2026-10-21" members={members} actions={actions} tasks={[]} />);
    expect(screen.getByText(/No open tasks/)).toBeTruthy();
    expect(screen.queryAllByTestId("task-row")).toHaveLength(0);
    expect(screen.queryByTestId("done-tasks")).toBeNull();
  });
});
