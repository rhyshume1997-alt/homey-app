import { beforeEach, describe, expect, it, vi } from "vitest";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";

const m = vi.hoisted(() => ({
  row: null as { storage_path: string } | null,
  eqs: [] as [string, unknown][],
  signed: vi.fn(async (_p: string, _s: number) => ({ data: { signedUrl: "https://x/signed" }, error: null })),
}));

vi.mock("@/server/db/supabase", () => ({
  createUserClient: async () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (c: string, v: unknown) => (m.eqs.push([c, v]), q);
      q.maybeSingle = async () => ({ data: m.row });
      return q;
    },
    storage: { from: () => ({ createSignedUrl: m.signed }) },
  }),
}));

import { createDocumentUrl } from "./documents";

const session = (householdId: string) => ({ userId: "u", householdId, role: "member", displayName: "x", memberships: [] }) as never;

beforeEach(() => {
  m.eqs = [];
  m.signed.mockClear();
  m.row = { storage_path: `${A}/file.pdf` };
});

describe("createDocumentUrl checks the session household", () => {
  it("filters the row lookup by the session household and signs for 60 seconds", async () => {
    expect(await createDocumentUrl(session(A), ID)).toBe("https://x/signed");
    expect(m.eqs).toContainEqual(["household_id", A]);
    expect(m.signed).toHaveBeenCalledWith(`${A}/file.pdf`, 60);
  });
  it("never signs a path outside the session household, even if the row came back", async () => {
    expect(await createDocumentUrl(session(B), ID)).toBeNull();
    expect(m.signed).not.toHaveBeenCalled();
  });
  it("never signs when the row is not visible", async () => {
    m.row = null;
    expect(await createDocumentUrl(session(A), ID)).toBeNull();
    expect(m.signed).not.toHaveBeenCalled();
  });
});
