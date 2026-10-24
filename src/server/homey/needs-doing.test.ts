import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HouseholdSession } from "@/server/auth/session";

const H = "11111111-1111-4111-8111-111111111111";
const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, { data: unknown; error: unknown } | "throw">,
  bins: { ok: true, days: [], lastSynced: null } as unknown,
  maint: { ok: true, data: [] } as unknown,
  supplies: { ok: true, data: [] } as unknown,
  session: null as unknown,
}));

vi.mock("@/server/db/supabase", () => ({
  createUserClient: async () => ({
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "limit"]) b[m] = () => b;
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        const t = mocks.tables[table];
        return t === "throw" ? rej(new Error("boom")) : res(t ?? { data: [], error: null });
      };
      return b;
    },
  }),
}));
vi.mock("@/server/data/bins", () => ({ loadBins: async () => mocks.bins }));
vi.mock("@/server/data/maintenance", () => ({ listMaintenance: async () => mocks.maint }));
vi.mock("@/server/data/shopping", () => ({ listSupplies: async () => mocks.supplies }));
vi.mock("@/server/auth/session", () => ({ getSession: async () => mocks.session }));

import { getNeedsCount, getNeedsDoing, worstLightFor } from "./needs-doing";

const S = { userId: "u", householdId: H } as unknown as HouseholdSession;
const stamp = { household_id: H, created_by: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
const taskRow = (id: string, due: string) => ({
  ...stamp, id, title: "Chore", notes: null, assignee_user_id: null, due_date: due, recurrence: "none", status: "open",
  completed_at: null, completed_by: null, next_task_id: null,
});
const T1 = "33333333-3333-4333-8333-333333333331";

beforeEach(() => {
  mocks.tables = {};
  mocks.bins = { ok: true, days: [], lastSynced: null };
  mocks.maint = { ok: true, data: [] };
  mocks.supplies = { ok: true, data: [] };
  mocks.session = S;
});

describe("getNeedsDoing", () => {
  it("leaves out snag reminders for someone who hid the snag list, and keeps everything else", async () => {
    mocks.tables.tasks = { data: [taskRow(T1, "2026-10-20")], error: null };
    mocks.tables.snags = { data: [{ ...stamp, id: "44444444-4444-4444-8444-444444444441", title: "Cracked tile", location: null, notes: null, status: "open", priority: "low", fixed_at: null, created_at: "2026-01-01T00:00:00Z" }], error: null };
    const shown = await getNeedsDoing({ ...S, showSnags: true } as HouseholdSession, "2026-10-21");
    expect(shown.items.some((i) => i.kind === "snags")).toBe(true);
    const hidden = await getNeedsDoing({ ...S, showSnags: false } as HouseholdSession, "2026-10-21");
    expect(hidden.items.some((i) => i.kind === "snags")).toBe(false);
    expect(hidden.items.map((i) => i.key)).toContain(`task:${T1}`);
  });
  it("returns items and partial=false when everything loads", async () => {
    mocks.tables.tasks = { data: [taskRow(T1, "2026-10-20")], error: null };
    mocks.bins = { ok: true, days: [{ date: "2026-10-22", bins: ["Blue"], putOutTonight: true }], lastSynced: null };
    const r = await getNeedsDoing(S, "2026-10-21");
    expect(r.partial).toBe(false);
    expect(r.items.map((i) => i.key)).toEqual([`task:${T1}`, "bins:2026-10-22"]);
  });
  it("one failing loader sets partial and the rest still show", async () => {
    mocks.tables.tasks = { data: [taskRow(T1, "2026-10-21")], error: null };
    mocks.tables.snags = "throw";
    const r = await getNeedsDoing(S, "2026-10-21");
    expect(r.partial).toBe(true);
    expect(r.items.map((i) => i.key)).toEqual([`task:${T1}`]);
  });
  it("a not-ok bins, maintenance or supplies result is partial", async () => {
    mocks.bins = { ok: false, error: "x" };
    expect((await getNeedsDoing(S, "2026-10-21")).partial).toBe(true);
    mocks.bins = { ok: true, days: [], lastSynced: null };
    mocks.supplies = { ok: false, error: "x" };
    expect((await getNeedsDoing(S, "2026-10-21")).partial).toBe(true);
  });
});

describe("getNeedsCount", () => {
  it("counts overdue and today, and is 0 when signed out", async () => {
    mocks.tables.tasks = { data: [taskRow(T1, "2026-10-20"), taskRow("33333333-3333-4333-8333-333333333332", "2026-10-25")], error: null };
    expect(await getNeedsCount("2026-10-21")).toBe(1);
    mocks.session = null;
    expect(await getNeedsCount("2026-10-21")).toBe(0);
  });
});

describe("worstLightFor", () => {
  it("re-exported and picks the most urgent", () => {
    expect(worstLightFor([{ light: "green" }, { light: "amber" }])).toBe("amber");
  });
});
