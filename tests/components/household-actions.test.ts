import { beforeEach, describe, expect, it, vi } from "vitest";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";

const m = vi.hoisted(() => ({
  session: null as unknown,
  set: vi.fn(),
  del: vi.fn(),
  revalidate: vi.fn(),
  createInvite: vi.fn(),
  removeMember: vi.fn(),
  leave: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: m.set, delete: m.del, get: () => ({ value: A }) }) }));
vi.mock("@/server/auth/session", () => ({ requireSession: async () => m.session }));
vi.mock("@/server/data/households", () => ({
  createInvite: m.createInvite,
  removeMember: m.removeMember,
  leaveHousehold: m.leave,
  revokeInvite: vi.fn(),
}));

import {
  inviteMemberAction,
  leaveHouseholdAction,
  removeMemberAction,
  switchHouseholdAction,
} from "../../src/app/(house)/household-actions";

const sess = (role: "owner" | "member") => ({
  userId: "u1",
  householdId: A,
  role,
  memberships: [
    { householdId: A, name: "A", role },
    { householdId: B, name: "B", role: "member" },
  ],
});
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.session = sess("owner");
});

describe("switchHouseholdAction", () => {
  it("rejects a household the caller is not a member of and sets no cookie", async () => {
    const r = await switchHouseholdAction(FOREIGN);
    expect(r.ok).toBe(false);
    expect(m.set).not.toHaveBeenCalled();
  });
  it("rejects malformed ids", async () => {
    expect((await switchHouseholdAction("nope")).ok).toBe(false);
    expect(m.set).not.toHaveBeenCalled();
  });
  it("sets an httpOnly, Lax, path=/ cookie and revalidates the layout", async () => {
    const r = await switchHouseholdAction(B);
    expect(r.ok).toBe(true);
    const [name, value, opts] = m.set.mock.calls[0];
    expect(name).toBe("oh_household");
    expect(value).toBe(B);
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(m.revalidate).toHaveBeenCalledWith("/", "layout");
  });
});

describe("owner-only actions", () => {
  it("invite: non-owner is refused before any RPC; owner uses the session household, not client input", async () => {
    m.session = sess("member");
    expect((await inviteMemberAction(null, fd({ email: "a@b.co" })))?.ok).toBe(false);
    expect(m.createInvite).not.toHaveBeenCalled();
    m.session = sess("owner");
    m.createInvite.mockResolvedValue({ ok: true, data: { token: "T" } });
    const r = await inviteMemberAction(null, fd({ email: "a@b.co", household: FOREIGN }));
    expect(r).toMatchObject({ ok: true, token: "T" });
    expect(m.createInvite).toHaveBeenCalledWith({ household: A, email: "a@b.co" });
  });
  it("remove: non-owner refused; owner removes within the session household", async () => {
    m.session = sess("member");
    expect((await removeMemberAction(null, fd({ user: "x" })))?.ok).toBe(false);
    expect(m.removeMember).not.toHaveBeenCalled();
    m.session = sess("owner");
    m.removeMember.mockResolvedValue({ ok: true, data: undefined });
    await removeMemberAction(null, fd({ user: B }));
    expect(m.removeMember).toHaveBeenCalledWith(A, B);
  });
  it("leave: surfaces the friendly error, clears the cookie on success", async () => {
    m.leave.mockResolvedValue({ ok: false, error: "nope" });
    expect(await leaveHouseholdAction(null, fd({}))).toEqual({ ok: false, message: "nope" });
    expect(m.del).not.toHaveBeenCalled();
    m.leave.mockResolvedValue({ ok: true, data: undefined });
    expect((await leaveHouseholdAction(null, fd({})))?.ok).toBe(true);
    expect(m.leave).toHaveBeenLastCalledWith(A);
    expect(m.del).toHaveBeenCalledWith("oh_household");
  });
});
