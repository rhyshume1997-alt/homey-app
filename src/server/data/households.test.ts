import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  query: { data: [] as unknown[], error: null as unknown },
  calls: [] as [string, unknown][],
}));

vi.mock("@/server/db/supabase", () => ({
  createUserClient: async () => ({
    rpc: (fn: string, args: unknown) => {
      m.calls.push([fn, args]);
      return m.rpc(fn, args);
    },
    from: () => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "is", "gt"]) q[k] = (...a: unknown[]) => (m.calls.push([`${k}`, a]), q);
      q.order = async () => m.query;
      return q;
    },
  }),
}));

import { acceptInvite, createHousehold, createInvite, leaveHousehold, listPendingInvites, removeMember, revokeInvite } from "./households";

const H = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const TOKEN = "Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMTI";

beforeEach(() => {
  m.rpc.mockReset();
  m.calls = [];
  m.query = { data: [], error: null };
});

describe("createHousehold", () => {
  it("validates names before calling the database", async () => {
    expect((await createHousehold({ name: " ", displayName: "x" })).ok).toBe(false);
    expect((await createHousehold({ name: "x", displayName: "y".repeat(51) })).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("maps the household limit to a friendly message without echoing the db text", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "household limit reached" } });
    const r = await createHousehold({ name: "Home", displayName: "Me" });
    expect(r).toEqual({ ok: false, error: "You've reached the limit of 3 households you can own." });
  });
  it("other denials get the generic permission message", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "secret detail" } });
    const r = await createHousehold({ name: "Home", displayName: "Me" });
    expect(r).toEqual({ ok: false, error: "You don't have permission to do that." });
  });
  it("returns the new household id", async () => {
    m.rpc.mockResolvedValue({ data: H, error: null });
    expect(await createHousehold({ name: " Home ", displayName: "Me" })).toEqual({ ok: true, data: { householdId: H } });
    expect(m.calls[0]).toEqual(["create_household", { p_name: "Home", p_display_name: "Me" }]);
  });
});

describe("createInvite", () => {
  it("rejects bad email and bad household without calling the RPC", async () => {
    expect((await createInvite({ household: H, email: "nope" })).ok).toBe(false);
    expect((await createInvite({ household: "x", email: "a@b.co" })).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("lower-cases the email and returns the token", async () => {
    m.rpc.mockResolvedValue({ data: TOKEN, error: null });
    expect(await createInvite({ household: H, email: " A@B.Co " })).toEqual({ ok: true, data: { token: TOKEN } });
    expect(m.calls[0]).toEqual(["create_invite", { p_household: H, p_email: "a@b.co" }]);
  });
  it("friendly error on denial and never echoes the db message", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "row-level security stuff" } });
    const r = await createInvite({ household: H, email: "a@b.co" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/row-level/);
  });
  it("rejects a malformed token coming back", async () => {
    m.rpc.mockResolvedValue({ data: "short", error: null });
    expect((await createInvite({ household: H, email: "a@b.co" })).ok).toBe(false);
  });
});

describe("acceptInvite token validation", () => {
  it.each(["", "short", `${TOKEN}x`, `${TOKEN.slice(0, 42)}!`, `${TOKEN.slice(0, 42)}=`, "../".repeat(15), " ".repeat(43)])(
    "rejects %j without calling the RPC",
    async (token) => {
      const r = await acceptInvite({ token, displayName: "Me" });
      expect(r.ok).toBe(false);
      expect(m.rpc).not.toHaveBeenCalled();
    },
  );
  it("passes a valid token and name, returns the household", async () => {
    m.rpc.mockResolvedValue({ data: H, error: null });
    expect(await acceptInvite({ token: TOKEN, displayName: " Me " })).toEqual({ ok: true, data: { householdId: H } });
    expect(m.calls[0]).toEqual(["accept_invite", { p_token: TOKEN, p_display_name: "Me" }]);
  });
  it("expired, revoked, reused and wrong-email all give the same message", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "invite expired" } });
    const a = await acceptInvite({ token: TOKEN, displayName: "Me" });
    m.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "wrong email" } });
    const b = await acceptInvite({ token: TOKEN, displayName: "Me" });
    expect(a).toEqual(b);
    expect(a.ok).toBe(false);
  });
  it("never puts the token in an error", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: TOKEN } });
    expect(JSON.stringify(await acceptInvite({ token: TOKEN, displayName: "Me" }))).not.toContain(TOKEN);
  });
});

describe("other RPC wrappers", () => {
  it("revoke, remove and leave validate uuids and map errors", async () => {
    expect((await revokeInvite("x")).ok).toBe(false);
    expect((await removeMember(H, "x")).ok).toBe(false);
    expect((await leaveHousehold("x")).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValue({ data: null, error: null });
    expect((await revokeInvite(U)).ok).toBe(true);
    expect((await removeMember(H, U)).ok).toBe(true);
    expect((await leaveHousehold(H)).ok).toBe(true);
    expect(m.calls.map((c) => c[0])).toEqual(["revoke_invite", "remove_member", "leave_household"]);
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await leaveHousehold(H)).ok).toBe(false);
  });
});

describe("listPendingInvites", () => {
  it("never selects token_hash and filters to pending", async () => {
    m.query = { data: [{ id: U, email: "a@b.co", expires_at: "2026-11-01T00:00:00Z", created_at: "2026-10-25T00:00:00Z" }, { bad: 1 }], error: null };
    const r = await listPendingInvites(H);
    expect(r).toHaveLength(1);
    const sel = m.calls.find((c) => c[0] === "select")?.[1] as string[];
    expect(sel[0]).not.toContain("token");
    expect(m.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["is", "gt"]));
  });
});
