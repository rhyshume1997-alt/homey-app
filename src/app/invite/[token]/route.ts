import { NextResponse, type NextRequest } from "next/server";
import { getAuthOnly } from "@/server/auth/session";
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE_S, cookieOptions, isInviteToken } from "@/server/auth/household-cookie";

export const dynamic = "force-dynamic";

/**
 * Invite links land here. Nothing about the household is revealed. The token moves into a
 * 15 minute httpOnly cookie and the browser is redirected, so it leaves the URL and history.
 * Signed in: on to /onboarding, which shows the join form. Signed out: on to /login.
 * (Sign-in itself is enforced by the proxy; this re-checks and never trusts the path.)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const go = (path: string) => {
    const res = NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  };
  if (!isInviteToken(token)) return go("/onboarding?invite=invalid");
  const signedIn = Boolean(await getAuthOnly());
  const res = go(signedIn ? "/onboarding" : "/login");
  res.cookies.set(INVITE_COOKIE, token, cookieOptions(INVITE_COOKIE_MAX_AGE_S));
  return res;
}
