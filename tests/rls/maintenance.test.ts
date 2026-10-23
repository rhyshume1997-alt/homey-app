import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const H7 = "3a170000-0000-4000-8000-00000000a001";
const H8 = "3a170000-0000-4000-8000-00000000a002";
const U = "3a170000-0000-4000-8000-0000000000c1"; // H7
const V = "3a170000-0000-4000-8000-0000000000c2"; // H7
const W = "3a170000-0000-4000-8000-0000000000c3"; // H8

const id = (n: number) => `3a170000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const I7 = id(1);
const I8 = id(2);

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'MT-H7'),($2,'MT-H8')`, [H7, H8]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u@maint.example.test',$1,'owner','U'),('v@maint.example.test',$1,'member','V'),('w@maint.example.test',$2,'owner','W')`,
    [H7, H8],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values
    ($1,'u@maint.example.test','{"provider":"google"}'),($2,'v@maint.example.test','{"provider":"google"}'),($3,'w@maint.example.test','{"provider":"google"}')`,
    [U, V, W],
  );
  await db.query(
    `insert into public.maintenance_items (id, household_id, title, interval_months) values ($1,$2,'Fixture h7',12),($3,$4,'Fixture h8',12)`,
    [I7, H7, I8, H8],
  );
}, 30000);

afterAll(async () => {
  await db?.end();
});

const asClaims = (c: Db, sub: string) =>
  c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: "authenticated" })]);

const LOG = "insert into public.maintenance_log (household_id, item_id, done_on) values ($1,$2,$3)";

async function itemAfterLogs(n: number, interval: number | null, dates: string[]) {
  const iid = id(n);
  return as(db, authed(U), async (c) => {
    await c.query("insert into public.maintenance_items (id, household_id, title, interval_months) values ($1,$2,$3,$4)", [iid, H7, `Calc ${n}`, interval]);
    for (const d of dates) await c.query(LOG, [H7, iid, d]);
    return (await c.query("select last_done_on::text as last_done_on, next_due_on::text as next_due_on from public.maintenance_items where id=$1", [iid])).rows[0];
  });
}

describe("anon and grants", () => {
  it("anon cannot touch either table", async () => {
    for (const sql of [
      "select * from public.maintenance_items",
      "select * from public.maintenance_log",
      `insert into public.maintenance_items (household_id, title) values ('${H7}','x')`,
      `insert into public.maintenance_log (household_id, item_id, done_on) values ('${H7}','${I7}','2027-01-01')`,
    ]) {
      expect((await tryQuery(db, { role: "anon" }, sql)).error?.message).toMatch(/permission denied/);
    }
  });
  it("RLS is enabled and forced on both tables", async () => {
    const r = await db.query(
      "select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('maintenance_items','maintenance_log') order by relname",
    );
    expect(r.rows).toEqual([
      { relname: "maintenance_items", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "maintenance_log", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });
  it("trigger functions are not executable by API roles", async () => {
    const r = await db.query(
      `select has_function_privilege('authenticated','private.apply_maintenance_log()','execute') as a,
              has_function_privilege('authenticated','private.audit_maintenance_item()','execute') as b,
              has_function_privilege('anon','private.guard_maintenance_log()','execute') as c`,
    );
    expect(r.rows[0]).toEqual({ a: false, b: false, c: false });
  });
});

describe("isolation", () => {
  it("members see their own household only", async () => {
    const out = await as(db, authed(U), async (c) => {
      await c.query(LOG, [H7, I7, "2027-01-10"]);
      const own = (await c.query("select title from public.maintenance_items")).rows;
      const log = (await c.query("select count(*)::int as n from public.maintenance_log")).rows[0];
      await asClaims(c, V);
      const sibling = (await c.query("select count(*)::int as n from public.maintenance_items where household_id=$1", [H7])).rows[0];
      await asClaims(c, W);
      const other = (await c.query("select title from public.maintenance_items where household_id=$1", [H7])).rows;
      const otherLog = (await c.query("select count(*)::int as n from public.maintenance_log where household_id=$1", [H7])).rows[0];
      return { own, log, sibling, other, otherLog };
    });
    expect(out.own.map((r) => (r as { title: string }).title)).toContain("Fixture h7");
    expect(out.own.map((r) => (r as { title: string }).title)).not.toContain("Fixture h8");
    expect(out.log.n).toBeGreaterThanOrEqual(1);
    expect(out.sibling.n).toBeGreaterThanOrEqual(1);
    expect(out.other).toEqual([]);
    expect(out.otherLog).toEqual({ n: 0 });
  });

  it("cannot insert items or logs into another household, or update/delete its items", async () => {
    const a = await tryQuery(db, authed(U), "insert into public.maintenance_items (household_id, title) values ($1,'x')", [H8]);
    expect(a.error?.message).toMatch(/row-level security/);
    const b = await tryQuery(db, authed(U), LOG, [H8, I8, "2027-01-01"]);
    expect(b.error).not.toBeNull();
    const c = await as(db, authed(U), async (cl) => {
      const u = await cl.query("update public.maintenance_items set title='hacked' where id=$1 returning id", [I8]);
      const d = await cl.query("delete from public.maintenance_items where id=$1 returning id", [I8]);
      return [u.rows.length, d.rows.length];
    });
    expect(c).toEqual([0, 0]);
  });

  it("a log row cannot point at another household's item", async () => {
    // Own household id with the other household's item: the composite FK rejects it.
    const r = await tryQuery(db, authed(U), LOG, [H7, I8, "2027-01-01"]);
    expect(r.error?.message).toMatch(/foreign key|violates/);
  });

  it("household_id is immutable", async () => {
    const r = await tryQuery(db, authed(U), "update public.maintenance_items set household_id=$2 where id=$1", [I7, H8]);
    expect(r.error).not.toBeNull();
  });
});

describe("append-only log", () => {
  it("users can insert and read but not update or delete log rows", async () => {
    const out = await as(db, authed(U), async (c) => {
      await c.query(LOG, [H7, I7, "2027-02-01"]);
      const read = (await c.query("select count(*)::int as n from public.maintenance_log where done_on='2027-02-01'")).rows[0];
      return read;
    });
    expect(out).toEqual({ n: 1 });
    for (const sql of [
      "update public.maintenance_log set notes='edited'",
      "delete from public.maintenance_log",
    ]) {
      expect((await tryQuery(db, authed(U), sql)).error?.message).toMatch(/permission denied/);
    }
  });

  it("done_by is forced to the caller and cost null means unknown", async () => {
    const rows = await as(db, authed(U), async (c) => {
      await c.query("insert into public.maintenance_log (household_id, item_id, done_on, done_by) values ($1,$2,'2027-03-01',$3)", [H7, I7, V]);
      return (await c.query("select done_by, cost_gbp from public.maintenance_log where done_on='2027-03-01'")).rows;
    });
    expect(rows).toEqual([{ done_by: U, cost_gbp: null }]);
  });

  it("deleting an item cascades its history", async () => {
    const iid = id(50);
    const n = await as(db, authed(U), async (c) => {
      await c.query("insert into public.maintenance_items (id, household_id, title) values ($1,$2,'Cascade')", [iid, H7]);
      await c.query(LOG, [H7, iid, "2027-01-01"]);
      await c.query("delete from public.maintenance_items where id=$1", [iid]);
      return (await c.query("select count(*)::int as n from public.maintenance_log where item_id=$1", [iid])).rows[0];
    });
    expect(n).toEqual({ n: 0 });
  });
});

describe("next_due computation", () => {
  const cases: [number, number | null, string[], string | null, string | null][] = [
    [100, 12, ["2027-03-10"], "2027-03-10", "2028-03-10"],
    [101, 1, ["2027-01-31"], "2027-01-31", "2027-02-28"],
    [102, 1, ["2028-01-31"], "2028-01-31", "2028-02-29"],
    [103, 6, ["2027-08-31"], "2027-08-31", "2028-02-29"],
    [104, 12, ["2028-02-29"], "2028-02-29", "2029-02-28"],
    [105, 3, ["2027-11-30"], "2027-11-30", "2028-02-29"],
    [106, 12, ["2027-06-01", "2027-09-01"], "2027-09-01", "2028-09-01"],
    // A back-dated entry never moves last_done_on or next_due_on backwards.
    [107, 12, ["2027-09-01", "2026-01-01"], "2027-09-01", "2028-09-01"],
    // One-off: no interval, next_due_on is cleared once done.
    [108, null, ["2027-04-01"], "2027-04-01", null],
  ];
  cases.forEach(([n, interval, dates, last, next]) => {
    it(`interval ${interval}, done ${dates.join(", ")} -> next ${next}`, async () => {
      expect(await itemAfterLogs(n, interval, dates)).toEqual({ last_done_on: last, next_due_on: next });
    });
  });

  it("a user-set next_due_on is kept until the item is logged done", async () => {
    const iid = id(120);
    const rows = await as(db, authed(U), async (c) => {
      await c.query("insert into public.maintenance_items (id, household_id, title, interval_months, next_due_on) values ($1,$2,'Manual',12,'2027-05-05')", [iid, H7]);
      const before = (await c.query("select next_due_on::text as d, last_done_on from public.maintenance_items where id=$1", [iid])).rows[0];
      await c.query(LOG, [H7, iid, "2027-05-01"]);
      const after = (await c.query("select next_due_on::text as d from public.maintenance_items where id=$1", [iid])).rows[0];
      return { before, after };
    });
    expect(rows.before).toEqual({ d: "2027-05-05", last_done_on: null });
    expect(rows.after).toEqual({ d: "2028-05-01" });
  });
});

describe("guards and limits", () => {
  const bad: [string, string, unknown[]][] = [
    ["empty title", "insert into public.maintenance_items (household_id, title) values ($1,'')", [H7]],
    ["title over 120", "insert into public.maintenance_items (household_id, title) values ($1, repeat('a',121))", [H7]],
    ["area over 60", "insert into public.maintenance_items (household_id, title, area) values ($1,'x', repeat('a',61))", [H7]],
    ["interval 0", "insert into public.maintenance_items (household_id, title, interval_months) values ($1,'x',0)", [H7]],
    ["interval 121", "insert into public.maintenance_items (household_id, title, interval_months) values ($1,'x',121)", [H7]],
    ["bad season", "insert into public.maintenance_items (household_id, title, season) values ($1,'x','monsoon')", [H7]],
    ["notes over 1000", "insert into public.maintenance_items (household_id, title, notes) values ($1,'x', repeat('a',1001))", [H7]],
    ["provider over 120", "insert into public.maintenance_items (household_id, title, provider) values ($1,'x', repeat('a',121))", [H7]],
    ["log notes over 500", `insert into public.maintenance_log (household_id, item_id, done_on, notes) values ($1,'${I7}','2027-01-01', repeat('a',501))`, [H7]],
    ["negative cost", `insert into public.maintenance_log (household_id, item_id, done_on, cost_gbp) values ($1,'${I7}','2027-01-01', -1)`, [H7]],
    ["missing done_on", `insert into public.maintenance_log (household_id, item_id) values ($1,'${I7}')`, [H7]],
  ];
  bad.forEach(([name, sql, params]) => {
    it(`rejects ${name}`, async () => {
      expect((await tryQuery(db, authed(U), sql, params)).error).not.toBeNull();
    });
  });

  it("created_by cannot be forged or changed", async () => {
    const iid = id(130);
    const rows = await as(db, authed(U), async (c) => {
      await c.query("insert into public.maintenance_items (id, household_id, title, created_by) values ($1,$2,'Owned',$3)", [iid, H7, V]);
      await c.query("update public.maintenance_items set created_by=$2 where id=$1", [iid, V]);
      return (await c.query("select created_by from public.maintenance_items where id=$1", [iid])).rows;
    });
    expect(rows).toEqual([{ created_by: U }]);
  });
});

describe("audit", () => {
  it("records added, updated, done and removed with the title only", async () => {
    const iid = id(140);
    const rows = await as(db, authed(U), async (c) => {
      await c.query("insert into public.maintenance_items (id, household_id, title, notes, provider, interval_months) values ($1,$2,'Audit me','secret note','Acme Ltd',12)", [iid, H7]);
      await c.query("update public.maintenance_items set title='Audit me too' where id=$1", [iid]);
      await asClaims(c, V);
      await c.query("insert into public.maintenance_log (household_id, item_id, done_on, notes, cost_gbp) values ($1,$2,'2027-01-01','private log note',99.5)", [H7, iid]);
      await c.query("delete from public.maintenance_items where id=$1", [iid]);
      return (
        await c.query(
          "select action, actor_user_id, entity_type, summary, before::text as before, after::text as after from public.audit_log where entity_id=$1 order by id",
          [iid],
        )
      ).rows as { action: string; actor_user_id: string; entity_type: string; summary: string; before: string | null; after: string | null }[];
    });
    expect(rows.map((r) => [r.action, r.actor_user_id, r.summary])).toEqual([
      ["maintenance.added", U, "Audit me"],
      ["maintenance.updated", U, "Audit me too"],
      ["maintenance.done", V, "Audit me too"],
      ["maintenance.removed", V, "Audit me too"],
    ]);
    for (const r of rows) {
      expect(r.entity_type).toBe("maintenance");
      expect(`${r.before ?? ""}${r.after ?? ""}`).not.toMatch(/secret note|Acme|private log note|99\.5/);
    }
  });

  it("logging done writes one audit row, not an extra update row", async () => {
    const iid = id(150);
    const actions = await as(db, authed(U), async (c) => {
      await c.query("insert into public.maintenance_items (id, household_id, title, interval_months) values ($1,$2,'Once',6)", [iid, H7]);
      await c.query(LOG, [H7, iid, "2027-01-01"]);
      return (await c.query("select action from public.audit_log where entity_id=$1 order by id", [iid])).rows;
    });
    expect(actions).toEqual([{ action: "maintenance.added" }, { action: "maintenance.done" }]);
  });

  it("audit rows are only visible to the same household", async () => {
    const iid = id(160);
    const out = await as(db, authed(U), async (c) => {
      await c.query("insert into public.maintenance_items (id, household_id, title) values ($1,$2,'Hidden audit')", [iid, H7]);
      await asClaims(c, W);
      return (await c.query("select count(*)::int as n from public.audit_log where entity_id=$1", [iid])).rows[0];
    });
    expect(out).toEqual({ n: 0 });
  });
});
