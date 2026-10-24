import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  FETCH_LIMITS, FetchBlocked, checkUrl, isPublicAddress, nodeTransport, parseIPv6, pinnedLookup, resolvePublic, safeFetch,
  type Lookup, type RawResponse, type ResolvedAddress, type Transport,
} from "./ssrf";

const code = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    return e instanceof FetchBlocked ? e.code : `other:${String(e)}`;
  }
  return "ok";
};

describe("checkUrl", () => {
  it.each([
    ["http://example.com/recipe", "not_https"],
    ["ftp://example.com/recipe", "not_https"],
    ["file:///etc/passwd", "not_https"],
    ["javascript:alert(1)", "not_https"],
    ["https://user:pass@example.com/", "credentials"],
    ["https://user@example.com/", "credentials"],
    ["https://example.com:8443/", "port"],
    ["https://example.com:80/", "port"],
    ["https://example.com:0/", "port"],
    ["https://127.0.0.1/", "ip_literal"],
    ["https://8.8.8.8/", "ip_literal"],
    ["https://2130706433/", "ip_literal"], // decimal 127.0.0.1
    ["https://0x7f.1/", "ip_literal"], // hex shorthand
    ["https://017700000001/", "ip_literal"], // octal
    ["https://127.1/", "ip_literal"],
    ["https://[::1]/", "ip_literal"],
    ["https://[::ffff:127.0.0.1]/", "ip_literal"],
    ["https://[fe80::1]/", "ip_literal"],
    ["https://localhost/", "blocked_host"],
    ["https://localhost./", "blocked_host"],
    ["https://LOCALHOST/", "blocked_host"],
    ["https://api.localhost/", "blocked_host"],
    ["https://printer.local/", "blocked_host"],
    ["https://metadata.google.internal/", "blocked_host"],
    ["https://router.lan/", "blocked_host"],
    ["https://box.home.arpa/", "blocked_host"],
    ["https://intranethost/", "blocked_host"],
    ["not a url", "bad_url"],
    ["", "bad_url"],
    [`https://example.com/${"a".repeat(FETCH_LIMITS.maxUrlLength)}`, "bad_url"],
  ])("rejects %s (%s)", async (u, want) => {
    expect(await code(() => checkUrl(u))).toBe(want);
  });

  it("rejects non-strings", async () => {
    for (const v of [null, undefined, 1, {}, ["https://example.com"]]) expect(await code(() => checkUrl(v))).toBe("bad_url");
  });

  it("accepts public https names, including an explicit :443, and drops the fragment", () => {
    expect(checkUrl("https://www.example.com/r/pasta?x=1#step2").toString()).toBe("https://www.example.com/r/pasta?x=1");
    expect(checkUrl("https://example.com:443/a").toString()).toBe("https://example.com/a");
    expect(checkUrl("  https://Example.COM/a  ").hostname).toBe("example.com");
  });
});

describe("address classification", () => {
  it.each([
    "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.0", "100.100.100.100", "100.127.255.255", "127.0.0.1",
    "127.255.255.254", "169.254.169.254", "169.254.0.1", "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.0.2.10",
    "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.5", "224.0.0.1",
    "239.255.255.250", "240.0.0.1", "255.255.255.255",
  ])("blocks IPv4 %s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(["8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.0", "172.15.255.255", "172.32.0.0", "192.169.0.1", "151.101.1.69"])(
    "allows IPv4 %s",
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );

  it.each([
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:8.8.8.8", "0:0:0:0:0:ffff:a9fe:a9fe", "::127.0.0.1",
    "64:ff9b::a9fe:a9fe", "64:ff9b::8.8.8.8", "fc00::1", "fd12:3456:789a::1", "fe80::1", "fe80::1%eth0", "febf::1",
    "fec0::1", "ff02::1", "ff05::1:3", "2001:db8::1", "2001::1", "2001:0:4136:e378::1", "2001:10::1", "2002:7f00:1::1",
    "100::1", "3fff::1", "not-an-ip", "", "1:2:3:4:5:6:7:8:9", "1::2::3", "12345::1",
  ])("blocks IPv6 %s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(["2606:4700:4700::1111", "2a00:1450:4009:81f::200e", "2001:4860:4860::8888", "2620:fe::fe"])(
    "allows IPv6 %s",
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );

  it("expands IPv6 forms, including an embedded IPv4 tail", () => {
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6("2001:db8::")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIPv6("1:2:3:4:5:6:7")).toBeNull();
    expect(parseIPv6("::ffff:300.0.0.1")).toBeNull();
  });
});

describe("resolvePublic", () => {
  const fixed = (...a: string[]): Lookup => async () => a.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

  it("returns the first address when every answer is public", async () => {
    expect(await resolvePublic("example.com", fixed("93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"))).toEqual({
      address: "93.184.215.14",
      family: 4,
    });
  });
  it("rejects if ANY answer is private (no picking the public one)", async () => {
    expect(await code(resolvePublic("x.example", fixed("93.184.215.14", "10.0.0.5")))).toBe("private_address");
    expect(await code(resolvePublic("x.example", fixed("::ffff:169.254.169.254")))).toBe("private_address");
  });
  it("rejects empty answers and lookup errors", async () => {
    expect(await code(resolvePublic("x.example", fixed()))).toBe("dns");
    expect(await code(resolvePublic("x.example", async () => Promise.reject(new Error("ENOTFOUND"))))).toBe("dns");
  });
});

describe("pinned lookup", () => {
  const pinned: ResolvedAddress = { address: "93.184.215.14", family: 4 };
  it("answers with the validated address whatever host is asked, in both call shapes", () => {
    const one = vi.fn();
    pinnedLookup(pinned)("evil-rebind.example", { all: false }, one);
    expect(one).toHaveBeenCalledWith(null, "93.184.215.14", 4);
    const all = vi.fn();
    pinnedLookup(pinned)("evil-rebind.example", { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: "93.184.215.14", family: 4 }]);
    const legacy = vi.fn();
    pinnedLookup(pinned)("evil-rebind.example", legacy);
    expect(legacy).toHaveBeenCalledWith(null, "93.184.215.14", 4);
  });

  it("node transport connects to the pinned address, never re-resolving the name", async () => {
    // .invalid never resolves; reaching 127.0.0.1 proves the pinned lookup was used. The socket
    // is then refused (nothing on :443) or dropped by the post-connect address check.
    const ctrl = new AbortController();
    const err = await nodeTransport(new URL("https://never-resolves.invalid/x"), { address: "127.0.0.1", family: 4 }, ctrl.signal, {}).then(
      () => null,
      (e: unknown) => e,
    );
    const e = err as { code?: string; address?: string };
    expect(e).not.toBeNull();
    expect(e.code).not.toBe("ENOTFOUND");
    expect(e.code === "ECONNREFUSED" ? e.address : e.code).toMatch(/^(127\.0\.0\.1|private_address)$/);
  });
});

/* ---------- safeFetch with a fake transport ---------- */

async function* chunks(...bufs: (Buffer | string)[]) {
  for (const b of bufs) yield Buffer.isBuffer(b) ? b : Buffer.from(b);
}
function resp(status: number, headers: RawResponse["headers"], body: AsyncIterable<Buffer> = chunks(), remoteAddress?: string): RawResponse {
  return { status, headers, body, remoteAddress, destroy: vi.fn() };
}
const html = (s: string) => resp(200, { "content-type": "text/html; charset=utf-8" }, chunks(s));

/** Every name resolves to a public address unless listed. */
function dnsMap(map: Record<string, string[]> = {}) {
  return vi.fn<Lookup>(async (h) => (map[h] ?? ["93.184.215.14"]).map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
}

describe("safeFetch", () => {
  it("fetches HTML through the transport using the validated, pinned address", async () => {
    const lookup = dnsMap({ "recipes.example": ["151.101.1.69"] });
    const transport = vi.fn<Transport>(async () => html("<p>hi</p>"));
    const r = await safeFetch("https://recipes.example/pasta?utm=1", { lookup, transport });
    expect(r.kind).toBe("html");
    expect(r.text).toBe("<p>hi</p>");
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, pinned] = transport.mock.calls[0];
    expect(url.toString()).toBe("https://recipes.example/pasta?utm=1");
    expect(pinned).toEqual({ address: "151.101.1.69", family: 4 });
  });

  it("refuses before connecting when the name resolves to a private address", async () => {
    const transport = vi.fn<Transport>();
    expect(await code(safeFetch("https://rebind.example/", { lookup: dnsMap({ "rebind.example": ["127.0.0.1"] }), transport }))).toBe(
      "private_address",
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("drops a response whose socket ended up on a private peer", async () => {
    const transport = vi.fn<Transport>(async () => resp(200, { "content-type": "text/html" }, chunks("x"), "10.1.2.3"));
    expect(await code(safeFetch("https://a.example/", { lookup: dnsMap(), transport }))).toBe("private_address");
  });

  it("follows up to 3 redirects, re-checking every hop", async () => {
    const lookup = dnsMap();
    let n = 0;
    const transport = vi.fn<Transport>(async () => (++n <= 3 ? resp(302, { location: `/hop${n}` }) : html("done")));
    const r = await safeFetch("https://a.example/start", { lookup, transport });
    expect(r.text).toBe("done");
    expect(r.finalUrl.toString()).toBe("https://a.example/hop3");
    expect(lookup).toHaveBeenCalledTimes(4);
  });

  it("stops at the 4th redirect", async () => {
    const transport = vi.fn<Transport>(async () => resp(301, { location: "https://a.example/again" }));
    expect(await code(safeFetch("https://a.example/", { lookup: dnsMap(), transport }))).toBe("too_many_redirects");
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["http://a.example/", "not_https"],
    ["https://127.0.0.1/", "ip_literal"],
    ["https://[::1]/", "ip_literal"],
    ["https://169.254.169.254/latest/meta-data/", "ip_literal"],
    ["https://a.example:8080/", "port"],
    ["https://u:p@a.example/", "credentials"],
    ["https://localhost/", "blocked_host"],
    ["https://internal.example/", "private_address"],
  ])("blocks a redirect to %s", async (loc, want) => {
    const lookup = dnsMap({ "internal.example": ["192.168.0.10"] });
    const transport = vi.fn<Transport>(async () => resp(307, { location: loc }));
    expect(await code(safeFetch("https://a.example/", { lookup, transport }))).toBe(want);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect without a Location and non-2xx statuses", async () => {
    expect(await code(safeFetch("https://a.example/", { lookup: dnsMap(), transport: async () => resp(302, {}) }))).toBe("http_status");
    expect(await code(safeFetch("https://a.example/", { lookup: dnsMap(), transport: async () => resp(404, { "content-type": "text/html" }) }))).toBe(
      "http_status",
    );
  });

  it.each([
    ["image/png", "content_type"],
    ["application/octet-stream", "content_type"],
    ["text/plain", "content_type"],
    ["application/javascript", "content_type"],
    [undefined, "content_type"],
    ["application/json; charset=utf-8", "ok"],
    ["TEXT/HTML", "ok"],
  ])("content type %s -> %s", async (ct, want) => {
    const transport: Transport = async () => resp(200, ct ? { "content-type": ct } : {}, chunks("{}"));
    expect(await code(safeFetch("https://a.example/", { lookup: dnsMap(), transport }))).toBe(want);
  });

  it("rejects a declared Content-Length over the cap without reading", async () => {
    const transport: Transport = async () => resp(200, { "content-type": "text/html", "content-length": String(FETCH_LIMITS.maxBytes + 1) });
    expect(await code(safeFetch("https://a.example/", { lookup: dnsMap(), transport }))).toBe("too_large");
  });

  it("stops a streamed body at the cap when no length is declared", async () => {
    const big = Buffer.alloc(64 * 1024, 97);
    async function* endless() {
      for (;;) yield big;
    }
    const transport: Transport = async () => resp(200, { "content-type": "text/html" }, endless());
    expect(await code(safeFetch("https://a.example/", { lookup: dnsMap(), transport }))).toBe("too_large");
  });

  it("applies the cap after decompression (gzip bomb)", async () => {
    const bomb = gzipSync(Buffer.alloc(FETCH_LIMITS.maxBytes + 1024, 0));
    expect(bomb.length).toBeLessThan(10_000);
    const transport: Transport = async () => resp(200, { "content-type": "text/html", "content-encoding": "gzip" }, chunks(bomb));
    expect(await code(safeFetch("https://a.example/", { lookup: dnsMap(), transport }))).toBe("too_large");
  });

  it("decodes gzip bodies under the cap", async () => {
    const transport: Transport = async () =>
      resp(200, { "content-type": "text/html", "content-encoding": "gzip" }, chunks(gzipSync(Buffer.from("<h1>Soup</h1>"))));
    expect((await safeFetch("https://a.example/", { lookup: dnsMap(), transport })).text).toBe("<h1>Soup</h1>");
  });

  it("rejects unknown content encodings", async () => {
    const transport: Transport = async () => resp(200, { "content-type": "text/html", "content-encoding": "zstd-weird" }, chunks("x"));
    expect(await code(safeFetch("https://a.example/", { lookup: dnsMap(), transport }))).toBe("content_type");
  });

  it("times out a hanging connection", async () => {
    const transport: Transport = () => new Promise(() => {});
    expect(await code(safeFetch("https://a.example/", { lookup: dnsMap(), transport, timeoutMs: 30 }))).toBe("timeout");
  });

  it("times out slow DNS", async () => {
    const lookup: Lookup = () => new Promise(() => {});
    expect(await code(safeFetch("https://a.example/", { lookup, transport: vi.fn(), timeoutMs: 30 }))).toBe("timeout");
  });

  it("times out a body that trickles forever and destroys the response", async () => {
    async function* trickle() {
      yield Buffer.from("<html>");
      await new Promise(() => {});
    }
    const r = resp(200, { "content-type": "text/html" }, trickle());
    expect(await code(safeFetch("https://a.example/", { lookup: dnsMap(), transport: async () => r, timeoutMs: 30 }))).toBe("timeout");
    expect(r.destroy).toHaveBeenCalled();
  });

  it("passes the abort signal to the transport and uses the 6 s default", async () => {
    expect(FETCH_LIMITS.timeoutMs).toBe(6_000);
    expect(FETCH_LIMITS.maxBytes).toBe(2 * 1024 * 1024);
    expect(FETCH_LIMITS.maxRedirects).toBe(3);
    let signal: AbortSignal | null = null;
    await safeFetch("https://a.example/", {
      lookup: dnsMap(),
      transport: async (_u, _p, s) => ((signal = s), html("x")),
    });
    expect(signal!.aborted).toBe(true); // released once the fetch finished
  });

  it("maps transport errors to network", async () => {
    const transport: Transport = async () => Promise.reject(new Error("ECONNRESET"));
    expect(await code(safeFetch("https://a.example/", { lookup: dnsMap(), transport }))).toBe("network");
  });
});
