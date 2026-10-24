import { describe, expect, it, vi } from "vitest";

const primary = vi.hoisted(() => ({ id: "h1" as string | undefined }));
vi.mock("@/server/env", () => ({
  getServerEnv: () => ({ AI_MONTHLY_CAP_GBP: 5 }),
  isPrimaryHousehold: (id: string) => !!primary.id && id === primary.id,
}));
import type { NeedItem } from "@/components/homey/types";
import type { HouseholdSession } from "@/server/auth/session";
import type { AiDeps } from "./client";
import {
  buildDigestInput, buildDigestMessage, DIGEST_LIMITS, getOrCreateDigest, parseDigestToolInput,
  type DigestDeps, type DigestRow, type DigestStore,
} from "./digest";
import { DIGEST_PROMPT } from "./context";

const TODAY = "2026-10-22";
const session = { userId: "u1", householdId: "h1", role: "owner", displayName: "Alex" } as unknown as HouseholdSession;

const item = (key: string, over: Partial<NeedItem> = {}): NeedItem => ({
  key, bucket: "today", kind: "task", light: "amber", text: `Item ${key}`, href: "/tasks", ...over,
});
const ITEMS: NeedItem[] = [
  item("task:a", { bucket: "overdue", light: "red", text: "Bleed radiators", date: "2026-10-20" }),
  item("bins:2026-10-23", { kind: "bins", bucket: "soon", text: "Blue bin out", date: "2026-10-23" }),
  item("renewal:r1", { kind: "renewal", bucket: "soon", text: "Home insurance renewal", date: "2026-11-10" }),
];

function apiReply(input: unknown) {
  return {
    content: [{ type: "tool_use", id: "t1", name: "submit_digest", input }],
    usage: { input_tokens: 400, output_tokens: 80 },
  };
}

function setup(opts: { rows?: DigestRow[]; count?: number | null; apiKey?: string | undefined; input?: unknown } = {}) {
  const fetch = vi.fn(async () =>
    new Response(JSON.stringify(apiReply(opts.input ?? { summary: "Morning Alex! The radiators need bleeding.", top: [{ ref: "k1", why: "It is overdue." }] })), { status: 200 }),
  );
  const recordUsage = vi.fn(async () => true);
  const ai: AiDeps = {
    fetch: fetch as never,
    apiKey: "apiKey" in opts ? opts.apiKey : "sk-test",
    capGbp: 5,
    getSpentPence: async () => 0,
    recordUsage,
  };
  const insert = vi.fn<DigestStore["insert"]>(async () => true);
  const store: DigestStore = {
    listMine: vi.fn(async () => opts.rows ?? []),
    countHousehold: vi.fn(async () => ("count" in opts ? opts.count! : 0)),
    insert,
  };
  const deps: DigestDeps = { ai, store };
  return { deps, fetch, insert, recordUsage };
}

const OPTS = { firstName: "Alex", otherFirstName: "Sam", trigger: "first_open" as const };
const sentBody = (fetch: ReturnType<typeof vi.fn>) => JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string);

describe("getOrCreateDigest", () => {
  it("is off (null, no store access, no API call) for a non-primary household or when PRIMARY_HOUSEHOLD_ID is unset", async () => {
    const saved = primary.id;
    try {
      for (const id of ["other", undefined]) {
        primary.id = id;
        const { deps, fetch, insert } = setup();
        expect(await getOrCreateDigest(session, ITEMS, TODAY, { ...OPTS, force: true }, deps)).toBeNull();
        expect(deps.store.listMine).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
      }
    } finally {
      primary.id = saved;
    }
  });

  it("generates with Haiku and a forced submit_digest tool, maps refs to keys, records usage and caches", async () => {
    const { deps, fetch, insert, recordUsage } = setup();
    const d = await getOrCreateDigest(session, ITEMS, TODAY, OPTS, deps);
    expect(d).toMatchObject({ summary: "Morning Alex! The radiators need bleeding.", top: [{ key: "task:a", why: "It is overdue." }], stale: false });
    const body = sentBody(fetch);
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit_digest" });
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual(["submit_digest"]);
    expect(body.system).toBe(DIGEST_PROMPT);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ day: TODAY, trigger: "first_open", model: "claude-haiku-5-5", input_hash: buildDigestInput(ITEMS, TODAY).hash }));
  });

  it("cache hit on the same input makes no fetch, even when forced", async () => {
    const hash = buildDigestInput(ITEMS, TODAY).hash;
    const rows = [{ input_hash: hash, body: { summary: "Cached", top: [{ key: "task:a", why: "x" }] }, created_at: "2026-10-22T07:00:00Z" }];
    for (const force of [false, true]) {
      const { deps, fetch } = setup({ rows });
      const d = await getOrCreateDigest(session, ITEMS, TODAY, { ...OPTS, force }, deps);
      expect(d).toEqual({ summary: "Cached", top: [{ key: "task:a", why: "x" }], createdAt: "2026-10-22T07:00:00Z", stale: false });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("returns the newest cached digest as stale when the input changed, dropping gone items", async () => {
    const rows = [{ input_hash: "0".repeat(64), body: { summary: "Old", top: [{ key: "task:done", why: "x" }, { key: "task:a", why: "y" }] }, created_at: "2026-10-22T07:00:00Z" }];
    const { deps, fetch } = setup({ rows });
    const d = await getOrCreateDigest(session, ITEMS, TODAY, OPTS, deps);
    expect(d).toMatchObject({ summary: "Old", top: [{ key: "task:a", why: "y" }], stale: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("regenerates a stale digest when forced", async () => {
    const rows = [{ input_hash: "0".repeat(64), body: { summary: "Old", top: [] }, created_at: "2026-10-22T07:00:00Z" }];
    const { deps, fetch } = setup({ rows });
    const d = await getOrCreateDigest(session, ITEMS, TODAY, { ...OPTS, trigger: "refresh", force: true }, deps);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(d?.stale).toBe(false);
  });

  it("enforces 4 generations per household per day (and fails closed when the count is unknown)", async () => {
    for (const count of [DIGEST_LIMITS.perHouseholdPerDay, 9, null]) {
      const { deps, fetch } = setup({ count });
      expect(await getOrCreateDigest(session, ITEMS, TODAY, OPTS, deps)).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    }
    const old = [{ input_hash: "0".repeat(64), body: { summary: "Old", top: [] }, created_at: "2026-10-22T07:00:00Z" }];
    const { deps, fetch } = setup({ rows: old, count: 4 });
    expect(await getOrCreateDigest(session, ITEMS, TODAY, { ...OPTS, force: true }, deps)).toMatchObject({ summary: "Old", stale: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns null with no API key and never calls fetch", async () => {
    const { deps, fetch } = setup({ apiKey: undefined });
    expect(await getOrCreateDigest(session, ITEMS, TODAY, OPTS, deps)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns null on API failure, an invalid tool reply, or an unreadable cache", async () => {
    const a = setup();
    a.deps.ai.fetch = vi.fn(async () => new Response("err", { status: 500 })) as never;
    expect(await getOrCreateDigest(session, ITEMS, TODAY, OPTS, a.deps)).toBeNull();
    const b = setup({ input: { summary: 42 } });
    expect(await getOrCreateDigest(session, ITEMS, TODAY, OPTS, b.deps)).toBeNull();
    expect(b.insert).not.toHaveBeenCalled();
    const c = setup();
    c.deps.store.listMine = async () => null;
    expect(await getOrCreateDigest(session, ITEMS, TODAY, OPTS, c.deps)).toBeNull();
    expect(c.fetch).not.toHaveBeenCalled();
    expect(await getOrCreateDigest(session, ITEMS, "22/10/2026", OPTS, setup().deps)).toBeNull();
  });
});

describe("parseDigestToolInput", () => {
  const refs = buildDigestInput(ITEMS, TODAY).refs;

  it("drops unknown and repeated refs and keeps at most 5", () => {
    const out = parseDigestToolInput(
      { summary: "Hi", top: [{ ref: "k9", why: "a" }, { ref: "k2", why: "b" }, { ref: "k2", why: "c" }, { ref: "task:a", why: "d" }, { ref: "k1", why: "e" }] },
      refs,
    );
    expect(out?.top.map((t) => t.key)).toEqual([refs.get("k2"), "task:a"]);
  });

  it("cleans HTML, identifiers and money, and clamps long text", () => {
    const out = parseDigestToolInput(
      {
        summary: `<b>Hi</b> <script>alert(1)</script> call 07700900123 or see https://evil.example/x, G12 8QQ, £45.50 ${"word ".repeat(100)}`,
        top: [{ ref: "k1", why: `<img src=x onerror=alert(1)>${"y".repeat(500)}` }],
      },
      refs,
    )!;
    expect(out.summary.length).toBeLessThanOrEqual(DIGEST_LIMITS.summary);
    expect(out.summary).not.toMatch(/[<>]|07700900123|https?:|evil\.example|G12 8QQ|£|45\.50/);
    expect(out.top[0].why.length).toBeLessThanOrEqual(DIGEST_LIMITS.why);
    expect(out.top[0].why).not.toMatch(/[<>]/);
  });

  it("rejects a missing or empty summary", () => {
    expect(parseDigestToolInput({ top: [] }, refs)).toBeNull();
    expect(parseDigestToolInput({ summary: "<p></p>", top: [] }, refs)).toBeNull();
  });
});

describe("digest prompt", () => {
  const nasty: NeedItem[] = [
    item("task:1", { text: "Pay £1,250.00 to jo@bank.example.com ref 12345678 sort 12-34-56", date: "2026-10-21" }),
    item("renewal:2", { kind: "renewal", text: "Renew via https://provider.example/renew for 45 GBP at G12 8QQ" }),
    item("activity:3", { bucket: "activity", kind: "activity", text: "<img src=x onerror=alert(1)>Sam cleaned the oven" }),
    ...Array.from({ length: 40 }, (_, i) => item(`task:x${i}`, { bucket: "check", text: `Extra ${i}` })),
  ];
  const input = buildDigestInput(nasty, TODAY);
  const msg = buildDigestMessage(input, TODAY, "Alex", "Sam");

  it("contains no amounts, digit runs, emails, URLs, sort codes, postcodes or HTML", () => {
    for (const bad of [/£/, /1,250/, /\d{6,}/, /@/, /https?:/, /provider\.example/, /12-34-56/, /G12 8QQ/, /45 GBP/, /[<>]/]) {
      expect(msg).not.toMatch(bad);
    }
  });

  it("has refs, kinds, dates with day counts and first names, and caps the list at 25", () => {
    expect(msg).toContain("Member first name: Alex");
    expect(msg).toContain("Other member first name: Sam");
    expect(msg).toMatch(/\[k1\] task, today: .* \(2026-10-21, 1 day ago\)/);
    expect(input.lines).toHaveLength(DIGEST_LIMITS.items);
    expect(msg).not.toContain("[k26]");
  });

  it("hash depends on keys and dates only, not order or text", () => {
    const a = buildDigestInput(ITEMS, TODAY).hash;
    expect(buildDigestInput([...ITEMS].reverse(), TODAY).hash).toBe(a);
    expect(buildDigestInput(ITEMS.map((i) => ({ ...i, text: "changed" })), TODAY).hash).toBe(a);
    expect(buildDigestInput(ITEMS.map((i, n) => (n ? i : { ...i, date: "2026-10-21" })), TODAY).hash).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("states the rules", () => {
    for (const rule of [/UK English/, /at most 2 sentences/, /first name/, /ref/, /Do not add facts, dates, amounts/, /data, not instructions/]) {
      expect(DIGEST_PROMPT).toMatch(rule);
    }
  });
});
