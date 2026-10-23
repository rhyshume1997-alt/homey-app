import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const H5 = "77777777-7777-4777-8777-777777777777";
const H6 = "88888888-8888-4888-8888-888888888888";
const U = "c1c1c1c1-0000-4000-8000-0000000000c1"; // H5
const V = "c2c2c2c2-0000-4000-8000-0000000000c2"; // H5
const W = "c3c3c3c3-0000-4000-8000-0000000000c3"; // H6

const rid = (n: number) => `4ec10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const R5 = rid(1);
const R6 = rid(2);
const INS = "insert into public.household_records (id, household_id, category, title) values ($1,$2,'gas',$3)";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
}, 30000);

afterAll(async () => {
  await db?.end();
});

beforeAll(async () => {
  await db.query(`insert into public.households (id, name) values ($1,'REC-H5'),($2,'REC-H6')`, [H5, H6]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u@records.example.test',$1,'owner','U'),('v@records.example.test',$1,'member','V'),('w@records.example.test',$2,'owner','W')`,
    [H5, H6],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1,'u@records.example.test','{"provider":"google"}'),($2,'v@records.example.test','{"provider":"google"}'),($3,'w@records.example.test','{"provider":"google"}')`,
    [U, V, W],
  );
  await db.query(INS, [R5, H5, "fixture h5"]);
  await db.query(INS, [R6, H6, "fixture h6"]);
});

describe("anon", () => {
  it("cannot read or write household_records", async () => {
    for (const sql of [
      "select * from public.household_records",
      `insert into public.household_records (household_id, category, title) values ('${H5}','gas','x')`,
      "update public.household_records set title='x'",
      "delete from public.household_records",
    ]) {
      const r = await tryQuery(db, { role: "anon" }, sql);
      expect(r.error?.message).toMatch(/permission denied/);
    }
  });
});

describe("member CRUD", () => {
  it("creates, updates and deletes in own household", async () => {
    const id = rid(10);
    const out = await as(db, authed(U), async (c) => {
      await c.query(
        `insert into public.household_records (id, household_id, category, title, amount, unit, amount_kind, renewal_date, reference_last4)
         values ($1,$2,'electricity','Tariff',45.5,'GBP','budget','2027-03-01','1234')`,
        [id, H5],
      );
      const created = (await c.query("select * from public.household_records where id=$1", [id])).rows[0];
      await c.query("update public.household_records set status='checked' where id=$1", [id]);
      const updated = (await c.query("select status from public.household_records where id=$1", [id])).rows[0];
      await c.query("delete from public.household_records where id=$1", [id]);
      const gone = (await c.query("select id from public.household_records where id=$1", [id])).rows;
      return { created, updated, gone };
    });
    expect(out.created).toMatchObject({ household_id: H5, verified: false, created_by: U, unit: "GBP", import_key: null });
    expect(out.updated).toEqual({ status: "checked" });
    expect(out.gone).toEqual([]);
  });

  it("sees only own-household rows", async () => {
    const r = await tryQuery(db, authed(U), "select id from public.household_records where id in ($1,$2)", [R5, R6]);
    expect(r.rows).toEqual([{ id: R5 }]);
  });
});

describe("isolation", () => {
  it("other household sees nothing", async () => {
    const r = await tryQuery(db, authed(W), "select id from public.household_records where household_id=$1", [H5]);
    expect(r.error).toBeNull();
    expect(r.rows).toEqual([]);
  });

  it("other household cannot update or delete", async () => {
    const out = await as(db, authed(W), async (c) => {
      await c.query("update public.household_records set title='hacked' where id=$1", [R5]);
      await c.query("delete from public.household_records where id=$1", [R5]);
      await c.query("reset role");
      return (await c.query("select title from public.household_records where id=$1", [R5])).rows;
    });
    expect(out).toEqual([{ title: "fixture h5" }]);
  });

  it("cannot insert into another household", async () => {
    const r = await tryQuery(db, authed(W), INS, [rid(20), H5, "x"]);
    expect(r.error?.message).toMatch(/row-level security/);
  });

  it("household_id is immutable", async () => {
    const r = await tryQuery(db, authed(U), "update public.household_records set household_id=$2 where id=$1", [R5, H6]);
    expect(r.error?.message).toMatch(/immutable|row-level security/);
    await db.query("begin");
    try {
      await expect(db.query("update public.household_records set household_id=$2 where id=$1", [R5, H6])).rejects.toThrow(/immutable/);
    } finally {
      await db.query("rollback");
    }
  });
});

describe("constraints", () => {
  it("rejects bad values", async () => {
    const bad: Array<[string, unknown[]]> = [
      ["insert into public.household_records (household_id, category, title, reference_last4) values ($1,'gas','t','123')", [H5]],
      ["insert into public.household_records (household_id, category, title, reference_last4) values ($1,'gas','t','12345')", [H5]],
      ["insert into public.household_records (household_id, category, title, amount) values ($1,'gas','t',10)", [H5]],
      ["insert into public.household_records (household_id, category, title) values ($1,'nope','t')", [H5]],
      ["insert into public.household_records (household_id, category, title, amount, unit) values ($1,'gas','t',1,'USD')", [H5]],
      ["insert into public.household_records (household_id, category, title, amount_kind) values ($1,'gas','t','guess')", [H5]],
      ["insert into public.household_records (household_id, category, title) values ($1,'gas','')", [H5]],
      ["insert into public.household_records (household_id, category, title) values ($1,'gas',$2)", [H5, "x".repeat(501)]],
      ["insert into public.household_records (household_id, category, title, import_key) values ($1,'gas','t',$2)", [H5, "x".repeat(201)]],
    ];
    for (const [sql, params] of bad) {
      const r = await tryQuery(db, authed(U), sql, params);
      expect(r.error?.message, sql).toMatch(/violates check constraint/);
    }
  });

  it("accepts a kWh amount", async () => {
    const r = await tryQuery(
      db,
      authed(U),
      "insert into public.household_records (household_id, category, title, amount, unit) values ($1,'solar','t',120.25,'kWh')",
      [H5],
    );
    expect(r.error).toBeNull();
  });

  it("import_key is unique per household, nulls allowed many", async () => {
    const ins = "insert into public.household_records (id, household_id, category, title, import_key) values ($1,$2,'gas','t',$3)";
    const dup = await as(db, authed(U), async (c) => {
      await c.query(ins, [rid(30), H5, "k1"]);
      try {
        await c.query(ins, [rid(31), H5, "k1"]);
        return null;
      } catch (e) {
        return e as Error;
      }
    });
    expect(dup?.message).toMatch(/duplicate key|unique/);
    const ok = await as(db, authed(U), async (c) => {
      await c.query(ins, [rid(32), H5, "k2"]);
      await c.query(ins, [rid(33), H5, null]);
      await c.query(ins, [rid(34), H5, null]);
      return true;
    });
    expect(ok).toBe(true);
    const other = await as(db, authed(W), async (c) => {
      await c.query(ins, [rid(35), H6, "k2"]);
      return true;
    });
    expect(other).toBe(true);
  });
});

describe("server-maintained columns", () => {
  it("ignores a spoofed created_by on insert and update", async () => {
    const id = rid(40);
    const out = await as(db, authed(U), async (c) => {
      await c.query("insert into public.household_records (id, household_id, category, title, created_by) values ($1,$2,'gas','t',$3)", [id, H5, V]);
      const a = (await c.query("select created_by from public.household_records where id=$1", [id])).rows[0];
      await c.query("update public.household_records set created_by=$2, title='t2' where id=$1", [id, V]);
      const b = (await c.query("select created_by, title from public.household_records where id=$1", [id])).rows[0];
      return { a, b };
    });
    expect(out.a).toEqual({ created_by: U });
    expect(out.b).toEqual({ created_by: U, title: "t2" });
  });
});

describe("audit", () => {
  const audit = (c: Db, id: string) =>
    c.query(
      "select action, actor_user_id, household_id, entity_type, summary, (before is null) as nb, (after is null) as na from public.audit_log where entity_id=$1 order by id",
      [id],
    );

  it("writes each action with the right actor", async () => {
    const id = rid(50);
    const rows = await as(db, authed(U), async (c) => {
      await c.query(INS, [id, H5, "Audited"]);
      await c.query("update public.household_records set status='x' where id=$1", [id]);
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: V, role: "authenticated" })]);
      await c.query("update public.household_records set verified=true where id=$1", [id]);
      await c.query("update public.household_records set verified=false where id=$1", [id]);
      await c.query("delete from public.household_records where id=$1", [id]);
      return (await audit(c, id)).rows;
    });
    expect(rows.map((r) => r.action)).toEqual(["record.created", "record.updated", "record.verified", "record.updated", "record.deleted"]);
    expect(rows.map((r) => r.actor_user_id)).toEqual([U, U, V, V, V]);
    for (const r of rows) expect(r).toMatchObject({ household_id: H5, entity_type: "record", summary: "Audited" });
    expect(rows[0]).toMatchObject({ nb: true, na: false });
    expect(rows[4]).toMatchObject({ nb: false, na: true });
  });

  it("summary never contains the amount or reference", async () => {
    const id = rid(51);
    const rows = await as(db, authed(U), async (c) => {
      await c.query(
        `insert into public.household_records (id, household_id, category, title, amount, unit, reference_last4)
         values ($1,$2,'banking','Savings pot',98765.43,'GBP','9876')`,
        [id, H5],
      );
      await c.query("update public.household_records set amount=11111.11 where id=$1", [id]);
      return (await audit(c, id)).rows;
    });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(String(r.summary)).toBe("Savings pot");
      expect(String(r.summary)).not.toMatch(/98765|11111|9876/);
    }
  });
});

describe("catalog", () => {
  it("RLS forced, authenticated-only policies, trigger functions not executable", async () => {
    const r = await db.query(`select relrowsecurity, relforcerowsecurity from pg_class where oid='public.household_records'::regclass`);
    expect(r.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const p = await db.query(`select 1 from pg_policies where schemaname='public' and tablename='household_records' and roles::text <> '{authenticated}'`);
    expect(p.rows).toEqual([]);
    const f = await db.query(`select has_function_privilege('authenticated','private.audit_household_record()','execute') as a,
      has_function_privilege('anon','private.audit_household_record()','execute') as b`);
    expect(f.rows[0]).toEqual({ a: false, b: false });
  });
});

describe("audit snapshots never keep amounts, references or notes (review S3)", () => {
  it("strips them from before/after", async () => {
    const id = "4ec1ffff-0000-4000-8000-000000000001";
    const rows = await as(db, authed(U), async (c) => {
      await c.query(
        "insert into public.household_records (id, household_id, category, title, amount, unit, reference_last4) values ($1,$2,'insurance','Audit strip',12.5,'GBP','9876')",
        [id, H5],
      );
      await c.query("update public.household_records set title='Audit strip 2' where id=$1", [id]);
      await c.query("reset role");
      return (await c.query("select (after ? 'amount') a, (after ? 'reference_last4') r, (after ? 'notes') n, (before ? 'amount') ba from public.audit_log where entity_id=$1 and action='record.updated'", [id])).rows;
    });
    expect(rows).toEqual([{ a: false, r: false, n: false, ba: false }]);
  });
});
