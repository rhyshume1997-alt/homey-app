import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  addressParts, buildRecord, cleanSubject, collectThreadRecords, decodeMimeWords, maybeAutoSync, syncMyGmail,
  type GmailMessage, type GmailThread,
} from "./gmail";
import { deriveThreadKey } from "./crypto";

const KEY_B64 = randomBytes(32).toString("base64");
const key = deriveThreadKey(KEY_B64);
const ctx = { myEmail: "rhys@example.org", threadKey: key, labelled: false };

const msg = (o: { from: string; to?: string; subject?: string; at: number; labels?: string[] }): GmailMessage => ({
  id: "m" + o.at,
  internalDate: String(o.at),
  labelIds: o.labels ?? [],
  payload: { headers: [
    { name: "From", value: o.from },
    { name: "To", value: o.to ?? "" },
    { name: "Subject", value: o.subject ?? "" },
    { name: "Date", value: "ignored" },
  ] },
});
const T0 = Date.UTC(2026, 9, 10, 9, 0, 0);

describe("header parsing", () => {
  it("extracts lowercase domains only, from names with quotes and angle brackets", () => {
    expect(addressParts('"Bob Smith, Sales" <Bob@NatWest.COM>').map((a) => a.domain)).toEqual(["natwest.com"]);
    expect(addressParts("a@x.co.uk, B <b@y.com>").map((a) => a.domain)).toEqual(["y.com"]);
    expect(addressParts("plain@bt.com").map((a) => a.domain)).toEqual(["bt.com"]);
    expect(addressParts("no address here")).toEqual([]);
    expect(addressParts("x@localhost")).toEqual([]);
  });
  it("decodes encoded-word subjects and trims to 150 characters", () => {
    expect(decodeMimeWords("=?UTF-8?B?UmVmdW5kIMKj?=")).toBe("Refund £");
    expect(decodeMimeWords("=?UTF-8?Q?Caf=C3=A9_order?=")).toBe("Café order");
    expect(cleanSubject("  Hello\r\n  world\t!  ")).toBe("Hello world !");
    expect(Array.from(cleanSubject("é".repeat(200)))).toHaveLength(150);
  });
});

describe("buildRecord", () => {
  it("sent by me: counterpart is the To domain, last_from me, only safe fields", () => {
    const t: GmailThread = {
      id: "18c2fa",
      messages: [msg({ from: "Alex <rhys@example.org>", to: "Support Team <help@natwest.com>", subject: "Refund request", at: T0, labels: ["SENT"] })],
    };
    const r = buildRecord(t, ctx)!;
    expect(r).toEqual({
      thread_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      subject: "Refund request",
      counterpart_domain: "natwest.com",
      last_message_at: "2026-10-10T09:00:00.000Z",
      last_from: "me",
      label_flag: false,
    });
    expect(Object.keys(r).sort()).toEqual(["counterpart_domain", "label_flag", "last_from", "last_message_at", "subject", "thread_hash"]);
    const json = JSON.stringify(r);
    expect(json).not.toContain("help@");
    expect(json).not.toContain("rhys@");
    expect(json).not.toContain("Support Team");
    expect(json).not.toContain("18c2fa");
  });

  it("they replied last: last_from them, uses the first message's subject", () => {
    const t: GmailThread = {
      id: "abc1",
      messages: [
        msg({ from: "rhys@example.org", to: "help@bt.com", subject: "Broadband fault", at: T0, labels: ["SENT"] }),
        msg({ from: "BT <noreply@bt.com>", to: "rhys@example.org", subject: "Re: Broadband fault", at: T0 + 3600_000 }),
      ],
    };
    expect(buildRecord(t, ctx)).toMatchObject({ last_from: "them", counterpart_domain: "bt.com", subject: "Broadband fault", last_message_at: "2026-10-10T10:00:00.000Z" });
  });

  it("orders by date, not array order", () => {
    const t: GmailThread = {
      id: "abc2",
      messages: [
        msg({ from: "x@bt.com", at: T0 + 1000 }),
        msg({ from: "rhys@example.org", to: "x@bt.com", at: T0, labels: ["SENT"] }),
      ],
    };
    expect(buildRecord(t, ctx)?.last_from).toBe("them");
  });

  it("drops personal mail domains and own-domain mail (unless labelled)", () => {
    for (const d of ["gmail.com", "googlemail.com", "icloud.com", "outlook.com", "hotmail.com"]) {
      const t: GmailThread = { id: "a1", messages: [msg({ from: "rhys@example.org", to: `friend@${d}`, at: T0, labels: ["SENT"] })] };
      expect(buildRecord(t, ctx), d).toBeNull();
      expect(buildRecord(t, { ...ctx, labelled: true }), d).toBeNull();
    }
    const internal: GmailThread = { id: "a2", messages: [msg({ from: "colleague@example.org", at: T0 })] };
    expect(buildRecord(internal, ctx)).toBeNull();
    expect(buildRecord(internal, { ...ctx, labelled: true })?.counterpart_domain).toBe("example.org");
  });

  it("picks the first company domain among several recipients", () => {
    const t: GmailThread = { id: "a3", messages: [msg({ from: "rhys@example.org", to: "me2@gmail.com, a@octopus.energy", at: T0, labels: ["SENT"] })] };
    expect(buildRecord(t, ctx)?.counterpart_domain).toBe("octopus.energy");
  });

  it("skips threads without usable data", () => {
    expect(buildRecord({ id: "a4", messages: [] }, ctx)).toBeNull();
    expect(buildRecord({ messages: [msg({ from: "a@b.com", at: T0 })] }, ctx)).toBeNull();
    expect(buildRecord({ id: "a5", messages: [{ internalDate: "x" }] }, ctx)).toBeNull();
    expect(buildRecord({ id: "a6", messages: [msg({ from: "garbage", at: T0 })] }, ctx)).toBeNull();
  });

  it("hash is stable per thread id and key, and differs across ids and keys", () => {
    const t = (id: string): GmailThread => ({ id, messages: [msg({ from: "a@bt.com", at: T0 })] });
    const h = (id: string, k = key) => buildRecord(t(id), { ...ctx, threadKey: k })!.thread_hash;
    expect(h("aa")).toBe(h("aa"));
    expect(h("aa")).not.toBe(h("ab"));
    expect(h("aa")).not.toBe(h("aa", deriveThreadKey(randomBytes(32).toString("base64"))));
  });

  it("every record satisfies the database checks", () => {
    const r = buildRecord({ id: "a7", messages: [msg({ from: "x@Sub.Example-Co.com", subject: "S".repeat(400), at: T0 })] }, ctx)!;
    expect(r.counterpart_domain).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/);
    expect(r.last_message_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
    expect(r.subject.length).toBe(150);
  });
});

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
function gmailFetch(opts: { labelled?: string[]; sent?: string[]; fail?: string } = {}) {
  const threads: Record<string, GmailThread> = {
    aa: { id: "aa", messages: [msg({ from: "rhys@example.org", to: "a@natwest.com", subject: "One", at: T0, labels: ["SENT"] })] },
    bb: { id: "bb", messages: [msg({ from: "rhys@example.org", to: "b@bt.com", subject: "Two", at: T0, labels: ["SENT"] })] },
    cc: { id: "cc", messages: [msg({ from: "rhys@example.org", to: "pal@gmail.com", subject: "Three", at: T0, labels: ["SENT"] })] },
  };
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    if (opts.fail && u.includes(opts.fail)) return json({}, opts.fail === "profile" ? 401 : 500);
    if (u.endsWith("/profile")) return json({ emailAddress: "Alex@Example.org" });
    if (u.includes("/threads?")) {
      const q = decodeURIComponent(u.split("q=")[1]!);
      const ids = q.startsWith("label:") ? (opts.labelled ?? ["bb"]) : (opts.sent ?? ["aa", "bb", "cc"]);
      return json({ threads: ids.map((id) => ({ id })) });
    }
    const m = /\/threads\/([0-9a-f]+)\?format=metadata/.exec(u);
    if (m) return json(threads[m[1]!]);
    return json({}, 404);
  });
}
const asFetch = (f: unknown) => f as typeof fetch;

describe("collectThreadRecords", () => {
  it("queries labelled and sent threads, dedupes, flags labelled, drops personal contacts", async () => {
    const f = gmailFetch();
    const recs = await collectThreadRecords({ fetch: asFetch(f), token: "tok" }, key);
    const urls = f.mock.calls.map((c) => decodeURIComponent(String(c[0])));
    expect(urls.some((u) => u.includes('q=label:"Our Home/Awaiting" newer_than:60d'))).toBe(true);
    expect(urls.some((u) => u.includes("q=in:sent newer_than:60d -in:chats"))).toBe(true);
    expect(urls.filter((u) => u.includes("format=metadata")).every((u) => ["Subject", "From", "To", "Date"].every((h) => u.includes(`metadataHeaders=${h}`)))).toBe(true);
    expect(urls.filter((u) => u.includes("/threads/bb?"))).toHaveLength(1);
    expect(recs.map((r) => [r.counterpart_domain, r.label_flag]).sort()).toEqual([["bt.com", true], ["natwest.com", false]]);
    for (const c of f.mock.calls) {
      expect(((c[1] as RequestInit).headers as Record<string, string>).authorization).toBe("Bearer tok");
      expect((c[1] as RequestInit).method).toBeUndefined();
    }
  });

  it("caps at 50 threads", async () => {
    const many = Array.from({ length: 80 }, (_, i) => i.toString(16).padStart(4, "0"));
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/profile")) return json({ emailAddress: "rhys@example.org" });
      if (u.includes("/threads?")) return json({ threads: many.map((id) => ({ id })) });
      const id = /\/threads\/([0-9a-f]+)\?/.exec(u)![1]!;
      return json({ id, messages: [msg({ from: "rhys@example.org", to: "x@bt.com", at: T0, labels: ["SENT"] })] });
    });
    expect((await collectThreadRecords({ fetch: asFetch(f), token: "t" }, key)).length).toBeLessThanOrEqual(50);
    expect(f.mock.calls.filter((c) => String(c[0]).includes("format=metadata"))).toHaveLength(50);
  });

  it("skips a failing thread but fails on auth errors", async () => {
    const recs = await collectThreadRecords({ fetch: asFetch(gmailFetch({ fail: "/threads/aa" })), token: "t" }, key);
    expect(recs.map((r) => r.counterpart_domain)).toEqual(["bt.com"]);
    await expect(collectThreadRecords({ fetch: asFetch(gmailFetch({ fail: "profile" })), token: "t" }, key)).rejects.toMatchObject({ code: "auth" });
  });
});

describe("syncMyGmail", () => {
  const access = { accessToken: "tok", userId: "u1" };
  it("is off when not connected or no key", async () => {
    const rpc = vi.fn();
    expect(await syncMyGmail("Alex", "h1", { access: null, rpc, keyB64: KEY_B64 })).toEqual({ status: "not_connected" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends only safe fields to the RPC with the caller's display name", async () => {
    const rpc = vi.fn(async () => ({ data: 2, error: null }));
    const r = await syncMyGmail("Alex", "h1", { access, rpc, fetch: asFetch(gmailFetch()), keyB64: KEY_B64 });
    expect(r).toEqual({ status: "ok", count: 2 });
    const [fn, args] = rpc.mock.calls[0] as unknown as [string, { p_member: string; p_threads: Record<string, unknown>[] }];
    expect(fn).toBe("sync_my_email_threads");
    expect(args.p_member).toBe("Alex");
    expect((args as unknown as { p_household: string }).p_household).toBe("h1");
    expect(JSON.stringify(args)).not.toMatch(/@/);
    for (const t of args.p_threads) expect(Object.keys(t).sort()).toEqual(["counterpart_domain", "label_flag", "last_from", "last_message_at", "subject", "thread_hash"]);
  });
  it("reports fixed errors", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: new Error("secret db detail") }));
    const r = await syncMyGmail("Alex", "h1", { access, rpc, fetch: asFetch(gmailFetch()), keyB64: KEY_B64 });
    expect(r).toEqual({ status: "error", message: "Could not save the synced threads." });
    const r2 = await syncMyGmail("Alex", "h1", { access, rpc, fetch: asFetch(gmailFetch({ fail: "profile" })), keyB64: KEY_B64 });
    expect(r2.status).toBe("error");
  });
});

describe("maybeAutoSync", () => {
  const access = { accessToken: "tok", userId: "u1" };
  it("skips when synced less than 10 minutes ago, runs otherwise", async () => {
    const now = Date.UTC(2026, 9, 21, 12, 0, 0);
    const rpcFor = (last: string | null) => vi.fn(async (fn: string) => (fn === "my_gmail_sync_at" ? { data: last, error: null } : { data: 1, error: null }));
    const fresh = rpcFor(new Date(now - 9 * 60_000).toISOString());
    expect(await maybeAutoSync("Alex", "h1", { access, rpc: fresh, now: () => now, fetch: asFetch(gmailFetch()), keyB64: KEY_B64 })).toBeNull();
    expect(fresh).toHaveBeenCalledTimes(1);
    for (const last of [new Date(now - 11 * 60_000).toISOString(), null]) {
      const rpc = rpcFor(last);
      expect(await maybeAutoSync("Alex", "h1", { access, rpc, now: () => now, fetch: asFetch(gmailFetch()), keyB64: KEY_B64 })).toMatchObject({ status: "ok" });
      expect(rpc.mock.calls.map((c) => c[0])).toEqual(["my_gmail_sync_at", "sync_my_email_threads"]);
    }
  });
});
