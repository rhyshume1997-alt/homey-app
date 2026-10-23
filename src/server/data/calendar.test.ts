import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ warranty: vi.fn(), due: vi.fn() }));
vi.mock("@/server/db/supabase", () => ({ createUserClient: async () => null }));
vi.mock("./appliances", () => ({ listWarrantyEnds: mocks.warranty }));
vi.mock("./checklist", () => ({ listDueChecklist: mocks.due }));

import { CALENDAR_SOURCES, checklist, loadCalendarItems, warranties } from "./calendar";

const range = { from: "2026-10-01", to: "2026-11-30", today: "2026-10-22" };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  mocks.warranty.mockReset();
  mocks.due.mockReset();
});

describe("warranty source", () => {
  it("maps warranty ends in range with an id-only link and the 30-day light", async () => {
    mocks.warranty.mockResolvedValue([
      { id: A, name: "Boiler", warranty_end: "2026-11-10" },
      { id: B, name: "Fridge", warranty_end: "2027-05-01" },
      { id: "../evil", name: "Bad", warranty_end: "2026-10-25" },
    ]);
    const items = await warranties(range);
    expect(items).toEqual([{
      key: `warranty:${A}`, date: "2026-11-10", title: "Boiler warranty ends", kind: "warranty",
      light: "amber", href: `/appliances/${A}`,
    }]);
  });
});

describe("checklist source", () => {
  it("asks for the range window and keeps only dates inside it", async () => {
    mocks.due.mockResolvedValue({ ok: true, data: [
      { id: A, title: "Bleed radiators", season: "autumn", room_id: null, next_due_on: "2026-09-01" },
      { id: B, title: "Clear gutters", season: "autumn", room_id: null, next_due_on: "2026-10-20" },
    ] });
    const items = await checklist(range);
    expect(mocks.due).toHaveBeenCalledWith("2026-10-22", 39);
    expect(items).toEqual([{
      key: `checklist:${B}`, date: "2026-10-20", title: "Clear gutters", kind: "checklist",
      light: "red", href: "/checklist",
    }]);
  });

  it("throws on a failed load so the calendar counts it", async () => {
    mocks.due.mockResolvedValue({ ok: false, error: "nope" });
    await expect(checklist(range)).rejects.toThrow();
  });
});

describe("CALENDAR_SOURCES", () => {
  it("includes warranties and checklist; a failing source does not block others", async () => {
    expect(CALENDAR_SOURCES).toContain(warranties);
    expect(CALENDAR_SOURCES).toContain(checklist);
    mocks.warranty.mockResolvedValue([{ id: A, name: "Oven", warranty_end: "2026-10-30" }]);
    mocks.due.mockResolvedValue({ ok: false, error: "nope" });
    const r = await loadCalendarItems(range);
    expect(r.items.map((i) => i.key)).toEqual([`warranty:${A}`]);
    expect(r.failed).toBeGreaterThan(0);
  });
});
