import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const calls: { select?: string; eq: [string, unknown][] } = { eq: [] };
let rows: unknown = [];
vi.mock("@/server/db/supabase", () => ({
  createUserClient: async () => ({
    from: () => {
      const b = {
        select: (cols: string) => ((calls.select = cols), b),
        eq: (k: string, v: unknown) => (calls.eq.push([k, v]), b),
        order: () => b,
        then: (r: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(r),
      };
      return b;
    },
  }),
}));

import { listWifiNames } from "./wifi";

const s = { householdId: "11111111-1111-4111-8111-111111111111", userId: "u" } as Parameters<typeof listWifiNames>[0];

beforeEach(() => {
  calls.select = undefined;
  calls.eq = [];
  rows = [];
});

describe("listWifiNames (Home card)", () => {
  it("never selects the ciphertext and filters to the session household", async () => {
    rows = [{ id: "00000000-0000-4000-8000-000000000001", ssid: "Home", security: "WPA", hidden: false, is_guest: false }];
    const r = await listWifiNames(s);
    expect(calls.select).not.toContain("password");
    expect(calls.eq).toContainEqual(["household_id", s.householdId]);
    expect(r).toEqual({ ok: true, data: rows });
  });

  it("reports a load error for unexpected rows", async () => {
    rows = [{ id: "not-a-uuid" }];
    expect((await listWifiNames(s)).ok).toBe(false);
  });
});
