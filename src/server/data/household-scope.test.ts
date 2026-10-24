import { beforeEach, describe, expect, it, vi } from "vitest";

const H = "11111111-1111-4111-8111-111111111111";
type Call = { table: string; eqs: [string, unknown][] };
const rec = vi.hoisted(() => ({ calls: [] as { table: string; eqs: [string, unknown][] }[] }));

/** A chainable query double: records the table and every .eq(), resolves to an empty result. */
function query(table: string) {
  const call = { table, eqs: [] as [string, unknown][] };
  rec.calls.push(call);
  const result = { data: [], error: null, count: 0 };
  const proxy: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      if (prop === "eq") return (c: string, v: unknown) => (call.eqs.push([c, v]), proxy);
      if (prop === "maybeSingle" || prop === "single") return async () => ({ data: null, error: null });
      return () => proxy;
    },
  });
  return proxy;
}

vi.mock("@/server/db/supabase", () => ({
  createUserClient: async () => ({ from: (t: string) => query(t), rpc: async () => ({ data: null, error: null }) }),
}));
vi.mock("@/server/auth/session", () => ({
  getSession: async () => ({ userId: "u1", householdId: H, role: "owner", displayName: "A", memberships: [] }),
}));

import { listTasks, listMembers } from "./tasks";
import { listSnags } from "./snags";
import { listRecords } from "./records";
import { listNotifications, unreadCount } from "./notifications";
import { loadActivity } from "./activity";
import { loadMembers } from "./members";
import { listShopping, listSupplies } from "./shopping";
import { listRooms } from "./rooms";
import { listAppliances } from "./appliances";
import { listDocuments } from "./documents";
import { listMaintenance } from "./maintenance";
import { loadBins } from "./bins";
import { getEnergy } from "./energy";
import { listThreads } from "./replies";
import { loadCalendarItems } from "./calendar";

const filtered = (c: Call) => c.eqs.some(([k, v]) => k === "household_id" && v === H);
const active = (c: Call) => c.eqs.some(([k, v]) => k === "status" && v === "active");

beforeEach(() => {
  rec.calls.length = 0;
});

describe("every display loader filters by the session household (RLS alone spans all households)", () => {
  const loaders: [string, () => Promise<unknown>][] = [
    ["listTasks", () => listTasks()],
    ["listSnags", () => listSnags()],
    ["listRecords", () => listRecords()],
    ["listNotifications", () => listNotifications("u1")],
    ["unreadCount", () => unreadCount("u1")],
    ["loadActivity", () => loadActivity(5, null)],
    ["listShopping", () => listShopping()],
    ["listSupplies", () => listSupplies()],
    ["listRooms", () => listRooms()],
    ["listAppliances", () => listAppliances()],
    ["listDocuments", () => listDocuments()],
    ["listMaintenance", () => listMaintenance()],
    ["loadBins", () => loadBins()],
    ["getEnergy", () => getEnergy()],
    ["listThreads", () => listThreads()],
  ];
  it.each(loaders)("%s", async (_name, run) => {
    await run();
    expect(rec.calls.length).toBeGreaterThan(0);
    for (const c of rec.calls) expect(filtered(c), `${c.table} is not filtered by household_id`).toBe(true);
  });

  it("calendar sources", async () => {
    await loadCalendarItems({ from: "2026-10-01", to: "2026-10-31", today: "2026-10-24" });
    expect(rec.calls.length).toBeGreaterThan(0);
    for (const c of rec.calls) expect(filtered(c), `${c.table} is not filtered by household_id`).toBe(true);
  });
});

describe("member lists return only active members of the session household", () => {
  it("listMembers", async () => {
    await listMembers();
    expect(rec.calls).toHaveLength(1);
    expect(filtered(rec.calls[0]!) && active(rec.calls[0]!)).toBe(true);
  });
  it("loadMembers", async () => {
    await loadMembers(H);
    expect(filtered(rec.calls[0]!) && active(rec.calls[0]!)).toBe(true);
  });
  it("loadActivity name lookup", async () => {
    await loadActivity(5, null);
    const m = rec.calls.find((c) => c.table === "household_members")!;
    expect(filtered(m) && active(m)).toBe(true);
  });
});

describe("dbSnapshots", () => {
  it("load filters the snapshot and the fetcher name lookup by household", async () => {
    const { dbSnapshots } = await import("@/server/integrations/sheets/load");
    await dbSnapshots.load(H);
    expect(rec.calls.length).toBeGreaterThan(0);
    for (const c of rec.calls) expect(filtered(c), c.table).toBe(true);
  });
});
