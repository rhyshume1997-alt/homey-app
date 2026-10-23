import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

// Own fixture ids: independent of foundation.test.ts (which uses its own households/users).
const H3 = "33333333-3333-4333-8333-333333333333";
const H4 = "44444444-4444-4444-8444-444444444444";
const P = "a1a1a1a1-0000-4000-8000-0000000000a1"; // member of H3
const Q = "a2a2a2a2-0000-4000-8000-0000000000a2"; // member of H3
const R = "a3a3a3a3-0000-4000-8000-0000000000a3"; // member of H4

const tid = (n: number) => `7a5c0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sid = (n: number) => `5a9c0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T3 = tid(1); // fixture task in H3
const T4 = tid(2); // fixture task in H4
const S3 = sid(1);
const S4 = sid(2);

const INS_TASK = "insert into public.tasks (id, household_id, title) values ($1,$2,$3)";
const INS_SNAG = "insert into public.snags (id, household_id, title) values ($1,$2,$3)";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
}, 30000);

afterAll(async () => {
  await db?.end();
});

// Fixture inserted as superuser (auth.uid() is null, so created_by/actor are null).
beforeAll(async () => {
  await db.query(`insert into public.households (id, name) values ($1,'P2-H3'),($2,'P2-H4')`, [H3, H4]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('p@phase2.example.test',$1,'owner','P'),('q@phase2.example.test',$1,'member','Q'),('r@phase2.example.test',$2,'owner','R')`,
    [H3, H4],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1,'p@phase2.example.test','{"provider":"google"}'),($2,'q@phase2.example.test','{"provider":"google"}'),($3,'r@phase2.example.test','{"provider":"google"}')`,
    [P, Q, R],
  );
  await db.query(INS_TASK, [T3, H3, "fixture task h3"]);
  await db.query(INS_TASK, [T4, H4, "fixture task h4"]);
  await db.query(INS_SNAG, [S3, H3, "fixture snag h3"]);
  await db.query(INS_SNAG, [S4, H4, "fixture snag h4"]);
});

describe("anon", () => {
  for (const t of ["tasks", "snags"]) {
    it(`cannot read or write ${t}`, async () => {
      for (const sql of [
        `select * from public.${t}`,
        `insert into public.${t} (household_id, title) values ('${H3}','x')`,
        `update public.${t} set title='x'`,
        `delete from public.${t}`,
      ]) {
        const r = await tryQuery(db, { role: "anon" }, sql);
        expect(r.error?.message).toMatch(/permission denied/);
      }
    });
  }
});

describe("member CRUD in own household", () => {
  it("sees only own-household rows", async () => {
    const t = await tryQuery(db, authed(P), "select id from public.tasks where id in ($1,$2) order by id", [T3, T4]);
    expect(t.rows).toEqual([{ id: T3 }]);
    const s = await tryQuery(db, authed(P), "select id from public.snags where id in ($1,$2) order by id", [S3, S4]);
    expect(s.rows).toEqual([{ id: S3 }]);
  });

  it("task create, update, delete", async () => {
    const id = tid(10);
    const out = await as(db, authed(P), async (c) => {
      await c.query(
        `insert into public.tasks (id, household_id, title, notes, assignee_user_id, due_date, recurrence)
         values ($1,$2,'Bins','n',$3,'2027-01-02','weekly')`,
        [id, H3, Q],
      );
      const created = (await c.query("select * from public.tasks where id=$1", [id])).rows[0];
      await c.query("update public.tasks set title='Bins 2' where id=$1", [id]);
      const updated = (await c.query("select title from public.tasks where id=$1", [id])).rows[0];
      await c.query("delete from public.tasks where id=$1", [id]);
      const gone = (await c.query("select id from public.tasks where id=$1", [id])).rows;
      return { created, updated, gone };
    });
    expect(out.created).toMatchObject({
      household_id: H3,
      title: "Bins",
      assignee_user_id: Q,
      recurrence: "weekly",
      status: "open",
      completed_at: null,
      completed_by: null,
      created_by: P,
    });
    expect(out.updated).toEqual({ title: "Bins 2" });
    expect(out.gone).toEqual([]);
  });

  it("snag create, update, delete", async () => {
    const id = sid(10);
    const out = await as(db, authed(Q), async (c) => {
      await c.query(INS_SNAG, [id, H3, "Cracked tile"]);
      const created = (await c.query("select * from public.snags where id=$1", [id])).rows[0];
      await c.query("update public.snags set priority='high', location='Hall' where id=$1", [id]);
      const updated = (await c.query("select priority, location from public.snags where id=$1", [id])).rows[0];
      await c.query("delete from public.snags where id=$1", [id]);
      const gone = (await c.query("select id from public.snags where id=$1", [id])).rows;
      return { created, updated, gone };
    });
    expect(out.created).toMatchObject({ household_id: H3, status: "open", priority: "medium", fixed_at: null, created_by: Q });
    expect(out.updated).toEqual({ priority: "high", location: "Hall" });
    expect(out.gone).toEqual([]);
  });

  it("enforces check constraints", async () => {
    const bad: Array<[string, unknown[]]> = [
      ["insert into public.tasks (household_id, title) values ($1,'')", [H3]],
      ["insert into public.tasks (household_id, title) values ($1,$2)", [H3, "x".repeat(201)]],
      ["insert into public.tasks (household_id, title, notes) values ($1,'t',$2)", [H3, "x".repeat(2001)]],
      ["insert into public.tasks (household_id, title, status) values ($1,'t','nope')", [H3]],
      ["insert into public.tasks (household_id, title, recurrence) values ($1,'t','hourly')", [H3]],
      ["insert into public.snags (household_id, title, status) values ($1,'t','done')", [H3]],
      ["insert into public.snags (household_id, title, priority) values ($1,'t','urgent')", [H3]],
      ["insert into public.snags (household_id, title, location) values ($1,'t',$2)", [H3, "x".repeat(101)]],
    ];
    for (const [sql, params] of bad) {
      const r = await tryQuery(db, authed(P), sql, params);
      expect(r.error?.message, sql).toMatch(/violates check constraint/);
    }
  });
});

describe("household isolation", () => {
  it("other household sees nothing", async () => {
    const t = await tryQuery(db, authed(R), "select id from public.tasks where household_id=$1", [H3]);
    expect(t.error).toBeNull();
    expect(t.rows).toEqual([]);
    const s = await tryQuery(db, authed(R), "select id from public.snags where household_id=$1", [H3]);
    expect(s.rows).toEqual([]);
  });

  it("other household cannot update or delete", async () => {
    const out = await as(db, authed(R), async (c) => {
      await c.query("update public.tasks set title='hacked' where id=$1", [T3]);
      await c.query("delete from public.tasks where id=$1", [T3]);
      await c.query("update public.snags set title='hacked' where id=$1", [S3]);
      await c.query("delete from public.snags where id=$1", [S3]);
      await c.query("reset role");
      const t = (await c.query("select title from public.tasks where id=$1", [T3])).rows;
      const s = (await c.query("select title from public.snags where id=$1", [S3])).rows;
      return { t, s };
    });
    expect(out.t).toEqual([{ title: "fixture task h3" }]);
    expect(out.s).toEqual([{ title: "fixture snag h3" }]);
  });

  it("cannot insert into another household", async () => {
    const t = await tryQuery(db, authed(R), INS_TASK, [tid(20), H3, "x"]);
    expect(t.error?.message).toMatch(/row-level security/);
    const s = await tryQuery(db, authed(R), INS_SNAG, [sid(20), H3, "x"]);
    expect(s.error?.message).toMatch(/row-level security/);
  });

  it("cannot move a row into another household", async () => {
    const t = await tryQuery(db, authed(P), "update public.tasks set household_id=$2 where id=$1", [T3, H4]);
    expect(t.error?.message).toMatch(/immutable|row-level security/);
    const s = await tryQuery(db, authed(P), "update public.snags set household_id=$2 where id=$1", [S3, H4]);
    expect(s.error?.message).toMatch(/immutable|row-level security/);
  });

  it("household_id is immutable even for superuser writes", async () => {
    await db.query("begin");
    try {
      await expect(db.query("update public.tasks set household_id=$2 where id=$1", [T3, H4])).rejects.toThrow(/immutable/);
    } finally {
      await db.query("rollback");
    }
  });

  it("assignee from another household is rejected", async () => {
    const ins = await tryQuery(
      db,
      authed(P),
      "insert into public.tasks (id, household_id, title, assignee_user_id) values ($1,$2,'t',$3)",
      [tid(21), H3, R],
    );
    expect(ins.error?.message).toMatch(/assignee is not a member/);
    const upd = await tryQuery(db, authed(P), "update public.tasks set assignee_user_id=$2 where id=$1", [T3, R]);
    expect(upd.error?.message).toMatch(/assignee is not a member/);
  });

  it("assignee in the same household is accepted and may be cleared", async () => {
    const out = await as(db, authed(P), async (c) => {
      await c.query("update public.tasks set assignee_user_id=$2 where id=$1", [T3, Q]);
      const a = (await c.query("select assignee_user_id from public.tasks where id=$1", [T3])).rows[0];
      await c.query("update public.tasks set assignee_user_id=null where id=$1", [T3]);
      const b = (await c.query("select assignee_user_id from public.tasks where id=$1", [T3])).rows[0];
      return { a, b };
    });
    expect(out.a).toEqual({ assignee_user_id: Q });
    expect(out.b).toEqual({ assignee_user_id: null });
  });
});

describe("server-maintained columns", () => {
  it("ignores a spoofed created_by on insert", async () => {
    const out = await as(db, authed(P), async (c) => {
      await c.query("insert into public.tasks (id, household_id, title, created_by) values ($1,$2,'t',$3)", [tid(30), H3, Q]);
      await c.query("insert into public.snags (id, household_id, title, created_by) values ($1,$2,'t',$3)", [sid(30), H3, Q]);
      const t = (await c.query("select created_by from public.tasks where id=$1", [tid(30)])).rows[0];
      const s = (await c.query("select created_by from public.snags where id=$1", [sid(30)])).rows[0];
      return { t, s };
    });
    expect(out.t).toEqual({ created_by: P });
    expect(out.s).toEqual({ created_by: P });
  });

  it("created_by cannot be changed on update", async () => {
    const out = await as(db, authed(P), async (c) => {
      await c.query("insert into public.tasks (id, household_id, title) values ($1,$2,'t')", [tid(31), H3]);
      await c.query("update public.tasks set created_by=$2, title='t2' where id=$1", [tid(31), Q]);
      return (await c.query("select created_by, title from public.tasks where id=$1", [tid(31)])).rows[0];
    });
    expect(out).toEqual({ created_by: P, title: "t2" });
  });

  it("task completion sets and clears completed_at/by", async () => {
    const id = tid(32);
    const out = await as(db, authed(P), async (c) => {
      await c.query(INS_TASK, [id, H3, "chore"]);
      const open = (await c.query("select completed_at is null as n, completed_by from public.tasks where id=$1", [id])).rows[0];
      await c.query("update public.tasks set status='done' where id=$1", [id]);
      const done = (await c.query("select completed_at is not null as n, completed_by from public.tasks where id=$1", [id])).rows[0];
      await c.query("update public.tasks set status='open' where id=$1", [id]);
      const reopened = (await c.query("select completed_at is null as n, completed_by from public.tasks where id=$1", [id])).rows[0];
      return { open, done, reopened };
    });
    expect(out.open).toEqual({ n: true, completed_by: null });
    expect(out.done).toEqual({ n: true, completed_by: P });
    expect(out.reopened).toEqual({ n: true, completed_by: null });
  });

  it("completed_at/by cannot be set by hand while status is unchanged", async () => {
    const id = tid(33);
    const out = await as(db, authed(P), async (c) => {
      await c.query(INS_TASK, [id, H3, "chore"]);
      await c.query("update public.tasks set completed_by=$2, completed_at=now() where id=$1", [id, Q]);
      return (await c.query("select completed_at, completed_by from public.tasks where id=$1", [id])).rows[0];
    });
    expect(out).toEqual({ completed_at: null, completed_by: null });
  });

  it("completed_by records the user who completed it", async () => {
    const id = tid(34);
    const out = await as(db, authed(P), async (c) => {
      await c.query(INS_TASK, [id, H3, "chore"]);
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: Q, role: "authenticated" })]);
      await c.query("update public.tasks set status='done' where id=$1", [id]);
      return (await c.query("select completed_by from public.tasks where id=$1", [id])).rows[0];
    });
    expect(out).toEqual({ completed_by: Q });
  });

  it("snag fixed_at follows status", async () => {
    const id = sid(32);
    const out = await as(db, authed(P), async (c) => {
      await c.query(INS_SNAG, [id, H3, "snag"]);
      const q = "select fixed_at is not null as f, status from public.snags where id=$1";
      await c.query("update public.snags set status='in_progress' where id=$1", [id]);
      const progress = (await c.query(q, [id])).rows[0];
      await c.query("update public.snags set status='fixed' where id=$1", [id]);
      const fixed = (await c.query(q, [id])).rows[0];
      await c.query("update public.snags set fixed_at=null, title='again' where id=$1", [id]);
      const hand = (await c.query(q, [id])).rows[0];
      await c.query("update public.snags set status='reported' where id=$1", [id]);
      const reopened = (await c.query(q, [id])).rows[0];
      return { progress, fixed, hand, reopened };
    });
    expect(out.progress).toEqual({ f: false, status: "in_progress" });
    expect(out.fixed).toEqual({ f: true, status: "fixed" });
    expect(out.hand).toEqual({ f: true, status: "fixed" });
    expect(out.reopened).toEqual({ f: false, status: "reported" });
  });

  it("updated_at moves forward on update", async () => {
    const id = tid(35);
    const out = await as(db, authed(P), async (c) => {
      await c.query(INS_TASK, [id, H3, "chore"]);
      await c.query("update public.tasks set updated_at='2000-01-01', created_at='2000-01-01' where id=$1", [id]);
      return (await c.query("select updated_at > '2020-01-01' as u, created_at > '2020-01-01' as c from public.tasks where id=$1", [id])).rows[0];
    });
    expect(out).toEqual({ u: true, c: true });
  });
});

describe("audit", () => {
  const audit = (c: Db, id: string) =>
    c.query(
      "select action, actor_user_id, household_id, entity_type, summary, (before is null) as nb, (after is null) as na from public.audit_log where entity_id=$1 order by id",
      [id],
    );

  it("writes each task action with the right actor", async () => {
    const id = tid(40);
    const rows = await as(db, authed(P), async (c) => {
      await c.query(INS_TASK, [id, H3, "Audited"]);
      await c.query("update public.tasks set title='Audited 2' where id=$1", [id]);
      await c.query("update public.tasks set status='done' where id=$1", [id]);
      await c.query("update public.tasks set status='open' where id=$1", [id]);
      await c.query("delete from public.tasks where id=$1", [id]);
      return (await audit(c, id)).rows;
    });
    expect(rows.map((r) => r.action)).toEqual(["task.created", "task.updated", "task.completed", "task.reopened", "task.deleted"]);
    for (const r of rows) expect(r).toMatchObject({ actor_user_id: P, household_id: H3, entity_type: "task" });
    expect(rows[0]).toMatchObject({ summary: "Audited", nb: true, na: false });
    expect(rows[1]).toMatchObject({ summary: "Audited 2", nb: false, na: false });
    expect(rows[4]).toMatchObject({ nb: false, na: true });
  });

  it("writes each snag action with the right actor", async () => {
    const id = sid(40);
    const rows = await as(db, authed(Q), async (c) => {
      await c.query(INS_SNAG, [id, H3, "Snag audited"]);
      await c.query("update public.snags set priority='low' where id=$1", [id]);
      await c.query("update public.snags set status='fixed' where id=$1", [id]);
      await c.query("update public.snags set notes='after fix' where id=$1", [id]);
      await c.query("delete from public.snags where id=$1", [id]);
      return (await audit(c, id)).rows;
    });
    expect(rows.map((r) => r.action)).toEqual(["snag.created", "snag.updated", "snag.fixed", "snag.updated", "snag.deleted"]);
    for (const r of rows) expect(r).toMatchObject({ actor_user_id: Q, household_id: H3, entity_type: "snag" });
    expect(rows[0]).toMatchObject({ nb: true, na: false });
    expect(rows[4]).toMatchObject({ nb: false, na: true });
  });

  it("audit rows are visible only to the owning household", async () => {
    const own = await tryQuery(db, authed(P), "select action from public.audit_log where entity_id in ($1,$2) order by entity_id", [T3, T4]);
    expect(own.rows).toEqual([{ action: "task.created" }]);
    const other = await tryQuery(db, authed(R), "select action from public.audit_log where entity_id in ($1,$2,$3)", [T3, S3, T4]);
    expect(other.rows).toEqual([{ action: "task.created" }]);
    const otherHousehold = await tryQuery(db, authed(R), "select 1 from public.audit_log where household_id=$1", [H3]);
    expect(otherHousehold.rows).toEqual([]);
  });

  it("members cannot write audit rows directly", async () => {
    const r = await tryQuery(db, authed(P), "insert into public.audit_log (household_id, action, entity_type) values ($1,'task.created','task')", [H3]);
    expect(r.error?.message).toMatch(/permission denied/);
  });
});

describe("privileges and catalog", () => {
  it("authenticated cannot truncate or execute the trigger functions", async () => {
    const r = await tryQuery(db, authed(P), "truncate public.tasks");
    expect(r.error?.message).toMatch(/permission denied/);
    const f = await db.query(`select
      has_function_privilege('authenticated','private.audit_task()','execute') as a,
      has_function_privilege('authenticated','private.audit_snag()','execute') as b,
      has_function_privilege('authenticated','private.guard_task()','execute') as c,
      has_function_privilege('authenticated','private.guard_snag()','execute') as d,
      has_function_privilege('authenticated','private.guard_owned_row()','execute') as e,
      has_function_privilege('anon','private.audit_task()','execute') as f`);
    expect(f.rows[0]).toEqual({ a: false, b: false, c: false, d: false, e: false, f: false });
  });

  it("tasks and snags have RLS enabled and forced, and policies only for authenticated", async () => {
    const r = await db.query(`select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
      where c.oid in ('public.tasks'::regclass,'public.snags'::regclass) order by 1`);
    expect(r.rows).toEqual([
      { relname: "snags", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "tasks", relrowsecurity: true, relforcerowsecurity: true },
    ]);
    const p = await db.query(`select tablename, policyname, roles::text as roles from pg_policies
      where schemaname='public' and tablename in ('tasks','snags') and roles::text <> '{authenticated}'`);
    expect(p.rows).toEqual([]);
  });
});
