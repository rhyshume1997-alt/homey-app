import "server-only";
import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";
import zlib from "node:zlib";

/**
 * Outbound fetch for recipe links, with a strict SSRF guard.
 *
 * - https only, no credentials, default port only, no IP-literal hosts, no local-looking names.
 * - Every address the name resolves to must be public; the connection is then pinned to the
 *   address that was checked (custom `lookup`), so a second DNS answer (rebinding) cannot
 *   redirect the socket. The connected peer is checked again after connect.
 * - At most 3 redirects, each hop re-checked from scratch.
 * - One 6 s deadline for the whole thing (DNS, connect, every hop, body).
 * - Body streamed with a 2 MB cap, applied after decompression.
 * - text/html or application/json only.
 * Nothing here logs URLs or bodies.
 */

export const FETCH_LIMITS = {
  timeoutMs: 6_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  maxUrlLength: 2_048,
} as const;

export type BlockCode =
  | "bad_url"
  | "not_https"
  | "credentials"
  | "port"
  | "ip_literal"
  | "blocked_host"
  | "dns"
  | "private_address"
  | "too_many_redirects"
  | "timeout"
  | "too_large"
  | "content_type"
  | "http_status"
  | "network";

export class FetchBlocked extends Error {
  constructor(public readonly code: BlockCode) {
    super(code);
    this.name = "FetchBlocked";
  }
}

const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp", ".localdomain"];

/** Parses and checks a URL string. Throws FetchBlocked; never touches the network. */
export function checkUrl(raw: unknown): URL {
  if (typeof raw !== "string") throw new FetchBlocked("bad_url");
  const s = raw.trim();
  if (!s || s.length > FETCH_LIMITS.maxUrlLength) throw new FetchBlocked("bad_url");
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new FetchBlocked("bad_url");
  }
  if (url.protocol !== "https:") throw new FetchBlocked("not_https");
  if (url.username || url.password) throw new FetchBlocked("credentials");
  // WHATWG URL drops an explicit default port (:443), so anything left is non-default.
  if (url.port !== "") throw new FetchBlocked("port");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new FetchBlocked("bad_url");
  // The URL parser already folds 0x7f.1, 2130706433 and friends into dotted IPv4.
  if (net.isIP(host) !== 0 || host.includes(":")) throw new FetchBlocked("ip_literal");
  const name = host.replace(/\.$/, "");
  if (!name.includes(".") || name === "localhost" || LOCAL_SUFFIXES.some((x) => name.endsWith(x))) {
    throw new FetchBlocked("blocked_host");
  }
  url.hash = "";
  return url;
}

/* ---------- address classification ---------- */

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata lives here)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.31.196.0", 24], // AS112
  ["192.52.193.0", 24], // AMT
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["192.175.48.0", 24], // AS112
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
];
const V4_RANGES = V4_BLOCKED.map(([base, bits]) => {
  const size = 2 ** (32 - bits);
  const start = v4ToInt(base)!;
  return [start, start + size - 1] as const;
});

export function isPublicIPv4(ip: string): boolean {
  const n = v4ToInt(ip);
  if (n === null) return false;
  return !V4_RANGES.some(([a, b]) => n >= a && n <= b);
}

/** Eight 16-bit groups, or null for anything malformed (including zone ids). */
export function parseIPv6(ip: string): number[] | null {
  if (!ip || ip.includes("%")) return null;
  let s = ip.toLowerCase();
  if (s.includes(".")) {
    // Embedded dotted IPv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4): rewrite as two hex groups.
    const at = s.lastIndexOf(":");
    const n = v4ToInt(s.slice(at + 1));
    if (n === null) return null;
    s = `${s.slice(0, at + 1)}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (h: string) => (h === "" ? [] : h.split(":"));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

/**
 * Deny by default: only global unicast (2000::/3) is allowed, minus documentation, 6to4,
 * Teredo/ORCHID and the other IETF special ranges in 2001::/23. That also rules out ::1, ::,
 * IPv4-mapped (::ffff:0:0/96), IPv4-compatible, NAT64 (64:ff9b::/96), ULA (fc00::/7),
 * link-local (fe80::/10), site-local and multicast (ff00::/8).
 */
export function isPublicIPv6(ip: string): boolean {
  const g = parseIPv6(ip);
  if (!g) return false;
  if ((g[0] & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2001 && g[1] < 0x0200) return false; // 2001::/23 IETF special (Teredo, ORCHID, benchmarking)
  if (g[0] === 0x2002) return false; // 6to4 embeds an IPv4 address
  if (g[0] === 0x3fff && g[1] < 0x1000) return false; // 3fff::/20 documentation
  return true;
}

export function isPublicAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPublicIPv4(ip);
  if (kind === 6) return isPublicIPv6(ip);
  return false;
}

/* ---------- resolution and transport ---------- */

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Lookup = (host: string) => Promise<ResolvedAddress[]>;

const systemLookup: Lookup = async (host) => {
  const all = await dns.promises.lookup(host, { all: true, verbatim: true });
  return all.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

/** Every answer must be public; the first is the one we connect to. */
export async function resolvePublic(host: string, lookup: Lookup = systemLookup): Promise<ResolvedAddress> {
  let addrs: ResolvedAddress[];
  try {
    addrs = await lookup(host);
  } catch {
    throw new FetchBlocked("dns");
  }
  if (!addrs.length) throw new FetchBlocked("dns");
  if (addrs.some((a) => !isPublicAddress(a.address))) throw new FetchBlocked("private_address");
  return addrs[0];
}

export type RawResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Buffer>;
  /** The peer the socket actually connected to, when known. */
  remoteAddress?: string;
  destroy(): void;
};

export type Transport = (
  url: URL,
  pinned: ResolvedAddress,
  signal: AbortSignal,
  headers: Record<string, string>,
) => Promise<RawResponse>;

type LookupCb = (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void;

/**
 * A dns.lookup replacement that can only ever answer with the validated address, whatever host
 * it is asked about. Handles both call shapes (single, and `all: true` used by happy eyeballs).
 */
export function pinnedLookup(pinned: ResolvedAddress) {
  return (_host: string, opts: { all?: boolean } | number | LookupCb | undefined, cb?: LookupCb) => {
    const done = (typeof opts === "function" ? opts : cb) as LookupCb;
    if (typeof opts === "object" && opts?.all) done(null, [{ address: pinned.address, family: pinned.family }]);
    else done(null, pinned.address, pinned.family);
  };
}

/** node:https with a lookup that can only ever answer with the address we validated. */
export const nodeTransport: Transport = (url, pinned, signal, headers) =>
  new Promise((resolve, reject) => {
    const lookup = pinnedLookup(pinned);
    const req = https.request(
      {
        protocol: "https:",
        host: url.hostname,
        servername: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers,
        lookup: lookup as unknown as net.LookupFunction,
        agent: false, // no pooled sockets: each hop connects to its own validated address
        signal,
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: res,
          remoteAddress: res.socket?.remoteAddress,
          destroy: () => res.destroy(),
        });
      },
    );
    req.on("socket", (sock) => {
      sock.once("connect", () => {
        if (!sock.remoteAddress || !isPublicAddress(sock.remoteAddress)) req.destroy(new FetchBlocked("private_address"));
      });
    });
    req.on("error", (e) => reject(e));
    req.end();
  });

/* ---------- the fetch ---------- */

export type FetchKind = "html" | "json";
export type SafeFetchResult = { finalUrl: URL; kind: FetchKind; text: string };
export type SafeFetchDeps = { lookup?: Lookup; transport?: Transport; timeoutMs?: number; maxBytes?: number };

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function kindOf(ct: string | undefined): FetchKind | null {
  const mime = (ct ?? "").split(";")[0].trim().toLowerCase();
  if (mime === "text/html") return "html";
  if (mime === "application/json") return "json";
  return null;
}

function decoded(body: AsyncIterable<Buffer>, encoding: string | undefined): AsyncIterable<Buffer> {
  const enc = (encoding ?? "identity").trim().toLowerCase();
  if (enc === "identity" || enc === "") return body;
  const z =
    enc === "gzip" || enc === "x-gzip"
      ? zlib.createGunzip()
      : enc === "deflate"
        ? zlib.createInflate()
        : enc === "br"
          ? zlib.createBrotliDecompress()
          : null;
  if (!z) throw new FetchBlocked("content_type");
  const src = Readable.from(body);
  src.on("error", (e) => z.destroy(e));
  src.pipe(z);
  return z;
}

/** Reads at most `max` bytes (after decompression); one byte more and the read is abandoned. */
async function readCapped(body: AsyncIterable<Buffer>, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.length;
    if (total > max) throw new FetchBlocked("too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new FetchBlocked("timeout"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new FetchBlocked("timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => (signal.removeEventListener("abort", onAbort), resolve(v)),
      (e) => (signal.removeEventListener("abort", onAbort), reject(e)),
    );
  });
}

/** GET a public https URL under the guard. Throws FetchBlocked with a code; never logs. */
export async function safeFetch(raw: string, deps: SafeFetchDeps = {}): Promise<SafeFetchResult> {
  const lookup = deps.lookup ?? systemLookup;
  const transport = deps.transport ?? nodeTransport;
  const max = deps.maxBytes ?? FETCH_LIMITS.maxBytes;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? FETCH_LIMITS.timeoutMs);
  const headers = {
    accept: "text/html,application/json;q=0.9",
    "accept-encoding": "gzip, deflate, br",
    "accept-language": "en-GB,en;q=0.8",
    "user-agent": "Mozilla/5.0 (compatible; OurHomeRecipeImport/1.0)",
  };
  let res: RawResponse | null = null;
  try {
    let url = checkUrl(raw);
    for (let hop = 0; ; hop++) {
      const pinned = await abortable(resolvePublic(url.hostname.replace(/\.$/, ""), lookup), ctrl.signal);
      res = await abortable(transport(url, pinned, ctrl.signal, headers), ctrl.signal);
      if (res.remoteAddress !== undefined && !isPublicAddress(res.remoteAddress)) throw new FetchBlocked("private_address");
      if (REDIRECTS.has(res.status)) {
        const loc = first(res.headers.location);
        res.destroy();
        res = null;
        if (hop >= FETCH_LIMITS.maxRedirects) throw new FetchBlocked("too_many_redirects");
        if (!loc) throw new FetchBlocked("http_status");
        let next: string;
        try {
          next = new URL(loc, url).toString();
        } catch {
          throw new FetchBlocked("bad_url");
        }
        url = checkUrl(next);
        continue;
      }
      if (res.status < 200 || res.status >= 300) throw new FetchBlocked("http_status");
      const kind = kindOf(first(res.headers["content-type"]));
      if (!kind) throw new FetchBlocked("content_type");
      const len = Number(first(res.headers["content-length"]));
      if (Number.isFinite(len) && len > max) throw new FetchBlocked("too_large");
      const buf = await abortable(readCapped(decoded(res.body, first(res.headers["content-encoding"])), max), ctrl.signal);
      return { finalUrl: url, kind, text: new TextDecoder("utf-8").decode(buf) };
    }
  } catch (e) {
    if (ctrl.signal.aborted) throw new FetchBlocked("timeout");
    if (e instanceof FetchBlocked) throw e;
    throw new FetchBlocked("network");
  } finally {
    clearTimeout(timer);
    res?.destroy();
    ctrl.abort();
  }
}
