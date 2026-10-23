import { describe, expect, it } from "vitest";
import { mapActivity, toThankable } from "./activity";

const now = new Date("2026-10-24T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const row = (id: number, action: string, summary: string | null, h = 1) => ({ id, action, summary, created_at: ago(h) });

describe("toThankable", () => {
  it("phrases each supported action", () => {
    expect(toThankable(row(1, "task.completed", "Hoover stairs"), "Sam")?.text).toBe("Sam did Hoover stairs. Want to say thanks?");
    expect(toThankable(row(2, "shopping.bought", "milk"), "Sam")?.text).toBe("Sam bought milk. Say thanks?");
    expect(toThankable(row(3, "snag.fixed", "Dripping tap"), "Sam")?.text).toContain("fixed Dripping tap");
    expect(toThankable(row(4, "maintenance.done", "Boiler service"), "Sam")?.text).toContain("Boiler service");
  });
  it("ignores other actions and empty summaries", () => {
    expect(toThankable(row(5, "task.created", "x"), "R")).toBeNull();
    expect(toThankable(row(6, "task.completed", "  "), "R")).toBeNull();
    expect(toThankable(row(7, "task.completed", null), "R")).toBeNull();
  });
});

describe("mapActivity", () => {
  it("builds activity NeedItems keyed by audit id", () => {
    const [x] = mapActivity([row(10, "task.completed", "Bins")], "Sam", new Set(), now);
    expect(x?.item).toMatchObject({
      key: "kudos:10",
      bucket: "activity",
      kind: "activity",
      light: "green",
      href: "/activity",
      action: { type: "draft_thanks" },
    });
  });
  it("skips thanked, older than 24h, and caps at 3 newest first", () => {
    const rows = [
      row(1, "task.completed", "a"),
      row(2, "task.completed", "b"),
      row(3, "task.completed", "c"),
      row(4, "task.completed", "d"),
      row(5, "task.completed", "e", 30),
      row(6, "task.completed", "f"),
    ];
    const out = mapActivity(rows, "R", new Set([6]), now).map((x) => x.item.key);
    expect(out).toEqual(["kudos:4", "kudos:3", "kudos:2"]);
  });
});
