import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/auth/session";
import { sanitizeNext } from "@/server/auth/next-param";
import { createUserClient } from "@/server/db/supabase";

export const dynamic = "force-dynamic";

function to(request: NextRequest, path: string) {
  const res = NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Never echoes provider errors: every failure maps to a fixed code. */
export async function GET(request: NextRequest) {
  const supabase = await createUserClient();
  if (!supabase) return to(request, "/login?error=unavailable");

  const code = request.nextUrl.searchParams.get("code");
  try {
    if (!code || request.nextUrl.searchParams.has("error")) throw new Error("denied");
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw new Error("denied");
    const session = await getSession();
    if (!session) throw new Error("denied");
  } catch {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // best effort
    }
    return to(request, "/login?error=denied");
  }

  return to(request, sanitizeNext(request.nextUrl.searchParams.get("next")) ?? "/");
}
