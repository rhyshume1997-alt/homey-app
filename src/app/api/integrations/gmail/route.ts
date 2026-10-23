import { createAnonClient } from "@/server/integrations/anon-client";

export const dynamic = "force-dynamic";

const MAX_BYTES = 64 * 1024;
const HEADERS = { "Cache-Control": "no-store" } as const;

const reply = (status: number, error?: string) =>
  error
    ? Response.json({ error }, { status, headers: HEADERS })
    : new Response(null, { status, headers: HEADERS });

/**
 * Signed metadata ingest from a member's Gmail Apps Script. Auth is the HMAC checked inside
 * the database (ingest_email_threads); this handler only bounds the request. Nothing from
 * the request is ever echoed back.
 */
export async function POST(req: Request) {
  const ts = req.headers.get("x-ourhome-timestamp") ?? "";
  const sig = req.headers.get("x-ourhome-signature") ?? "";
  if (!/^\d{9,12}$/.test(ts) || !/^[0-9a-fA-F]{64}$/.test(sig)) return reply(401, "Unauthorised.");

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return reply(400, "Invalid request.");
  const body = await req.text();
  if (new TextEncoder().encode(body).length > MAX_BYTES) return reply(400, "Invalid request.");

  const db = createAnonClient();
  if (!db) return reply(503, "Unavailable.");
  const { error } = await db.rpc("ingest_email_threads", { p_ts: Number(ts), p_body: body, p_sig: sig });
  if (!error) return reply(204);
  if (error.code === "42501") return reply(401, "Unauthorised.");
  if (error.code === "22023") return reply(400, "Invalid request.");
  return reply(503, "Unavailable.");
}
