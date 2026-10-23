// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RoomList, type RoomActions } from "@/components/rooms/RoomList";
import { RoomItems } from "@/components/rooms/RoomItems";
import { RoomExtras } from "@/components/rooms/RoomExtras";
import { DEFAULT_DATE_PREFS } from "@/components/dates";
import { RoomPicker } from "@/components/rooms/RoomPicker";
import { countLabel, summariseRoom } from "@/components/rooms/summary";
import type { Room } from "@/contracts/rooms";
import type { Task } from "@/contracts/tasks";
import type { Snag } from "@/contracts/snags";

afterEach(cleanup);

const H = "22222222-2222-4222-8222-222222222222";
const R1 = "33333333-3333-4333-8333-333333333331";
const R2 = "33333333-3333-4333-8333-333333333332";
const room = (o: Partial<Room>): Room => ({
  id: R1, household_id: H, name: "Kitchen", sort_order: 10, notes: null, created_by: null,
  created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z", ...o,
});
let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const task = (o: Partial<Task>): Task => ({
  id: uid(), household_id: H, title: "T", notes: null, assignee_user_id: null, due_date: null, recurrence: "none",
  status: "open", completed_at: null, completed_by: null, created_by: null, created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z", next_task_id: null, room_id: R1, ...o,
});
const snag = (o: Partial<Snag>): Snag => ({
  id: uid(), household_id: H, title: "S", location: null, notes: null, status: "open", priority: "medium",
  fixed_at: null, created_by: null, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z",
  room_id: R1, ...o,
});
const noop = async () => null;
const actions: RoomActions = { create: noop, rename: noop, move: noop, remove: noop };
const TODAY = "2026-10-22";

describe("summariseRoom", () => {
  it("counts only open items in the room and takes the worst light", () => {
    const s = summariseRoom(
      R1,
      [task({ due_date: "2026-10-20" }), task({ due_date: "2026-10-23" }), task({ status: "done", due_date: "2026-10-01" }), task({ room_id: R2, due_date: "2026-10-01" })],
      [snag({ priority: "low" }), snag({ status: "fixed", priority: "high" })],
      TODAY,
    );
    expect(s).toMatchObject({ tasks: 2, snags: 1, worst: "red" });
    expect(s.lights).toEqual(["red", "amber", "green"]);
  });
  it("lights snags like the snag list: stale after 30 days amber, otherwise green, priority ignored", () => {
    const s = summariseRoom(
      R1,
      [],
      [
        snag({ priority: "high", created_at: "2026-10-20T10:00:00Z" }),
        snag({ priority: "low", created_at: "2026-08-01T10:00:00Z" }),
        snag({ priority: "high", status: "in_progress", created_at: "2026-09-22T10:00:00Z" }),
      ],
      TODAY,
    );
    expect(s.lights).toEqual(["green", "amber", "green"]);
    expect(s.worst).toBe("amber");
  });
  it("is green and empty for a room with nothing open", () => {
    const s = summariseRoom(R1, [], [], TODAY);
    expect(s).toMatchObject({ worst: "green" });
    expect(countLabel(s)).toBe("No open items");
  });
  it("labels counts", () => {
    expect(countLabel({ tasks: 1, snags: 2 })).toBe("1 task · 2 snags");
  });
});

describe("RoomList", () => {
  const rooms = [room({}), room({ id: R2, name: "WC", sort_order: 20 })];
  const summaries = { [R1]: summariseRoom(R1, [task({ due_date: "2026-10-01" })], [], TODAY) };

  it("shows each room with a counted, worded light pill and a link", () => {
    render(<RoomList rooms={rooms} summaries={summaries} actions={actions} />);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Overdue")).toBeTruthy();
    expect(within(items[0]).getByText("1 task")).toBeTruthy();
    expect(within(items[1]).getByText("On track")).toBeTruthy();
    expect(within(items[1]).getByText("No open items")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Kitchen/ }).getAttribute("href")).toBe(`/rooms/${R1}`);
  });

  it("only offers moves that make sense", () => {
    render(<RoomList rooms={rooms} summaries={summaries} actions={actions} />);
    expect(screen.getAllByRole("button", { name: "Move up" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Move down" })).toHaveLength(1);
  });

  it("asks for confirmation before deleting", () => {
    render(<RoomList rooms={rooms} summaries={summaries} actions={actions} />);
    expect(screen.queryByRole("button", { name: "Yes, delete room" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete Kitchen" }));
    expect(screen.getByRole("alertdialog").textContent).toMatch(/no longer linked/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("RoomItems", () => {
  it("lists tasks and snags with pills, and says so when empty", () => {
    const { rerender } = render(
      <RoomItems tasks={[task({ title: "Descale kettle", due_date: "2026-10-23" })]} snags={[snag({ title: "Loose socket", priority: "high" })]} today={TODAY} />,
    );
    expect(screen.getByText("Descale kettle")).toBeTruthy();
    expect(screen.getByText("Due soon")).toBeTruthy();
    expect(screen.getByText("On track")).toBeTruthy();
    expect(screen.getByText(/High priority/)).toBeTruthy();
    rerender(<RoomItems tasks={[]} snags={[]} today={TODAY} />);
    expect(screen.getByText("No open tasks or snags.")).toBeTruthy();
  });
});

describe("RoomExtras", () => {
  it("shows things to get and appliances for the room", () => {
    render(
      <RoomExtras
        wishlist={{ ok: true, data: [] }}
        appliances={{ ok: true, data: [] }}
        today={TODAY}
        prefs={DEFAULT_DATE_PREFS}
      />,
    );
    expect(screen.getByRole("heading", { name: "Things to get" })).toBeTruthy();
    expect(screen.getByText("Nothing to get for this room.")).toBeTruthy();
    expect(screen.getByText("No appliances in this room.")).toBeTruthy();
  });
  it("fails soft per section", () => {
    render(
      <RoomExtras
        wishlist={{ ok: false, error: "Could not load this right now." }}
        appliances={{ ok: true, data: [] }}
        today={TODAY}
        prefs={DEFAULT_DATE_PREFS}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Things to get: Could not load");
    expect(screen.getByText("No appliances in this room.")).toBeTruthy();
  });
});

describe("RoomPicker", () => {
  it("renders an optional select preselected to the current room", () => {
    render(<RoomPicker rooms={[{ id: R1, name: "Kitchen" }, { id: R2, name: "WC" }]} value={R2} />);
    const sel = screen.getByLabelText("Room (optional)") as HTMLSelectElement;
    expect(sel.value).toBe(R2);
    expect(within(sel).getByRole("option", { name: "No room" })).toBeTruthy();
  });
  it("keeps the existing room in a hidden field when no rooms were loaded", () => {
    const { container } = render(<RoomPicker value={R1} />);
    expect((container.querySelector('input[name="room_id"]') as HTMLInputElement).value).toBe(R1);
  });
  it("renders nothing with no rooms and no value", () => {
    const { container } = render(<RoomPicker value={null} />);
    expect(container.innerHTML).toBe("");
  });
});
