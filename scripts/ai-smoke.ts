/**
 * MANUAL smoke test for Homey's digest against the real Anthropic API. Not run in CI.
 * It spends real money (well under 1p per run) and needs a key:
 *
 *   ANTHROPIC_API_KEY=sk-... node scripts/ai-smoke.ts
 *
 * Uses made-up items, an in-memory cache and no database. Prints the digest, then checks that a
 * second call with the same items is served from the cache without calling the API.
 * Without a key it is skipped.
 */

if (!process.env.VITEST) {
  // Run this same file under Vitest so the "@/..." aliases and the server-only stub apply.
  const { startVitest } = await import("vitest/node");
  const ctx = await startVitest("test", [], { run: true, watch: false, config: "vitest.config.ts", include: ["scripts/ai-smoke.ts"], testTimeout: 60_000 });
  await ctx?.close();
  process.exit(process.exitCode ?? 0);
} else {
  const { describe, expect, it } = await import("vitest");
  const { getOrCreateDigest } = await import("@/server/ai/digest");
  type Store = import("@/server/ai/digest").DigestStore;
  type Item = import("@/components/homey/types").NeedItem;
  type Session = import("@/server/auth/session").HouseholdSession;

  const key = process.env.ANTHROPIC_API_KEY;
  const today = new Date().toISOString().slice(0, 10);
  const items: Item[] = [
    { key: "task:smoke-1", bucket: "overdue", kind: "task", light: "red", text: "Bleed the radiators", date: today, href: "/tasks" },
    { key: "bins:smoke", bucket: "soon", kind: "bins", light: "amber", text: "Blue bin out", date: today, href: "/bins" },
    { key: "renewal:smoke", bucket: "soon", kind: "renewal", light: "amber", text: "Home insurance renewal", href: "/records" },
  ];
  const rows: { input_hash: string; body: unknown; created_at: string }[] = [];
  const store: Store = {
    listMine: async () => [...rows].reverse(),
    countHousehold: async () => rows.length,
    insert: async (r) => (rows.push({ input_hash: r.input_hash, body: r.body, created_at: new Date().toISOString() }), true),
  };
  let calls = 0;
  const deps = {
    store,
    ai: {
      fetch: ((...a: Parameters<typeof fetch>) => (calls++, fetch(...a))) as typeof fetch,
      apiKey: key,
      capGbp: 1,
      getSpentPence: async () => 0,
      recordUsage: async (u: unknown) => (console.log("usage", u), true),
    },
  };
  const session = { userId: "smoke", householdId: "smoke", role: "owner", displayName: "Smoke" } as unknown as Session;

  describe.skipIf(!key)("Homey digest (live)", () => {
    it("generates once, then serves from cache", async () => {
      const opts = { firstName: "Alex", otherFirstName: "Sam", trigger: "refresh" as const };
      const d = await getOrCreateDigest(session, items, today, opts, deps);
      console.log(JSON.stringify(d, null, 2));
      expect(d?.summary).toBeTruthy();
      expect(calls).toBe(1);
      const again = await getOrCreateDigest(session, items, today, opts, deps);
      expect(again?.summary).toBe(d?.summary);
      expect(calls).toBe(1);
    });
  });
}

export {};
