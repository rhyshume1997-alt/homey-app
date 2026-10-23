import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptToken } from "./crypto";
import { clearAccessTokenCache, getAccessToken, REVOKE_URL, refreshAccessToken, revokeToken, type TokenStore } from "./token";
import { SHEETS_SCOPE, GMAIL_SCOPE, decideConnect } from "./scopes";

const KEY = randomBytes(32).toString("base64");
const env = { clientId: "cid", clientSecret: "csecret", key: KEY };
const UID = "u-1";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const asFetch = (f: unknown) => f as typeof fetch;

function store(scopes = `${SHEETS_SCOPE} ${GMAIL_SCOPE}`, refresh = "1//refresh") {
  const s = {
    userId: UID,
    row: { ciphertext: encryptToken(refresh, KEY, UID), scopes } as { ciphertext: string; scopes: string } | null,
    get: vi.fn(async () => s.row),
    remove: vi.fn(async () => {
      s.row = null;
    }),
  };
  return s as typeof s & TokenStore;
}

beforeEach(() => clearAccessTokenCache());

describe("getAccessToken", () => {
  it("refreshes with client credentials and caches until expiry minus 60 s", async () => {
    const s = store();
    const f = vi.fn(async () => json({ access_token: "at-1", expires_in: 3600, scope: s.row!.scopes }));
    let t = 0;
    const deps = { env, store: s, fetch: asFetch(f), now: () => t };
    expect(await getAccessToken(SHEETS_SCOPE, deps)).toBe("at-1");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = (init.body as URLSearchParams).toString();
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("client_id=cid");
    expect(body).toContain("refresh_token=1%2F%2Frefresh");
    t = 3600_000 - 61_000;
    expect(await getAccessToken(SHEETS_SCOPE, deps)).toBe("at-1");
    expect(f).toHaveBeenCalledTimes(1);
    t = 3600_000 - 59_000;
    await getAccessToken(SHEETS_SCOPE, deps);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("returns null when not connected, env missing, or scope not granted", async () => {
    const f = vi.fn();
    const s = store();
    s.row = null;
    expect(await getAccessToken(SHEETS_SCOPE, { env, store: s, fetch: asFetch(f) })).toBeNull();
    expect(await getAccessToken(SHEETS_SCOPE, { env: { ...env, key: undefined }, store: store(), fetch: asFetch(f) })).toBeNull();
    expect(await getAccessToken(SHEETS_SCOPE, { env: { ...env, clientSecret: undefined }, store: store(), fetch: asFetch(f) })).toBeNull();
    expect(await getAccessToken(SHEETS_SCOPE, { env, store: null, fetch: asFetch(f) })).toBeNull();
    expect(await getAccessToken(GMAIL_SCOPE, { env, store: store(SHEETS_SCOPE), fetch: asFetch(f) })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("deletes the stored token on invalid_grant and asks to reconnect", async () => {
    const s = store();
    const f = vi.fn(async () => json({ error: "invalid_grant", error_description: "Token has been revoked" }, 400));
    expect(await getAccessToken(SHEETS_SCOPE, { env, store: s, fetch: asFetch(f) })).toBeNull();
    expect(s.remove).toHaveBeenCalledTimes(1);
  });

  it("keeps the stored token on transient failures", async () => {
    const s = store();
    const f = vi.fn(async () => json({ error: "backend_error" }, 503));
    expect(await getAccessToken(SHEETS_SCOPE, { env, store: s, fetch: asFetch(f) })).toBeNull();
    const thrown = vi.fn(async () => {
      throw new Error("network");
    });
    expect(await getAccessToken(SHEETS_SCOPE, { env, store: s, fetch: asFetch(thrown) })).toBeNull();
    expect(s.remove).not.toHaveBeenCalled();
  });

  it("returns null if the ciphertext belongs to another user", async () => {
    const s = store();
    s.row = { ciphertext: encryptToken("x", KEY, "someone-else"), scopes: SHEETS_SCOPE };
    expect(await getAccessToken(SHEETS_SCOPE, { env, store: s, fetch: asFetch(vi.fn()) })).toBeNull();
  });

  it("a disconnect takes effect immediately even with a warm cache", async () => {
    const s = store();
    const f = vi.fn(async () => json({ access_token: "at", expires_in: 3600 }));
    const deps = { env, store: s, fetch: asFetch(f), now: () => 0 };
    expect(await getAccessToken(SHEETS_SCOPE, deps)).toBe("at");
    s.row = null;
    expect(await getAccessToken(SHEETS_SCOPE, deps)).toBeNull();
  });
});

describe("refresh and revoke helpers", () => {
  it("refreshAccessToken reports the granted scope", async () => {
    const f = vi.fn(async () => json({ access_token: "a", expires_in: 100, scope: "x y" }));
    expect(await refreshAccessToken("r", env, asFetch(f))).toEqual({ ok: true, accessToken: "a", expiresIn: 100, scope: "x y" });
    expect(await refreshAccessToken("r", { ...env, clientId: undefined }, asFetch(f))).toEqual({ ok: false, reason: "failed" });
  });
  it("revokeToken posts to Google and never throws", async () => {
    const f = vi.fn(async () => json({}));
    await revokeToken("tok", asFetch(f));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(REVOKE_URL);
    expect((init.body as URLSearchParams).get("token")).toBe("tok");
    await expect(revokeToken("tok", asFetch(vi.fn(async () => { throw new Error("down"); })))).resolves.toBeUndefined();
  });
});

describe("decideConnect", () => {
  it("allows only the same signed-in member", () => {
    expect(decideConnect({ before: "a", after: "a", isMember: true })).toBe("ok");
    expect(decideConnect({ before: "a", after: "b", isMember: true })).toBe("denied");
    expect(decideConnect({ before: null, after: "a", isMember: true })).toBe("denied");
    expect(decideConnect({ before: "a", after: null, isMember: true })).toBe("denied");
    expect(decideConnect({ before: "a", after: "a", isMember: false })).toBe("denied");
  });
});
