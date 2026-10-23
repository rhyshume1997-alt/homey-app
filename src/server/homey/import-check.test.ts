import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/integrations/gmail-import/savers", () => ({ importSavers: () => ({}) }));
vi.mock("@/server/integrations/google/token", () => ({ getGoogleAccess: async () => null, invalidateAccessToken: () => {} }));

import { importCheckItem } from "./import-check";

const S = { userId: "u", householdId: "11111111-1111-4111-8111-111111111111" };

describe("importCheckItem", () => {
  it("gives a check item for unsaved appliance emails, counts only", async () => {
    const item = await importCheckItem(S, { find: async () => ({ status: "ok", appliances: 2, readings: 1 }) });
    expect(item).toMatchObject({
      key: "import:email", bucket: "check", light: "green",
      text: "I found 2 appliance emails and 1 meter reading email.", href: "/import/appliances",
    });
  });

  it("links to readings when only readings are waiting", async () => {
    const item = await importCheckItem(S, { find: async () => ({ status: "ok", appliances: 0, readings: 1 }) });
    expect(item?.href).toBe("/import/readings");
  });

  it("returns null when nothing is waiting, not connected, or on error", async () => {
    for (const c of [{ status: "ok", appliances: 0, readings: 0 }, { status: "not_connected" }, { status: "error" }] as const) {
      expect(await importCheckItem(S, { find: async () => c })).toBeNull();
    }
    expect(await importCheckItem(S, { find: async () => { throw new Error("boom"); } })).toBeNull();
  });

  it("never blocks: a slow Gmail check is dropped after the timeout and its requests aborted", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", (_u: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    });
    try {
      const started = Date.now();
      const item = await importCheckItem(S, {
        timeoutMs: 30,
        find: (_s, deps) => {
          void deps.fetch!("https://gmail.googleapis.com/x");
          return new Promise((resolve) => setTimeout(() => resolve({ status: "ok", appliances: 1, readings: 0 }), 5_000));
        },
      });
      expect(item).toBeNull();
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("with no Google connection it resolves null using the real finder", async () => {
    expect(await importCheckItem(S)).toBeNull();
  });
});
