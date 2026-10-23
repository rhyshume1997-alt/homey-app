import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HouseholdSession } from "@/server/auth/session";

const mocks = vi.hoisted(() => ({
  row: null as unknown,
  updated: [{ id: "x" }] as unknown[],
  shopping: { error: { message: "no table" } } as { error: unknown },
  inserted: [] as unknown[],
  insertError: null as unknown,
  statusUpdates: [] as unknown[],
  createTask: vi.fn(async () => ({ ok: true as const, data: undefined })),
  createSnag: vi.fn(async () => ({ ok: true as const, data: undefined })),
}));

vi.mock("@/server/data/tasks", () => ({ createTask: mocks.createTask }));
vi.mock("@/server/data/snags", () => ({ createSnag: mocks.createSnag }));
vi.mock("@/server/db/supabase", () => ({
  createUserClient: async () => ({
    from(table: string) {
      const b: Record<string, unknown> = {};
      let op = "select";
      for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
      b.update = (v: unknown) => { op = "update"; mocks.statusUpdates.push(v); return b; };
      b.insert = (v: unknown) => {
        mocks.inserted.push({ table, v });
        const rows = (Array.isArray(v) ? v : [v]).map((_, i) => ({ id: `b2b20000-0000-4000-8000-00000000000${i + 1}` }));
        return Object.assign(Promise.resolve({ error: mocks.insertError }), {
          select: async () => ({ data: mocks.insertError ? null : rows, error: mocks.insertError }),
        });
      };
      b.maybeSingle = async () => ({ data: mocks.row });
      b.then = (res: (v: unknown) => unknown) =>
        res(table === "shopping_items" ? mocks.shopping : op === "update" ? { data: mocks.updated, error: null } : { data: [], error: null });
      return b;
    },
  }),
}));

import { confirmProposal, rejectProposal, storeProposals, toolUseToProposal } from "./proposals";

const S = { userId: "u", householdId: "11111111-1111-4111-8111-111111111111" } as unknown as HouseholdSession;
const ID = "a1a10000-0000-4000-8000-000000000001";
const row = (kind: string, payload: unknown, status = "pending") => ({ id: ID, kind, payload, status, created_at: "2026-10-21T00:00:00Z" });

beforeEach(() => {
  mocks.row = null;
  mocks.updated = [{ id: ID }];
  mocks.shopping = { error: { message: "no table" } };
  mocks.inserted = [];
  mocks.insertError = null;
  mocks.statusUpdates = [];
  mocks.createTask.mockClear();
  mocks.createSnag.mockClear();
});

describe("storeProposals", () => {
  it("returns the count and the inserted ids", async () => {
    const r = await storeProposals(S, [
      { kind: "create_task", payload: { title: "A" } },
      { kind: "add_shopping_item", payload: { title: "B" } },
    ]);
    expect(r).toEqual({ count: 2, ids: ["b2b20000-0000-4000-8000-000000000001", "b2b20000-0000-4000-8000-000000000002"] });
    expect(mocks.inserted).toHaveLength(1);
  });
  it("returns nothing stored on an empty list or an insert error", async () => {
    expect(await storeProposals(S, [])).toEqual({ count: 0, ids: [] });
    mocks.insertError = { message: "denied" };
    expect(await storeProposals(S, [{ kind: "create_task", payload: { title: "A" } }])).toEqual({ count: 0, ids: [] });
  });
});

describe("toolUseToProposal", () => {
  it("maps the three tools to proposal kinds with validated payloads", () => {
    expect(toolUseToProposal({ id: "1", name: "propose_task", input: { title: " Bleed radiators ", due_date: "2026-11-01" } }))
      .toEqual({ kind: "create_task", payload: { title: "Bleed radiators", due_date: "2026-11-01" } });
    expect(toolUseToProposal({ id: "2", name: "propose_snag", input: { title: "Tile", priority: "high" } }))
      .toEqual({ kind: "create_snag", payload: { title: "Tile", priority: "high" } });
    expect(toolUseToProposal({ id: "3", name: "propose_shopping_item", input: { title: "Milk" } }))
      .toEqual({ kind: "add_shopping_item", payload: { title: "Milk" } });
  });

  it("rejects unknown tools, bad input and extra fields", () => {
    expect(toolUseToProposal({ id: "1", name: "delete_everything", input: {} })).toBeNull();
    expect(toolUseToProposal({ id: "1", name: "constructor", input: {} })).toBeNull();
    expect(toolUseToProposal({ id: "1", name: "propose_task", input: { title: "" } })).toBeNull();
    expect(toolUseToProposal({ id: "1", name: "propose_task", input: { title: "x", due_date: "tomorrow" } })).toBeNull();
    expect(toolUseToProposal({ id: "1", name: "propose_task", input: { title: "x", household_id: "other" } })).toBeNull();
    expect(toolUseToProposal({ id: "1", name: "propose_snag", input: { title: "x", priority: "urgent" } })).toBeNull();
  });
});

describe("confirmProposal", () => {
  it("creates a task through createTask after validating", async () => {
    mocks.row = row("create_task", { title: "Bleed radiators", due_date: "2026-11-01" });
    const r = await confirmProposal(S, ID);
    expect(r.ok).toBe(true);
    expect(mocks.createTask).toHaveBeenCalledWith(S, expect.objectContaining({ title: "Bleed radiators", due_date: "2026-11-01", recurrence: "none" }));
    expect(mocks.statusUpdates).toContainEqual({ status: "confirmed" });
  });

  it("creates a snag with default priority", async () => {
    mocks.row = row("create_snag", { title: "Tile", location: "Kitchen" });
    expect((await confirmProposal(S, ID)).ok).toBe(true);
    expect(mocks.createSnag).toHaveBeenCalledWith(S, expect.objectContaining({ title: "Tile", priority: "medium", status: "open" }));
  });

  it("does not execute or claim an invalid stored payload", async () => {
    mocks.row = row("create_task", { title: "", sneaky: true });
    const r = await confirmProposal(S, ID);
    expect(r.ok).toBe(false);
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.statusUpdates).toEqual([]);
  });

  it("does nothing for an already decided proposal", async () => {
    mocks.row = row("create_task", { title: "x" }, "confirmed");
    expect((await confirmProposal(S, ID)).ok).toBe(false);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("does not execute twice if the claim loses a race", async () => {
    mocks.row = row("create_task", { title: "x" });
    mocks.updated = [];
    expect((await confirmProposal(S, ID)).ok).toBe(false);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("rejects shopping proposals when no shopping table exists", async () => {
    mocks.row = row("add_shopping_item", { title: "Milk" });
    const r = await confirmProposal(S, ID);
    expect(r).toMatchObject({ ok: false });
    expect(mocks.statusUpdates).toEqual([{ status: "rejected" }]);
    expect(mocks.inserted).toEqual([]);
  });

  it("rejects a malformed id without touching the database", async () => {
    expect((await confirmProposal(S, "nope")).ok).toBe(false);
    expect((await rejectProposal(S, "nope")).ok).toBe(false);
  });
});

describe("rejectProposal", () => {
  it("marks pending as rejected and never executes", async () => {
    expect((await rejectProposal(S, ID)).ok).toBe(true);
    expect(mocks.statusUpdates).toEqual([{ status: "rejected" }]);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});
