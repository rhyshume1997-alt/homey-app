import "server-only";
import { getServerEnv } from "@/server/env";
import { createUserClient } from "@/server/db/supabase";
import { decryptToken } from "./crypto";
import { hasScope } from "./scopes";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const TIMEOUT_MS = 8_000;

export interface GoogleEnv { clientId?: string; clientSecret?: string; key?: string }
export interface TokenStore {
  userId: string;
  get(): Promise<{ ciphertext: string; scopes: string } | null>;
  remove(): Promise<void>;
}
export interface TokenDeps { fetch?: typeof fetch; now?: () => number; env?: GoogleEnv; store?: TokenStore | null }

export type RefreshResult =
  | { ok: true; accessToken: string; expiresIn: number; scope: string }
  | { ok: false; reason: "invalid_grant" | "failed" };

export function googleEnv(): GoogleEnv {
  const e = getServerEnv();
  return { clientId: e.GOOGLE_OAUTH_CLIENT_ID, clientSecret: e.GOOGLE_OAUTH_CLIENT_SECRET, key: e.GOOGLE_TOKEN_ENCRYPTION_KEY };
}

async function timed(f: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await f(url, { ...init, signal: ctl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

/** Exchanges a refresh token for an access token. Never logs the tokens or Google's error body. */
export async function refreshAccessToken(refreshToken: string, env: GoogleEnv, f: typeof fetch = fetch): Promise<RefreshResult> {
  if (!env.clientId || !env.clientSecret) return { ok: false, reason: "failed" };
  try {
    const res = await timed(f, TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: env.clientId,
        client_secret: env.clientSecret,
        refresh_token: refreshToken,
      }),
    });
    const j = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown; scope?: unknown; error?: unknown } | null;
    if (!res.ok) return { ok: false, reason: j?.error === "invalid_grant" ? "invalid_grant" : "failed" };
    if (!j || typeof j.access_token !== "string") return { ok: false, reason: "failed" };
    return {
      ok: true,
      accessToken: j.access_token,
      expiresIn: typeof j.expires_in === "number" ? j.expires_in : 3600,
      scope: typeof j.scope === "string" ? j.scope : "",
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Best effort: failure is ignored (the stored copy is deleted regardless). */
export async function revokeToken(token: string, f: typeof fetch = fetch): Promise<void> {
  try {
    await timed(f, REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // best effort
  }
}

/** Store backed by the signed-in user's own session (RLS and SECURITY DEFINER functions). */
export async function currentUserStore(): Promise<TokenStore | null> {
  const db = await createUserClient();
  if (!db) return null;
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return null;
  return {
    userId: data.user.id,
    async get() {
      const r = await db.rpc("get_my_google_token");
      const row = Array.isArray(r.data) ? r.data[0] : null;
      if (r.error || !row || typeof row.ciphertext !== "string") return null;
      return { ciphertext: row.ciphertext, scopes: String(row.scopes ?? "") };
    },
    async remove() {
      await db.rpc("delete_my_google_token");
    },
  };
}

const cache = new Map<string, { ciphertext: string; accessToken: string; scopes: string; expires: number }>();
export function clearAccessTokenCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

export interface GoogleAccess { accessToken: string; scopes: string; userId: string }

/**
 * Access token for the CURRENT user, or null when not connected, env is missing, the needed scope
 * was not granted, or Google no longer accepts the grant (the stored token is then deleted and the
 * user must reconnect). The database is always consulted first so a disconnect takes effect at once.
 */
export async function getGoogleAccess(scope?: string, deps: TokenDeps = {}): Promise<GoogleAccess | null> {
  const env = deps.env ?? googleEnv();
  if (!env.clientId || !env.clientSecret || !env.key) return null;
  const store = deps.store === undefined ? await currentUserStore() : deps.store;
  if (!store) return null;
  const row = await store.get();
  if (!row) {
    cache.delete(store.userId);
    return null;
  }
  if (scope && !hasScope(row.scopes, scope)) return null;
  const now = (deps.now ?? Date.now)();
  const hit = cache.get(store.userId);
  if (hit && hit.ciphertext === row.ciphertext && hit.expires - 60_000 > now) {
    return { accessToken: hit.accessToken, scopes: row.scopes, userId: store.userId };
  }
  let refresh: string;
  try {
    refresh = decryptToken(row.ciphertext, env.key, store.userId);
  } catch {
    return null;
  }
  const r = await refreshAccessToken(refresh, env, deps.fetch ?? fetch);
  if (!r.ok) {
    cache.delete(store.userId);
    if (r.reason === "invalid_grant") await store.remove().catch(() => undefined);
    return null;
  }
  cache.set(store.userId, { ciphertext: row.ciphertext, accessToken: r.accessToken, scopes: row.scopes, expires: now + r.expiresIn * 1000 });
  return { accessToken: r.accessToken, scopes: row.scopes, userId: store.userId };
}

export async function getAccessToken(scope?: string, deps: TokenDeps = {}): Promise<string | null> {
  return (await getGoogleAccess(scope, deps))?.accessToken ?? null;
}

/** Drops the cached access token if Google rejected it (HTTP 401). */
export function invalidateAccessToken(userId: string): void {
  cache.delete(userId);
}
