import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/auth/session";
import { createUserClient } from "@/server/db/supabase";
import { getServerEnv } from "@/server/env";
import { encryptToken } from "@/server/integrations/google/crypto";
import { decideConnect, GMAIL_SCOPE, SHEETS_SCOPE, hasScope } from "@/server/integrations/google/scopes";
import { clearAccessTokenCache, googleEnv, refreshAccessToken } from "@/server/integrations/google/token";

export const dynamic = "force-dynamic";

function to(request: NextRequest, path: string) {
  const res = NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Never echoes provider errors and never logs tokens: every outcome maps to a fixed code. */
export async function GET(request: NextRequest) {
  const supabase = await createUserClient();
  if (!supabase) return to(request, "/login?error=unavailable");

  // Who started this flow? Remembered BEFORE the exchange, which replaces the session.
  const before = await getSession();
  if (!before) return to(request, "/login");

  const code = request.nextUrl.searchParams.get("code");
  if (!code || request.nextUrl.searchParams.has("error")) return to(request, "/settings/google?error=cancelled");

  const env = googleEnv();
  const key = getServerEnv().GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!env.clientId || !env.clientSecret || !key) return to(request, "/settings/google?error=unconfigured");


  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  // A failed or forged exchange leaves the existing session alone (no sign-out from a crafted link).
  if (error || !data.session) return to(request, "/settings/google?error=failed");
  const after = await getSession();
  const decision = decideConnect({ before: before.userId, after: after?.userId ?? null, isMember: !!after });
  if (decision !== "ok") {
    // A different Google account signed in: end only this browser's new session.
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // best effort
    }
    return to(request, "/login?error=denied");
  }
  const refreshToken = data.session.provider_refresh_token;
  // The exchange saved provider_token and provider_refresh_token into the (script-readable) auth
  // cookie. Rewrite the session without them so the refresh token exists only encrypted in the DB.
  try {
    await supabase.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  } catch {
    return to(request, "/settings/google?error=failed");
  }

  if (!refreshToken) return to(request, "/settings/google?error=no_refresh_token");

  // Validate the token and learn which scopes were really granted (people can untick them).
  const checked = await refreshAccessToken(refreshToken, env);
  if (!checked.ok) return to(request, "/settings/google?error=failed");
  const granted = [SHEETS_SCOPE, GMAIL_SCOPE].filter((s) => hasScope(checked.scope, s)).join(" ");
  if (!granted) return to(request, "/settings/google?error=scopes");

  try {
    const ciphertext = encryptToken(refreshToken, key, before.userId);
    const { error } = await supabase.rpc("store_my_google_token", { p_ciphertext: ciphertext, p_scopes: granted });
    if (error) return to(request, "/settings/google?error=failed");
  } catch {
    return to(request, "/settings/google?error=failed");
  }
  clearAccessTokenCache(before.userId);
  return to(request, "/settings/google?connected=1");
}
