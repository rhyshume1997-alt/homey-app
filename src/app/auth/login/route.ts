import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeNext } from "@/server/auth/next-param";
import { supabaseEnv } from "@/server/db/supabase";

export const dynamic = "force-dynamic";

function to(request: NextRequest, path: string, status = 303) {
  const res = NextResponse.redirect(new URL(path, request.nextUrl.origin), status);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(request: NextRequest) {
  const env = supabaseEnv();
  if (!env) return to(request, "/login?error=unavailable");

  const origin = request.nextUrl.origin;
  const next = sanitizeNext(request.nextUrl.searchParams.get("next"));
  const callback = new URL("/auth/callback", origin);
  if (next && next !== "/") callback.searchParams.set("next", next);

  // Collect cookies (PKCE verifier) and write them to the redirect response.
  const pending: { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] }[] = [];
  try {
    const supabase = createServerClient(env.url, env.key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const c of list) pending.push(c);
        },
      },
    });
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString(), skipBrowserRedirect: true },
    });
    if (error || !data?.url) return to(request, "/login?error=unavailable");

    const res = NextResponse.redirect(data.url, 303);
    for (const { name, value, options } of pending) res.cookies.set(name, value, options);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch {
    return to(request, "/login?error=unavailable");
  }
}
