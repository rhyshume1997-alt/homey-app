import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, H1, H2, USER_A, USER_B, USER_C, adminClient, as, authed, tryQuery } from "./helpers";

let db: Db;
const TABLES = ["households", "household_members", "audit_log"] as const;
const LOG = "select public.log_audit($1::uuid,'test.action','thing','t1','a summary',null,'{\"k\":1}'::jsonb) as id";

beforeAll(async () => {
  db = await adminClient();
}, 30000);

afterAll(async () => {
  await db?.end();
});

// Fixture is inserted as superuser. audit_log is append-only, so the fixture is
// created once and never removed; the test database is throwaway.
beforeAll(async () => {
  // Memberships come from the allowlist trigger on auth.users, as in production.
  await db.query(`insert into public.households (id, name) values ($1,'H1'),($2,'H2')`, [H1, H2]);
  await db.query(`insert into private.allowed_emails (email, household_id, role, display_name) values
    ('a@example.test',$1,'owner','A'),('b@example.test',$1,'member','B'),('c@example.test',$2,'owner','C')`, [H1, H2]);
  await db.query(`insert into auth.users (id, email, raw_app_meta_data) values
    ($1,'a@example.test','{"provider":"google"}'),($2,'B@Example.test','{"provider":"google"}'),($3,'c@example.test','{"provider":"google"}')`, [USER_A, USER_B, USER_C]);
  await db.query(`insert into public.audit_log (household_id, actor_user_id, action, entity_type) values
    ($1,$3,'seed','fixture'),($2,$4,'seed','fixture')`, [H1, H2, USER_A, USER_C]);
});

describe("anon", () => {
  for (const t of TABLES) {
    it(`cannot read ${t}`, async () => {
      const r = await tryQuery(db, { role: "anon" }, `select * from public.${t}`);
      expect(r.error?.message).toMatch(/permission denied/);
    });
  }
  it("cannot execute log_audit", async () => {
    const r = await tryQuery(db, { role: "anon" }, LOG, [H1]);
    expect(r.error?.message).toMatch(/permission denied/);
  });
});

describe("member A of H1", () => {
  it("sees own household only", async () => {
    const r = await tryQuery(db, authed(USER_A), "select id from public.households");
    expect(r.rows).toEqual([{ id: H1 }]);
  });
  it("sees both H1 members only", async () => {
    const r = await tryQuery(db, authed(USER_A), "select user_id from public.household_members order by display_name");
    expect(r.rows).toEqual([{ user_id: USER_A }, { user_id: USER_B }]);
  });
  it("sees H1 audit rows only", async () => {
    const r = await tryQuery(db, authed(USER_A), "select distinct household_id from public.audit_log");
    expect(r.rows).toEqual([{ household_id: H1 }]);
  });
});

describe("member C of H2", () => {
  it("sees nothing from H1", async () => {
    for (const t of TABLES) {
      const r = await tryQuery(db, authed(USER_C), `select * from public.${t} where ${t === "households" ? "id" : "household_id"} = $1`, [H1]);
      expect(r.error).toBeNull();
      expect(r.rows).toHaveLength(0);
    }
  });
  it("sees own household", async () => {
    const r = await tryQuery(db, authed(USER_C), "select id from public.households");
    expect(r.rows).toEqual([{ id: H2 }]);
  });
});

describe("direct writes by authenticated", () => {
  const writes: Array<[string, string, unknown[]]> = [
    ["insert households", "insert into public.households (name) values ('x')", []],
    ["update households", "update public.households set name='x'", []],
    ["delete households", "delete from public.households", []],
    ["insert household_members", "insert into public.household_members (household_id,user_id,role,display_name) values ($1,$2,'member','x')", [H1, USER_C]],
    ["update household_members", "update public.household_members set role='owner'", []],
    ["delete household_members", "delete from public.household_members", []],
    ["insert audit_log", "insert into public.audit_log (household_id,action,entity_type) values ($1,'x','y')", [H1]],
    ["update audit_log", "update public.audit_log set summary='x'", []],
    ["delete audit_log", "delete from public.audit_log", []],
    ["truncate audit_log", "truncate public.audit_log", []],
  ];
  for (const [name, sql, params] of writes) {
    it(`${name} is denied`, async () => {
      const r = await tryQuery(db, authed(USER_A), sql, params);
      expect(r.error?.message).toMatch(/permission denied/);
    });
  }
});

describe("log_audit", () => {
  it("stores the caller as actor", async () => {
    const out = await as(db, authed(USER_A), async (c) => {
      await c.query(LOG, [H1]);
      await c.query("reset role"); // read back as superuser inside the same tx
      // Match on action, not id: the remote harness replays the call, which advances the sequence.
      return (await c.query("select actor_user_id, household_id, action from public.audit_log where action='test.action'")).rows[0];
    });
    expect(out).toEqual({ actor_user_id: USER_A, household_id: H1, action: "test.action" });
  });
  it("rejects a household the caller is not in", async () => {
    const r = await tryQuery(db, authed(USER_A), LOG, [H2]);
    expect(r.error?.message).toMatch(/not a member/);
  });
  it("rejects missing user", async () => {
    const r = await tryQuery(db, { role: "authenticated", sub: "" }, LOG, [H1]);
    expect(r.error).not.toBeNull();
  });
  it("rejects overlong summary, action and entity_type", async () => {
    const q = "select public.log_audit($1::uuid,$2,$3,null,$4,null,null)";
    const long = (n: number) => "x".repeat(n);
    expect((await tryQuery(db, authed(USER_A), q, [H1, "a", "b", long(501)])).error?.message).toMatch(/summary too long/);
    expect((await tryQuery(db, authed(USER_A), q, [H1, long(65), "b", "s"])).error?.message).toMatch(/invalid action/);
    expect((await tryQuery(db, authed(USER_A), q, [H1, "a", long(65), "s"])).error?.message).toMatch(/invalid entity_type/);
    expect((await tryQuery(db, authed(USER_A), q, [H1, "a", "b", long(500)])).error).toBeNull();
  });
  it("rejects oversized before/after payloads", async () => {
    const q = "select public.log_audit($1::uuid,'a','b',null,null,$2::jsonb,null)";
    const big = JSON.stringify({ blob: "x".repeat(40000) });
    expect((await tryQuery(db, authed(USER_A), q, [H1, big])).error?.message).toMatch(/too large/);
  });
});

describe("audit_log is append-only", () => {
  it("blocks UPDATE even as superuser", async () => {
    await expect(db.query("update public.audit_log set summary='x'")).rejects.toThrow(/append-only/);
  });
  it("blocks DELETE even as superuser", async () => {
    await expect(db.query("delete from public.audit_log")).rejects.toThrow(/append-only/);
  });
  it("blocks TRUNCATE even as superuser", async () => {
    await expect(db.query("truncate public.audit_log")).rejects.toThrow(/append-only/);
  });
  it("blocks UPDATE/DELETE as service_role", async () => {
    await db.query("begin");
    try {
      await db.query("set local role service_role");
      await expect(db.query("update public.audit_log set summary='x'")).rejects.toThrow(/append-only/);
    } finally {
      await db.query("rollback");
    }
  });
});

describe("allowlist", () => {
  it("lets a Google user who is not on the allowlist sign up, but gives them no household (open creation, D19)", async () => {
    await db.query("begin");
    try {
      const r = await db.query(
        `insert into auth.users (id, email, raw_app_meta_data) values (gen_random_uuid(), 'stranger@example.test', '{"provider":"google"}') returning id`,
      );
      const m = await db.query("select 1 from public.household_members where user_id = $1", [r.rows[0].id]);
      expect(m.rows.length).toBe(0);
    } finally {
      await db.query("rollback");
    }
  });
  it("rejects an allowlisted email created by any provider other than Google", async () => {
    for (const provider of ["email", "phone", ""]) {
      await db.query("begin");
      try {
        await expect(
          db.query(
            `insert into auth.users (id, email, raw_app_meta_data) values (gen_random_uuid(), 'a2@example.test', $1::jsonb)`,
            [JSON.stringify(provider ? { provider } : {})],
          ),
        ).rejects.toThrow(/only Google sign-in/);
      } finally {
        await db.query("rollback");
      }
    }
  });
  it("gave allowed users their household membership (email matched case-insensitively)", async () => {
    const r = await db.query("select user_id, role from public.household_members where household_id=$1 order by display_name", [H1]);
    expect(r.rows).toEqual([{ user_id: USER_A, role: "owner" }, { user_id: USER_B, role: "member" }]);
  });
  it("blocks changing an email to one that is not allowed", async () => {
    await db.query("begin");
    try {
      await expect(db.query("update auth.users set email='stranger@example.test' where id=$1", [USER_A])).rejects.toThrow(
        /email not allowed/,
      );
    } finally {
      await db.query("rollback");
    }
  });
  it("is not readable by API roles", async () => {
    for (const actor of [{ role: "anon" } as const, authed(USER_A)]) {
      const r = await tryQuery(db, actor, "select * from private.allowed_emails");
      expect(r.error?.message).toMatch(/permission denied/);
    }
  });
});

describe("catalog guards", () => {
  it("every public table has RLS enabled and forced", async () => {
    const r = await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') and not (c.relrowsecurity and c.relforcerowsecurity)`);
    expect(r.rows).toEqual([]);
  });
  it("anon has no table privileges in public", async () => {
    const r = await db.query(`select table_name, privilege_type from information_schema.role_table_grants
      where table_schema='public' and grantee='anon'`);
    expect(r.rows).toEqual([]);
  });
  it("authenticated never has TRUNCATE, REFERENCES or TRIGGER on public tables", async () => {
    const r = await db.query(`select table_name, privilege_type from information_schema.role_table_grants
      where table_schema='public' and grantee='authenticated' and privilege_type not in ('SELECT','INSERT','UPDATE','DELETE')`);
    expect(r.rows).toEqual([]);
  });
  it("every write privilege granted to authenticated is covered by an RLS policy for that command", async () => {
    const r = await db.query(`select g.table_name, g.privilege_type from information_schema.role_table_grants g
      where g.table_schema='public' and g.grantee='authenticated' and g.privilege_type in ('INSERT','UPDATE','DELETE')
      and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=g.table_name
        and p.permissive='PERMISSIVE' and (p.cmd = g.privilege_type or p.cmd = 'ALL')
        and ('authenticated' = any(p.roles) or 'public' = any(p.roles)))`);
    expect(r.rows).toEqual([]);
  });
  it("audit_log and households stay read-only for authenticated", async () => {
    const r = await db.query(`select table_name, privilege_type from information_schema.role_table_grants
      where table_schema='public' and grantee='authenticated' and privilege_type <> 'SELECT'
      and table_name in ('audit_log','households','household_members')`);
    expect(r.rows).toEqual([]);
  });
  it("every public table except households has household_id", async () => {
    const r = await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') and c.relname <> 'households'
      and not exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='household_id' and not a.attisdropped)`);
    expect(r.rows).toEqual([]);
  });
  it("every SECURITY DEFINER function in public/private has a fixed search_path", async () => {
    const r = await db.query(`select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.prosecdef
      and not coalesce(p.proconfig::text[] && array['search_path=""'] or exists (select 1 from unnest(p.proconfig) s where s like 'search_path=%'), false)`);
    expect(r.rows).toEqual([]);
  });
  it("anon cannot use schema private", async () => {
    const r = await db.query("select has_schema_privilege('anon','private','usage') as u");
    expect(r.rows[0].u).toBe(false);
  });
});
