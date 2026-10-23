import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/server/db/supabase";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const origin = request.nextUrl.origin;
  if (request.headers.get("origin") !== origin) {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const supabase = await createUserClient();
    if (supabase) await supabase.auth.signOut();
  } catch {
    // fall through to login regardless
  }
  const res = NextResponse.redirect(new URL("/login", origin), 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
