import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideAccess } from "@/server/auth/access";
import { sanitizeNext } from "@/server/auth/next-param";

type CookieToSet = {
  name: string;
  value: string;
  options?: Parameters<NextResponse["cookies"]["set"]>[2];
};

const PUBLIC_NO_SUPABASE = new Set(["/login", "/auth/login", "/auth/callback"]);

/** Validates the session with Supabase Auth and collects refreshed cookies. Null when unconfigured. */
async function lookupUser(request: NextRequest, refreshed: CookieToSet[]) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const c of list) refreshed.push(c);
        },
      },
    });
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { userId: data.user.id };
  } catch {
    return null;
  }
}

function finish(res: NextResponse, refreshed: CookieToSet[]) {
  for (const { name, value, options } of refreshed) res.cookies.set(name, value, options);
  if (refreshed.length > 0) res.headers.set("Cache-Control", "no-store");
  return res;
}

// proxy.ts runs on every request: no matcher, so public/ files and /_next/*
// also pass through decideAccess. Page-level requireSession() re-checks membership.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Public paths never touch Supabase.
  if (decideAccess(pathname, null) === "allow") {
    const res = NextResponse.next();
    if (PUBLIC_NO_SUPABASE.has(pathname)) res.headers.set("Cache-Control", "no-store");
    return res;
  }

  const refreshed: CookieToSet[] = [];
  const session = await lookupUser(request, refreshed);
  const decision = decideAccess(pathname, session);

  if (decision === "allow") return finish(NextResponse.next(), refreshed);

  if (decision === "landing") {
    const url = request.nextUrl.clone();
    url.pathname = "/welcome";
    url.search = "";
    const res = NextResponse.rewrite(url);
    res.headers.set("Cache-Control", "no-store");
    return finish(res, refreshed);
  }

  if (decision === "unauthorized") {
    return finish(
      NextResponse.json(
        { error: "unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ),
      refreshed,
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const next = sanitizeNext(pathname + search);
  if (next && next !== "/") url.searchParams.set("next", next);
  const res = NextResponse.redirect(url, 307);
  res.headers.set("Cache-Control", "no-store");
  return finish(res, refreshed);
}
