import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/auth/session";
import { supabaseEnv } from "@/server/db/supabase";
import { CONNECT_SCOPES } from "@/server/integrations/google/scopes";

export const dynamic = "force-dynamic";

function to(request: NextRequest, path: string, status = 303) {
  const res = NextResponse.redirect(new URL(path, request.nextUrl.origin), status);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Starts the read-only Google connect flow. Signed-in household members only. */
export async function GET(request: NextRequest) {
  const env = supabaseEnv();
  if (!env) return to(request, "/login?error=unavailable");
  const session = await getSession();
  if (!session) return to(request, "/login", 307);

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
      options: {
        scopes: CONNECT_SCOPES,
        redirectTo: new URL("/auth/google/callback", request.nextUrl.origin).toString(),
        queryParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
        skipBrowserRedirect: true,
      },
    });
    if (error || !data?.url) return to(request, "/settings/google?error=failed");

    const res = NextResponse.redirect(data.url, 303);
    for (const { name, value, options } of pending) res.cookies.set(name, value, options);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch {
    return to(request, "/settings/google?error=failed");
  }
}
