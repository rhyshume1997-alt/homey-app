import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HouseholdSession } from "@/server/auth/session";

const H = "11111111-1111-4111-8111-111111111111";
const S = { userId: "u", householdId: H } as unknown as HouseholdSession;
const M1 = "55555555-5555-4555-8555-555555555551";
const SUP = "66666666-6666-4666-8666-666666666661";

type Pending = { id: string; kind: string; payload: Record<string, unknown>; status: "pending"; created_at: string };
const mocks = vi.hoisted(() => ({
  pending: [] as unknown[],
  stored: [] as { kind: string; payload: unknown }[],
  storeOk: true,
  entries: [] as unknown[],
  importItem: null as unknown,
}));

vi.mock("@/server/auth/session", () => ({ requireSession: async () => S }));
vi.mock("@/server/env", () => ({ getServerEnv: () => ({ AI_MONTHLY_CAP_GBP: 5 }) }));
vi.mock("@/server/data/dashboard", () => ({ todayInLondon: () => "2026-10-21" }));
vi.mock("@/server/ai/usage", () => ({ getMonthSpendPence: async () => 120 }));
vi.mock("@/server/homey/import-check", () => ({ importCheckItem: async () => mocks.importItem }));
vi.mock("@/server/homey/needs-doing", () => ({
  getNeedsEntries: async () => ({ entries: mocks.entries, partial: false }),
}));
vi.mock("@/server/ai/proposals", () => ({
  listPendingProposals: async () => mocks.pending,
  storeProposals: async (_s: unknown, items: { kind: string; payload: unknown }[]) => {
    if (!mocks.storeOk) return { count: 0, ids: [] };
    const ids: string[] = [];
    for (const i of items) {
      mocks.stored.push(i);
      const id = `a1a10000-0000-4000-8000-00000000000${mocks.pending.length + 1}`;
      ids.push(id);
      mocks.pending.push({ id, ...i, status: "pending", created_at: "x" });
    }
    return { count: items.length, ids };
  },
}));

import { loadHomeyPanelAction, proposeFromItemAction } from "@/app/(house)/homey-panel-actions";

const maintEntry = {
  item: { key: `maint:${M1}`, bucket: "overdue", kind: "maintenance", light: "red", text: "Bleed radiators", href: "/maintenance" },
  proposal: { kind: "create_task", payload: { title: "Do: Bleed radiators", due_date: "2026-10-21" } },
};
const supplyEntry = {
  item: { key: `supply:${SUP}`, bucket: "check", kind: "supplies", light: "amber", text: "Salt is out", href: "/shopping" },
  proposal: { kind: "add_shopping_item", payload: { title: "Salt" } },
};
const noProposal = { item: { key: "figures", bucket: "check", kind: "figures", light: "green", text: "x", href: "/money/check" }, proposal: null };

beforeEach(() => {
  mocks.pending = [];
  mocks.stored = [];
  mocks.storeOk = true;
  mocks.importItem = null;
  mocks.entries = [maintEntry, supplyEntry, noProposal];
});

describe("proposeFromItemAction", () => {
  it("stores a pending proposal built from server data and returns its id and text", async () => {
    const r = await proposeFromItemAction(`maint:${M1}`);
    expect(r).toEqual({ ok: true, proposalId: "a1a10000-0000-4000-8000-000000000001", text: "Add task: Do: Bleed radiators (due 2026-10-21)" });
    expect(mocks.stored).toEqual([{ kind: "create_task", payload: { title: "Do: Bleed radiators", due_date: "2026-10-21" } }]);
  });
  it("shopping items become add_shopping_item proposals", async () => {
    const r = await proposeFromItemAction(`supply:${SUP}`);
    expect(r).toMatchObject({ ok: true, text: "Add to shopping list: Salt" });
    expect(mocks.stored[0].kind).toBe("add_shopping_item");
  });
  it("rejects unknown, malformed, non-string and no-proposal keys without storing", async () => {
    for (const k of ["maint:does-not-exist", "../../etc", "", "x".repeat(200), 42, null, { key: `maint:${M1}` }, "figures"]) {
      expect((await proposeFromItemAction(k)).ok).toBe(false);
    }
    expect(mocks.stored).toEqual([]);
  });
  it("ignores extra fields sent by the browser: only the key is read", async () => {
    // The action signature takes the key only; extra arguments are never read.
    const call = proposeFromItemAction as (...a: unknown[]) => ReturnType<typeof proposeFromItemAction>;
    const r = await call(`maint:${M1}`, { title: "Pay 5000 to X", due_date: "1999-01-01", payload: { title: "evil" } });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(mocks.stored)).not.toMatch(/evil|5000|1999/);
    // an object carrying the extras instead of a string key is refused outright
    expect((await proposeFromItemAction({ key: `maint:${M1}`, title: "evil" })).ok).toBe(false);
  });
  it("does not queue a duplicate when the same proposal is already pending", async () => {
    const existing: Pending = {
      id: "a1a10000-0000-4000-8000-0000000000ff", kind: "create_task",
      payload: { title: "Do: Bleed radiators", due_date: "2026-10-21" }, status: "pending", created_at: "x",
    };
    mocks.pending = [existing];
    const r = await proposeFromItemAction(`maint:${M1}`);
    expect(r).toMatchObject({ ok: true, proposalId: existing.id });
    expect(mocks.stored).toEqual([]);
  });
  it("fails cleanly when the store reports success but no id came back", async () => {
    const proposals = await import("@/server/ai/proposals");
    const spy = vi.spyOn(proposals, "storeProposals").mockResolvedValueOnce({ count: 1, ids: [] });
    expect((await proposeFromItemAction(`maint:${M1}`)).ok).toBe(false);
    spy.mockRestore();
  });
  it("fails cleanly when the store fails", async () => {
    mocks.storeOk = false;
    expect((await proposeFromItemAction(`maint:${M1}`)).ok).toBe(false);
  });
});

describe("loadHomeyPanelAction", () => {
  it("returns items, partial, pending proposals and spend", async () => {
    mocks.pending = [{ id: "p1", kind: "note", payload: { text: "hi" }, status: "pending", created_at: "x" }];
    const r = await loadHomeyPanelAction();
    expect(r.items).toHaveLength(3);
    expect(r.partial).toBe(false);
    expect(r.proposals).toHaveLength(1);
    expect(r.spend).toEqual({ spentPence: 120, capGbp: 5 });
  });
  it("adds the email-import check item when there are unsaved emails", async () => {
    mocks.importItem = { key: "import:email", bucket: "check", kind: "figures", light: "green", text: "I found 1 appliance email.", href: "/import/appliances" };
    const r = await loadHomeyPanelAction();
    expect(r.items.map((i) => i.key)).toContain("import:email");
    expect(r.partial).toBe(false);
  });
});
