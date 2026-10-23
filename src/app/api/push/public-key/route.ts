import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/session";
import { pushConfig } from "@/server/integrations/push/send";

export const dynamic = "force-dynamic";

/** The VAPID public key for subscribing. Authenticated; 404 when push is not configured. */
export async function GET() {
  await requireSession();
  const cfg = pushConfig();
  if (!cfg) return NextResponse.json({ error: "not_configured" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ publicKey: cfg.publicKey }, { headers: { "Cache-Control": "no-store" } });
}
