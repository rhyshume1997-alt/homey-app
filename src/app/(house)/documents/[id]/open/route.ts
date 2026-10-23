import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/session";
import { createDocumentUrl, parseDocumentId } from "@/server/data/documents";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Opens a document: authorise, re-check the row under RLS, then 303 to a 60 second signed URL. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const id = parseDocumentId((await ctx.params).id);
  if (!id) return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  const url = await createDocumentUrl(s, id);
  if (!url) return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  return new NextResponse(null, { status: 303, headers: { ...NO_STORE, Location: url } });
}
