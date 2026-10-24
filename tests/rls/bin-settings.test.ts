import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "b1e50000-0000-4000-8000-0000000000a1";
const HB = "b1e50000-0000-4000-8000-0000000000b1";
const U = "b1e50000-0000-4000-8000-0000000000c1"; // HA owner
const V = "b1e50000-0000-4000-8000-0000000000c2"; // HA member (removed in one test)
const W = "b1e50000-0000-4000-8000-0000000000c3"; // HB owner
const SA = "b1e50000-0000-4000-8000-000000001001";
const SB = "b1e50000-0000-4000-8000-000000001002";

const INS_SCHED = "insert into public.bin_schedules (id, household_id, bin_name, colour, first_date, every_weeks) values ($1,$2,$3,'green','2026-10-27',2)";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'BS-A'),($2,'BS-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u@bs.example.test',$1,'owner','U'),('v@bs.example.test',$1,'member','V'),('w@bs.example.test',$2,'owner','W')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1,'u@bs.example.test','{"provider":"google"}'),($2,'v@bs.example.test','{"provider":"google"}'),($3,'w@bs.example.test','{"provider":"google"}')`,
    [U, V, W],
  );
  await db.query(INS_SCHED, [SA, HA, "A bin"]);
  await db.query(INS_SCHED, [SB, HB, "B bin"]);
  await db.query(`insert into public.bin_settings (household_id, council_url) values ($1,'https://a.example.test/bins'),($2,'https://b.example.test/bins')`, [HA, HB]);
}, 60000);
afterAll(async () => db?.end());

describe("anon", () => {
  it("cannot touch either table", async () => {
    for (const t of ["bin_settings", "bin_schedules"]) {
      for (const sql of [`select * from public.${t}`, `delete from public.${t}`]) {
        expect((await tryQuery(db, { role: "anon" }, sql)).error?.message).toMatch(/permission denied/);
      }
    }
  });
});

describe("isolation between households", () => {
  it("reads only the own household's rows", async () => {
    const s = await tryQuery(db, authed(U), "select bin_name from public.bin_schedules order by 1");
    expect(s.rows).toEqual([{ bin_name: "A bin" }]);
    const c = await tryQuery(db, authed(U), "select council_url from public.bin_settings");
    expect(c.rows).toEqual([{ council_url: "https://a.example.test/bins" }]);
  });

  it("cannot update or delete the other household's rows", async () => {
    const u1 = await tryQuery(db, authed(U), "with u as (update public.bin_schedules set bin_name='x' where id=$1 returning 1) select count(*)::int n from u", [SB]);
    expect(u1.rows[0]).toEqual({ n: 0 });
    const u2 = await tryQuery(db, authed(U), "with u as (update public.bin_settings set council_url='https://evil.example.test/' where household_id=$1 returning 1) select count(*)::int n from u", [HB]);
    expect(u2.rows[0]).toEqual({ n: 0 });
    const d1 = await tryQuery(db, authed(U), "with d as (delete from public.bin_schedules where id=$1 returning 1) select count(*)::int n from d", [SB]);
    expect(d1.rows[0]).toEqual({ n: 0 });
    const d2 = await tryQuery(db, authed(U), "with d as (delete from public.bin_settings where household_id=$1 returning 1) select count(*)::int n from d", [HB]);
    expect(d2.rows[0]).toEqual({ n: 0 });
    const left = await db.query("select (select count(*)::int from public.bin_schedules where household_id=$1) s, (select council_url from public.bin_settings where household_id=$1) c", [HB]);
    expect(left.rows[0]).toEqual({ s: 1, c: "https://b.example.test/bins" });
  });

  it("cannot insert into the other household", async () => {
    const r1 = await tryQuery(db, authed(U), INS_SCHED, [SA.replace(/1001$/, "1003"), HB, "intruder"]);
    expect(r1.error?.message).toMatch(/row-level security|violates/);
    const r2 = await tryQuery(db, authed(U), "insert into public.bin_settings (household_id, council_url) values ($1,'https://x.example.test/')", [HB]);
    expect(r2.error).toBeTruthy();
  });

  it("cannot move a row to another household", async () => {
    const r = await tryQuery(db, authed(U), "update public.bin_schedules set household_id=$1 where id=$2", [HB, SA]);
    expect(r.error).toBeTruthy();
  });
});

describe("members can manage their own household's rows", () => {
  it("insert, update, upsert and delete, with created_by and the audit log", async () => {
    const id = SA.replace(/1001$/, "1004");
    const out = await as(db, authed(U), async (c) => {
      await c.query(INS_SCHED, [id, HA, "New bin"]);
      await c.query("update public.bin_schedules set bin_name='Renamed' where id=$1", [id]);
      await c.query("insert into public.bin_settings (household_id, council_url) values ($1,'https://a2.example.test/') on conflict (household_id) do update set council_url=excluded.council_url", [HA]);
      const row = (await c.query("select created_by, bin_name from public.bin_schedules where id=$1", [id])).rows[0];
      const set = (await c.query("select council_url, updated_by from public.bin_settings where household_id=$1", [HA])).rows[0];
      await c.query("delete from public.bin_schedules where id=$1", [id]);
      await c.query("reset role");
      const audit = (await c.query("select action, summary from public.audit_log where household_id=$1 and (action like 'bin_schedule.%' or action='bin_settings.updated')", [HA])).rows;
      return { row, set, audit };
    });
    expect(out.row).toEqual({ created_by: U, bin_name: "Renamed" });
    expect(out.set).toEqual({ council_url: "https://a2.example.test/", updated_by: U });
    expect(out.audit.map((r) => r.action)).toEqual(expect.arrayContaining(["bin_schedule.created", "bin_schedule.updated", "bin_schedule.deleted", "bin_settings.updated"]));
    expect(JSON.stringify(out.audit)).not.toContain("example.test");
  });
});

describe("constraints", () => {
  it.each([
    "http://a.example.test/bins", "javascript:alert(1)", "JAVASCRIPT:alert(1)", "https://user:pw@a.example.test/", "https://u@a.example.test/",
    "ftp://a.example.test/", "https://", "https:// a.example.test", `https://a.example.test/${"a".repeat(500)}`,
  ])("rejects the council link %s", async (url) => {
    const r = await tryQuery(db, authed(U), "update public.bin_settings set council_url=$1 where household_id=$2", [url, HA]);
    expect(r.error?.message).toMatch(/bin_settings_council_url_check/);
  });

  it("accepts https and null", async () => {
    expect((await tryQuery(db, authed(U), "update public.bin_settings set council_url='https://ok.example.test/x?y=1#z' where household_id=$1", [HA])).error).toBeNull();
    expect((await tryQuery(db, authed(U), "update public.bin_settings set council_url=null where household_id=$1", [HA])).error).toBeNull();
  });

  it.each([
    ["name too long", `bin_name='${"x".repeat(41)}'`],
    ["empty name", "bin_name=''"],
    ["colour outside the set", "colour='pink'"],
    ["every 0 weeks", "every_weeks=0"],
    ["every 9 weeks", "every_weeks=9"],
  ])("rejects a schedule with %s", async (_n, set) => {
    const r = await tryQuery(db, authed(U), `update public.bin_schedules set ${set} where id=$1`, [SA]);
    expect(r.error?.message).toMatch(/check constraint/);
  });
});

describe("removed member", () => {
  it("loses access to both tables", async () => {
    const out = await as(db, authed(V), async (c) => {
      const before = (await c.query("select id from public.bin_schedules")).rows.length;
      await c.query("reset role");
      await c.query("update public.household_members set status='removed', removed_at=now() where household_id=$1 and user_id=$2", [HA, V]);
      await c.query("set local role authenticated");
      const sched = (await c.query("select id from public.bin_schedules")).rows.length;
      const sett = (await c.query("select household_id from public.bin_settings")).rows.length;
      const del = (await c.query("with d as (delete from public.bin_schedules where id=$1 returning 1) select count(*)::int n from d", [SA])).rows[0];
      const upd = (await c.query("with u as (update public.bin_settings set council_url=null where household_id=$1 returning 1) select count(*)::int n from u", [HA])).rows[0];
      let insertError = "";
      await c.query("create function pg_temp.try_ins() returns text language plpgsql as $f$ begin insert into public.bin_schedules (household_id, bin_name, colour, first_date, every_weeks) values ('" + HA + "','nope','green','2026-10-27',1); return 'inserted'; exception when others then return sqlerrm; end $f$").catch(() => {});
      insertError = String((await c.query("select pg_temp.try_ins() as r").catch(() => ({ rows: [{ r: "denied" }] }))).rows[0].r);
      return { before, sched, sett, del, upd, insertError };
    });
    expect(out.before).toBe(1);
    expect(out.sched).toBe(0);
    expect(out.sett).toBe(0);
    expect(out.del).toEqual({ n: 0 });
    expect(out.upd).toEqual({ n: 0 });
    expect(out.insertError).not.toBe("inserted");
  });
});
