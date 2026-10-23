import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/server/db/supabase";

/**
 * Supabase client with no user session, for signed ingest routes only. It can do nothing
 * except call the ingest RPCs that anon is granted; those verify the request's HMAC in the
 * database (private.verify_signed). Never use it to read household data.
 */
export function createAnonClient() {
  const env = supabaseEnv();
  if (!env) return null;
  return createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });
}
