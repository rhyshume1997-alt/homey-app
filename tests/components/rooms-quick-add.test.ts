import { describe, expect, it } from "vitest";
import { QUICK_ADD_ROOMS, nextRoomName, normaliseRoomName, quickAddChips } from "@/components/rooms/quickAdd";

const names = (existing: string[]) => quickAddChips(existing).map((c) => c.name);

describe("quickAddChips", () => {
  it("offers all eleven common rooms, in order, when the household has none", () => {
    expect(names([])).toEqual([
      "Kitchen", "Living room", "Dining room", "Bedroom", "Bathroom", "Hallway",
      "Garden", "Garage", "Office", "Utility room", "Loft",
    ]);
    expect(QUICK_ADD_ROOMS).toHaveLength(11);
  });

  it("hides a single-use chip once a room with that name exists", () => {
    const out = names(["Kitchen", "Loft"]);
    expect(out).not.toContain("Kitchen");
    expect(out).not.toContain("Loft");
    expect(out).toContain("Living room");
    expect(out).toHaveLength(9);
  });

  it("matches existing rooms case-insensitively and ignores extra spaces", () => {
    const out = names(["  kitchen ", "LIVING   ROOM", "utility ROOM"]);
    expect(out).not.toContain("Kitchen");
    expect(out).not.toContain("Living room");
    expect(out).not.toContain("Utility room");
  });

  it("does not hide a chip for a different name that only contains it", () => {
    expect(names(["Main kitchen"])).toContain("Kitchen");
  });

  it("keeps Bedroom and Bathroom, and numbers them once one exists", () => {
    expect(names(["Bedroom"])).toContain("Bedroom 2");
    expect(names(["Bedroom"])).not.toContain("Bedroom");
    expect(names(["bathroom"])).toContain("Bathroom 2");
    expect(names(["Bedroom", "Bedroom 2"])).toContain("Bedroom 3");
  });

  it("reuses a free plain name when only numbered rooms exist", () => {
    expect(names(["Bedroom 3"])).toContain("Bedroom");
  });

  it("treats numbered names case-insensitively", () => {
    expect(names(["BEDROOM", "bedroom 2"])).toContain("Bedroom 3");
  });

  it("never hides Bedroom or Bathroom however many rooms exist", () => {
    const out = names(["Bedroom", "Bedroom 2", "Bedroom 3", "Bathroom"]);
    expect(out).toContain("Bedroom 4");
    expect(out).toContain("Bathroom 2");
    expect(out).toHaveLength(QUICK_ADD_ROOMS.length);
  });

  it("only shows chips that are not already present for the seeded-style list", () => {
    const out = names(["Kitchen", "Living room", "Bathroom", "Hallway"]);
    expect(out).toEqual(["Dining room", "Bedroom", "Bathroom 2", "Garden", "Garage", "Office", "Utility room", "Loft"]);
  });
});

describe("nextRoomName", () => {
  it("returns the base when free and then counts up from 2", () => {
    expect(nextRoomName("Bedroom", new Set())).toBe("Bedroom");
    expect(nextRoomName("Bedroom", new Set(["bedroom"]))).toBe("Bedroom 2");
    expect(nextRoomName("Bedroom", new Set(["bedroom", "bedroom 2"]))).toBe("Bedroom 3");
  });
});

describe("normaliseRoomName", () => {
  it("trims, collapses spaces and lower cases", () => {
    expect(normaliseRoomName("  Living   Room ")).toBe("living room");
  });
});
