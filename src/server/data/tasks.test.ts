import { describe, expect, it } from "vitest";
import { parseId, parseTaskForm } from "./tasks";
import { parseSnagForm, parseStatus } from "./snags";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("parseTaskForm", () => {
  it("turns blanks into null and trims", () => {
    const r = parseTaskForm(fd({ title: "  Bins ", notes: "", assignee_user_id: "", due_date: "", recurrence: "weekly" }));
    expect(r).toMatchObject({ title: "Bins", notes: null, assignee_user_id: null, due_date: null, recurrence: "weekly" });
  });
  it("accepts yearly", () => {
    expect(parseTaskForm(fd({ title: "Boiler service", recurrence: "yearly" }))).toMatchObject({ recurrence: "yearly" });
  });
  it("rejects bad input", () => {
    expect(parseTaskForm(fd({ title: "  " }))).toBeNull();
    expect(parseTaskForm(fd({ title: "x", assignee_user_id: "nope" }))).toBeNull();
    expect(parseTaskForm(fd({ title: "x", due_date: "tomorrow" }))).toBeNull();
    expect(parseTaskForm(fd({ title: "x", recurrence: "hourly" }))).toBeNull();
  });
  it("ignores household_id supplied by the client", () => {
    const r = parseTaskForm(fd({ title: "x", household_id: "22222222-2222-4222-8222-222222222222" }));
    expect(r).not.toHaveProperty("household_id");
  });
});

describe("room_id parsing", () => {
  const room = "33333333-3333-4333-8333-333333333333";
  it("accepts a uuid or blank for tasks and snags", () => {
    expect(parseTaskForm(fd({ title: "x", room_id: room }))).toMatchObject({ room_id: room });
    expect(parseTaskForm(fd({ title: "x", room_id: "" }))).toMatchObject({ room_id: null });
    expect(parseSnagForm(fd({ title: "x", room_id: room }))).toMatchObject({ room_id: room });
    expect(parseSnagForm(fd({ title: "x" }))).toMatchObject({ room_id: null });
  });
  it("rejects a non-uuid room", () => {
    expect(parseTaskForm(fd({ title: "x", room_id: "kitchen" }))).toBeNull();
    expect(parseSnagForm(fd({ title: "x", room_id: "kitchen" }))).toBeNull();
  });
});

describe("parseId", () => {
  it("requires a uuid", () => {
    expect(parseId(fd({ id: "1" }))).toBeNull();
    expect(parseId(fd({}))).toBeNull();
    expect(parseId(fd({ id: "22222222-2222-4222-8222-222222222222" }))).not.toBeNull();
  });
});

describe("snag parsing", () => {
  it("defaults status and priority, rejects bad values", () => {
    expect(parseSnagForm(fd({ title: "Crack", location: "" }))).toMatchObject({ status: "open", priority: "medium", location: null });
    expect(parseSnagForm(fd({ title: "x", priority: "urgent" }))).toBeNull();
    expect(parseStatus(fd({ status: "fixed" }))).toBe("fixed");
    expect(parseStatus(fd({ status: "gone" }))).toBeNull();
  });
});
