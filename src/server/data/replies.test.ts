import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sync: vi.fn(), auto: vi.fn(), rpc: vi.fn() }));
vi.mock("@/server/integrations/google/gmail", () => ({ syncMyGmail: m.sync, maybeAutoSync: m.auto }));
vi.mock("@/server/db/supabase", () => ({ createUserClient: async () => ({ rpc: m.rpc }) }));
vi.mock("@/server/db/scoped", () => ({ scopedDb: async () => null }));

import { autoSyncIfDue, syncNow } from "./replies";

const s = { userId: "u", householdId: "hB", role: "member", displayName: "Me", memberships: [] } as never;

beforeEach(() => {
  m.sync.mockReset();
  m.auto.mockReset();
  m.rpc.mockReset();
});

describe("Gmail sync with a switched household", () => {
  it("manual sync passes the session household and shows no error when Google lives in another household", async () => {
    m.sync.mockResolvedValue({ status: "other_household" });
    expect(await syncNow(s)).toEqual({ ok: true, data: 0 });
    expect(m.sync).toHaveBeenCalledWith("Me", "hB");
  });
  it("auto sync passes the session household and does not throw on a skip", async () => {
    m.rpc.mockResolvedValue({ data: [{ connected: true, scopes: "https://www.googleapis.com/auth/gmail.readonly" }], error: null });
    m.auto.mockResolvedValue({ status: "other_household" });
    await expect(autoSyncIfDue(s)).resolves.toBeUndefined();
    expect(m.auto).toHaveBeenCalledWith("Me", "hB");
  });
});
