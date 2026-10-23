import { describe, expect, it } from "vitest";
import { countLights, daysUntil, trafficLight, worstLight } from "@/components/status";

const T = "2026-10-22";

describe("trafficLight", () => {
  it.each([
    ["task", "2026-10-21", "red"],
    ["task", "2026-10-22", "amber"],
    ["task", "2026-10-29", "amber"],
    ["task", "2026-10-30", "green"],
    ["renewal", "2026-11-21", "amber"],
    ["renewal", "2026-11-22", "green"],
    ["renewal", "2026-10-01", "red"],
    ["warranty", "2026-11-10", "amber"],
    ["bins", "2026-10-23", "amber"],
    ["bins", "2026-10-24", "green"],
    ["bins", "2026-10-21", "green"],
    ["event", "2026-10-22", "amber"],
    ["event", "2026-10-23", "green"],
  ] as const)("%s due %s is %s", (kind, date, light) => {
    expect(trafficLight(kind, date, T)).toBe(light);
  });

  it("done or undated items are green", () => {
    expect(trafficLight("task", "2026-01-01", T, true)).toBe("green");
    expect(trafficLight("task", null, T)).toBe("green");
  });

  it("counts and picks the worst", () => {
    expect(daysUntil(T, "2026-10-25")).toBe(3);
    expect(countLights(["red", "amber", "amber", "green"])).toEqual({ red: 1, amber: 2, green: 1 });
    expect(worstLight(["green", "amber"])).toBe("amber");
    expect(worstLight([])).toBe("green");
  });
});
