import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, authed, tryQuery } from "./helpers";

const HA = "a3a30000-0000-4000-8000-00000000000a";
const HB = "a3a30000-0000-4000-8000-00000000000b";
const UA1 = "a3a30000-0000-4000-8000-0000000000a1";
const UA2 = "a3a30000-0000-4000-8000-0000000000a2";
const UB = "a3a30000-0000-4000-8000-0000000000b1";

let db: Db;
beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'G-A'),($2,'G-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
     ('a1@google-connect.example.test',$1,'owner','A1'),('a2@google-connect.example.test',$1,'member','A2'),('b1@google-connect.example.test',$2,'owner','B1')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values
     ($1,'a1@google-connect.example.test','{"provider":"google"}'),($2,'a2@google-connect.example.test','{"provider":"google"}'),
     ($3,'b1@google-connect.example.test','{"provider":"google"}')`,
    [UA1, UA2, UB],
  );
}, 30000);
afterAll(async () => db?.end());

const SC = "https://www.googleapis.com/auth/spreadsheets.readonly";

async function asUser(sub: string) {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: "authenticated" })]);
}

/** Seeds one token per user as admin inside a tx; fn runs inside it; always rolled back. */
async function withTokens<T>(sub: string, fn: (c: Db) => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query(
      `insert into private.google_tokens (user_id, household_id, ciphertext, scopes) values
       ($1,$4,'v1:aaa:bbb:ccc',$5),($2,$4,'v1:ddd:eee:fff',$5),($3,$6,'v1:ggg:hhh:iii',$5)`,
      [UA1, UA2, UB, HA, SC, HB],
    );
    await asUser(sub);
    return await fn(db);
  } finally {
    await db.query("rollback");
  }
}

describe("google token functions", () => {
  it("each user sees only their own token and status", async () => {
    await withTokens(UA1, async (c) => {
      expect((await c.query("select * from public.get_my_google_token()")).rows).toEqual([{ ciphertext: "v1:aaa:bbb:ccc", scopes: SC }]);
      expect((await c.query("select connected, scopes from public.google_connection_status()")).rows).toEqual([{ connected: true, scopes: SC }]);
    });
    await withTokens(UB, async (c) => {
      expect((await c.query("select ciphertext from public.get_my_google_token()")).rows).toEqual([{ ciphertext: "v1:ggg:hhh:iii" }]);
    });
  });

  it("returns nothing when not connected", async () => {
    await db.query("begin");
    try {
      await asUser(UA2);
      expect((await db.query("select * from public.get_my_google_token()")).rows).toEqual([]);
      expect((await db.query("select * from public.google_connection_status()")).rows).toEqual([]);
    } finally {
      await db.query("rollback");
    }
  });

  it("anon and direct table access are closed", async () => {
    for (const sql of [
      "select * from public.get_my_google_token()",
      "select * from public.google_connection_status()",
      "select public.delete_my_google_token()",
      "select public.store_my_google_token('a3a30000-0000-4000-8000-00000000000a','v1:x','s')",
    ]) {
      expect((await tryQuery(db, { role: "anon" }, sql)).error?.message, sql).toMatch(/permission denied/);
    }
    expect((await tryQuery(db, authed(UA1), "select * from private.google_tokens")).error?.message).toMatch(/permission denied/);
  });

  it("store upserts for the caller only and audits without the token", async () => {
    await db.query("begin");
    try {
      await asUser(UA1);
      await db.query("select public.store_my_google_token('a3a30000-0000-4000-8000-00000000000a','v1:one:two:three', $1)", [SC]);
      await db.query("select public.store_my_google_token('a3a30000-0000-4000-8000-00000000000a','v1:four:five:six', $1)", [SC]);
      expect((await db.query("select ciphertext from public.get_my_google_token()")).rows).toEqual([{ ciphertext: "v1:four:five:six" }]);
      await db.query("reset role");
      expect((await db.query("select user_id, household_id from private.google_tokens")).rows).toEqual([{ user_id: UA1, household_id: HA }]);
      const a = await db.query("select summary from public.audit_log where action='google.connected' and household_id=$1", [HA]);
      expect(a.rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(a.rows)).not.toContain("four");
    } finally {
      await db.query("rollback");
    }
  });

  it("store rejects non-members, bad format and oversize values", async () => {
    const nm = await tryQuery(db, authed("a3a30000-0000-4000-8000-0000000000ff"), "select public.store_my_google_token('a3a30000-0000-4000-8000-00000000000a','v1:a:b:c','s')");
    expect(nm.error?.message).toMatch(/not a member/);
    expect((await tryQuery(db, authed(UA1), "select public.store_my_google_token('a3a30000-0000-4000-8000-00000000000a','plain-token','s')")).error?.message).toMatch(/invalid token/);
    expect((await tryQuery(db, authed(UA1), "select public.store_my_google_token('a3a30000-0000-4000-8000-00000000000a',$1,'s')", ["v1:" + "x".repeat(4000)])).error?.message).toMatch(/invalid token/);
  });

  it("delete removes only the caller's row", async () => {
    await withTokens(UA1, async (c) => {
      await c.query("select public.delete_my_google_token()");
      expect((await c.query("select * from public.get_my_google_token()")).rows).toEqual([]);
      await c.query("reset role");
      const ids = (await c.query("select user_id from private.google_tokens order by user_id")).rows.map((r) => (r as { user_id: string }).user_id);
      expect(ids).toEqual([UA2, UB]);
      expect((await c.query("select 1 from public.audit_log where action='google.disconnected' and household_id=$1", [HA])).rows).toHaveLength(1);
    });
  });
});

describe("budget_snapshots", () => {
  it("members read their household snapshot only; anon nothing", async () => {
    await db.query("begin");
    try {
      await db.query(`insert into public.budget_snapshots (household_id, data, fetched_by) values ($1,'{"x":1}'::jsonb,$2),($3,'{"x":2}'::jsonb,$4)`, [HB, UB, HA, UA1]);
      await asUser(UA2);
      expect((await db.query("select household_id from public.budget_snapshots")).rows).toEqual([{ household_id: HA }]);
      await db.query("reset role");
      await db.query("set local role anon");
      await expect(db.query("select * from public.budget_snapshots")).rejects.toThrow(/permission denied/);
    } finally {
      await db.query("rollback");
    }
  });

  it("insert and update work for own household; fetched_by forced to the caller; audit has no figures", async () => {
    await db.query("begin");
    try {
      await asUser(UA1);
      await db.query(`insert into public.budget_snapshots (household_id, data, fetched_by) values ($1,'{"bills":[1]}'::jsonb,$2)`, [HA, UB]);
      expect((await db.query("select fetched_by from public.budget_snapshots")).rows).toEqual([{ fetched_by: UA1 }]);
      await db.query("reset role");
      await asUser(UA2);
      await db.query(`update public.budget_snapshots set data='{"y":1}'::jsonb, fetched_by=$1 where household_id=$2`, [UB, HA]);
      expect((await db.query("select fetched_by, data from public.budget_snapshots")).rows).toEqual([{ fetched_by: UA2, data: { y: 1 } }]);
      await db.query("reset role");
      const a = await db.query("select summary from public.audit_log where action='budget.snapshot_saved' and household_id=$1", [HA]);
      expect(a.rows).toHaveLength(2);
      expect(JSON.stringify(a.rows)).not.toContain("bills");
    } finally {
      await db.query("rollback");
    }
  });

  it("cannot write another household, delete, or store oversize/non-object data", async () => {
    const other = await tryQuery(db, authed(UA1), `insert into public.budget_snapshots (household_id, data) values ('${HB}','{}'::jsonb)`);
    expect(other.error?.message).toMatch(/row-level security/);
    expect((await tryQuery(db, authed(UA1), "delete from public.budget_snapshots")).error?.message).toMatch(/permission denied/);
    expect((await tryQuery(db, { role: "anon" }, `insert into public.budget_snapshots (household_id, data) values ('${HA}','{}'::jsonb)`)).error?.message).toMatch(/permission denied/);
    expect((await tryQuery(db, authed(UA1), `insert into public.budget_snapshots (household_id, data) values ('${HA}','[]'::jsonb)`)).error?.message).toMatch(/check constraint/);
    const big = await tryQuery(db, authed(UA1), `insert into public.budget_snapshots (household_id, data) values ('${HA}', (select jsonb_object_agg(g::text, md5(g::text)) from generate_series(1, 4000) g))`);
    expect(big.error?.message).toMatch(/check constraint/);
  });

  it("household is immutable on update", async () => {
    await db.query("begin");
    try {
      await db.query(`insert into public.budget_snapshots (household_id, data) values ($1,'{}'::jsonb)`, [HA]);
      await asUser(UA1);
      await expect(db.query(`update public.budget_snapshots set household_id=$1`, [HB])).rejects.toThrow(/row-level security|immutable/);
    } finally {
      await db.query("rollback");
    }
  });
});
