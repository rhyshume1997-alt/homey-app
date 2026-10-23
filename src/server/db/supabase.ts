import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export type SupabaseEnv = { url: string; key: string };

/** Public Supabase settings. Missing config means no one can sign in (deny by default). */
export function supabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

/**
 * Supabase client acting as the signed-in user, for server components, route
 * handlers and server actions. Every query runs under RLS as that user; there is
 * no service-role client in this app.
 */
export async function createUserClient() {
  const env = supabaseEnv();
  if (!env) return null;
  const store = await cookies();
  return createServerClient(env.url, env.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server components cannot set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}
