import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { type Db, connectionString } from "./helpers";

export type Who = { sub: string; email: string };
export type Res = { error: Error | null; rows: Record<string, unknown>[] };

export async function mkUser(db: Db, label: string, _opts: { creator?: boolean } = {}): Promise<Who> {
  const sub = randomUUID();
  const email = `${label}-${sub.slice(0, 8)}@mh.example.test`;
  await db.query(
    "insert into auth.users (id, email, raw_app_meta_data) values ($1,$2,'{\"provider\":\"google\"}')",
    [sub, email],
  );
  return { sub, email };
}

async function begin(c: Db, who: Who) {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: who.sub, email: who.email, role: "authenticated" }),
  ]);
}

/** Runs one statement as an authenticated user with an email claim. commit=true persists the effect. */
export async function run(db: Db, who: Who, sql: string, params: unknown[] = [], commit = false): Promise<Res> {
  await begin(db, who);
  try {
    const r = await db.query(sql, params);
    await db.query(commit ? "commit" : "rollback");
    return { error: null, rows: r.rows as Record<string, unknown>[] };
  } catch (e) {
    await db.query("rollback");
    return { error: e as Error, rows: [] };
  }
}

export async function runOk(db: Db, who: Who, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const r = await run(db, who, sql, params, true);
  if (r.error) throw r.error;
  return r.rows;
}

export async function createHousehold(db: Db, who: Who, name = "Test house"): Promise<string> {
  const rows = await runOk(db, who, "select public.create_household($1,'Owner') as id", [name]);
  return rows[0].id as string;
}

export async function invite(db: Db, owner: Who, hh: string, email: string): Promise<string> {
  const rows = await runOk(db, owner, "select public.create_invite($1,$2) as t", [hh, email]);
  return rows[0].t as string;
}

export async function accept(db: Db, who: Who, token: string, name = "Joiner"): Promise<Res> {
  return run(db, who, "select public.accept_invite($1,$2) as id", [token, name], true);
}

/** A second independent connection, for real concurrency tests. */
export async function extraClient(): Promise<Client> {
  const c = new Client({ connectionString: connectionString() });
  await c.connect();
  return c;
}

export async function openTx(c: Client, who: Who) {
  await begin(c, who);
}
