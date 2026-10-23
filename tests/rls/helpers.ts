import { Client } from "pg";
import { RemoteDb, type Db } from "./remote";

export type { Db };

export const H1 = "11111111-1111-4111-8111-111111111111";
export const H2 = "22222222-2222-4222-8222-222222222222";
export const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const USER_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export function connectionString(): string {
  const url = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("ADMIN_DATABASE_URL or DATABASE_URL is required (run via npm run test:rls)");
  return url;
}

/** SUPABASE_PROJECT_REF set: run against the real project via the Management API (never persists). */
export async function adminClient(): Promise<Db> {
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (ref) return new RemoteDb(ref);
  const c = new Client({ connectionString: connectionString() });
  await c.connect();
  return c;
}

export type Actor = { role: "anon" } | { role: "authenticated"; sub: string };

/** Runs fn in a transaction as the given API role/JWT, always rolled back. */
export async function as<T>(client: Db, actor: Actor, fn: (c: Db) => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await client.query(`set local role ${actor.role}`);
    const claims = actor.role === "anon" ? { role: "anon" } : { sub: actor.sub, role: "authenticated" };
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}

/** Runs a statement inside a savepoint-less tx and returns the error (or null). */
export async function tryQuery(
  client: Db,
  actor: Actor,
  sql: string,
  params: unknown[] = [],
): Promise<{ error: Error | null; rows: unknown[] }> {
  return as(client, actor, async (c) => {
    try {
      const r = await c.query(sql, params);
      return { error: null, rows: r.rows };
    } catch (e) {
      return { error: e as Error, rows: [] };
    }
  });
}

export const authed = (sub: string): Actor => ({ role: "authenticated", sub });
