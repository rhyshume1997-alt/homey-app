import "server-only";
import { createAnonClient } from "@/server/integrations/anon-client";

export const dynamic = "force-dynamic";

const MAX_BYTES = 64 * 1024;
const headers = { "Cache-Control": "no-store" };
const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { ...headers, "Content-Type": "application/json" } });

/** Signed push from the Apps Script. Verification happens in the database. */
export async function POST(request: Request): Promise<Response> {
  const len = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > MAX_BYTES) return json(413, "too_large");

  const tsHeader = request.headers.get("x-ourhome-timestamp") ?? "";
  const sig = request.headers.get("x-ourhome-signature") ?? "";
  if (!/^\d{1,12}$/.test(tsHeader) || !/^[0-9a-fA-F]{64}$/.test(sig)) return json(401, "unauthorized");

  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BYTES) return json(413, "too_large");

  const db = createAnonClient();
  if (!db) return json(503, "unavailable");

  const { error } = await db.rpc("ingest_bin_collections", { p_ts: Number(tsHeader), p_body: body, p_sig: sig.toLowerCase() });
  if (!error) return new Response(null, { status: 204, headers });
  if (error.code === "42501") return json(401, "unauthorized");
  if (error.code === "22023" || error.code === "22P02" || error.code === "22003") return json(400, "bad_request");
  return json(503, "unavailable");
}

export function GET(): Response {
  return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
}
