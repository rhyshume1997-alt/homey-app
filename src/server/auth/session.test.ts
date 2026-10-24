import { beforeEach, describe, expect, it, vi } from "vitest";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const m = vi.hoisted(() => ({
  user: { id: "u1", user_metadata: {} } as { id: string; user_metadata: object } | null,
  rows: [] as unknown[],
  cookie: undefined as string | undefined,
  filters: [] as [string, unknown][],
  redirected: null as string | null,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "oh_household" && m.cookie ? { value: m.cookie } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    m.redirected = to;
    throw new Error("REDIRECT");
  },
}));
vi.mock("@/server/db/supabase", () => ({
  createUserClient: async () => ({
    auth: { getUser: async () => ({ data: { user: m.user }, error: m.user ? null : new Error("x") }) },
    from: () => {
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (m.filters.push([c, v]), q),
        order: async () => ({ data: m.rows, error: null }),
      };
      return q;
    },
  }),
}));

import { getSession, requireSession } from "./session";

const row = (id: string, name: string, role = "member") => ({
  household_id: id,
  role,
  display_name: "Me",
  households: { name },
});

beforeEach(() => {
  m.user = { id: "u1", user_metadata: {} };
  m.rows = [row(A, "First", "owner"), row(B, "Second")];
  m.cookie = undefined;
  m.filters = [];
  m.redirected = null;
});

describe("getSession household selection", () => {
  it("only asks for active memberships of the caller", async () => {
    await getSession();
    expect(m.filters).toContainEqual(["status", "active"]);
    expect(m.filters).toContainEqual(["user_id", "u1"]);
  });

  it("defaults to the oldest active membership", async () => {
    const s = await getSession();
    expect(s?.householdId).toBe(A);
    expect(s?.role).toBe("owner");
    expect(s?.memberships).toEqual([
      { householdId: A, name: "First", role: "owner" },
      { householdId: B, name: "Second", role: "member" },
    ]);
  });

  it("honours a cookie for a household the caller is active in", async () => {
    m.cookie = B;
    const s = await getSession();
    expect(s?.householdId).toBe(B);
    expect(s?.role).toBe("member");
  });

  it("ignores a cookie for a household the caller is not in (or was removed from: RLS/status filter drops the row)", async () => {
    m.cookie = C;
    expect((await getSession())?.householdId).toBe(A);
  });

  it("ignores a malformed cookie", async () => {
    m.cookie = "not-a-uuid' or 1=1";
    expect((await getSession())?.householdId).toBe(A);
  });

  it("returns null with no active membership", async () => {
    m.rows = [];
    expect(await getSession()).toBeNull();
  });

  it("returns null when signed out", async () => {
    m.user = null;
    expect(await getSession()).toBeNull();
  });
});

describe("requireSession", () => {
  it("sends a signed-in person with no membership to /onboarding", async () => {
    m.rows = [];
    await expect(requireSession()).rejects.toThrow("REDIRECT");
    expect(m.redirected).toBe("/onboarding");
  });

  it("sends a signed-out visitor to /login", async () => {
    m.user = null;
    await expect(requireSession()).rejects.toThrow("REDIRECT");
    expect(m.redirected).toBe("/login");
  });
});
