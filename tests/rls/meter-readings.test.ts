import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "3e7e0000-0000-4000-8000-0000000000a1";
const HB = "3e7e0000-0000-4000-8000-0000000000b1";
const U = "3e7e0000-0000-4000-8000-0000000000c1"; // HA
const V = "3e7e0000-0000-4000-8000-0000000000c2"; // HA
const W = "3e7e0000-0000-4000-8000-0000000000c3"; // HB
const id = (n: number) => `3e7e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RA = id(1);
const RB = id(2);

const INS = "insert into public.meter_readings (id, household_id, fuel, read_on, value, unit) values ($1,$2,$3,$4,$5,$6)";
const INS_EMAIL =
  "insert into public.meter_readings (id, household_id, fuel, read_on, value, unit, source, source_message_hash) values ($1,$2,'gas',$3,1,'m3','email',$4)";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'MTR-A'),($2,'MTR-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u@mtr.example.test',$1,'owner','U'),('v@mtr.example.test',$1,'member','V'),('w@mtr.example.test',$2,'owner','W')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1,'u@mtr.example.test','{"provider":"google"}'),($2,'v@mtr.example.test','{"provider":"google"}'),($3,'w@mtr.example.test','{"provider":"google"}')`,
    [U, V, W],
  );
  await db.query(INS, [RA, HA, "electricity", "2026-01-01", 100, "kWh"]);
  await db.query(INS, [RB, HB, "electricity", "2026-01-01", 200, "kWh"]);
}, 60000);

afterAll(async () => {
  await db?.end();
});

describe("anon", () => {
  it("cannot touch the table", async () => {
    for (const sql of ["select * from public.meter_readings", "delete from public.meter_readings"]) {
      const r = await tryQuery(db, { role: "anon" }, sql);
      expect(r.error?.message).toMatch(/permission denied/);
    }
  });
});

describe("isolation", () => {
  it("members see only their own household", async () => {
    const a = await tryQuery(db, authed(U), "select id from public.meter_readings where id in ($1,$2)", [RA, RB]);
    expect(a.rows).toEqual([{ id: RA }]);
  });

  it("same-household member can update; other household cannot update or delete", async () => {
    const out = await as(db, authed(V), async (c) => {
      await c.query("update public.meter_readings set note='by v' where id=$1", [RA]);
      return (await c.query("select note from public.meter_readings where id=$1", [RA])).rows;
    });
    expect(out).toEqual([{ note: "by v" }]);
    const other = await as(db, authed(W), async (c) => {
      await c.query("update public.meter_readings set note='hacked' where id=$1", [RA]);
      await c.query("delete from public.meter_readings where id=$1", [RA]);
      await c.query("reset role");
      return (await c.query("select note from public.meter_readings where id=$1", [RA])).rows;
    });
    expect(other).toEqual([{ note: null }]);
  });

  it("cannot insert into another household, and household_id is immutable", async () => {
    const r = await tryQuery(db, authed(W), INS, [id(20), HA, "gas", "2026-01-02", 1, "m3"]);
    expect(r.error?.message).toMatch(/row-level security/);
    await db.query("begin");
    try {
      await expect(db.query("update public.meter_readings set household_id=$2 where id=$1", [RA, HB])).rejects.toThrow(/immutable/);
    } finally {
      await db.query("rollback");
    }
  });
});

describe("constraints", () => {
  it("rejects bad values", async () => {
    const bad: Array<[string, unknown[]]> = [
      [INS, [id(30), HA, "water", "2026-01-02", 1, "kWh"]],
      [INS, [id(31), HA, "gas", "2026-01-02", -1, "m3"]],
      [INS, [id(32), HA, "gas", "2026-01-02", 1, "litres"]],
      ["insert into public.meter_readings (household_id, fuel, read_on, value, unit, source) values ($1,'gas','2026-01-02',1,'m3','sms')", [HA]],
      ["insert into public.meter_readings (household_id, fuel, read_on, value, unit, note) values ($1,'gas','2026-01-02',1,'m3',$2)", [HA, "x".repeat(201)]],
    ];
    for (const [sql, params] of bad) {
      const r = await tryQuery(db, authed(U), sql, params);
      expect(r.error?.message, sql).toMatch(/violates check constraint/);
    }
  });

  it("rejects a reading dated in the future (Europe/London) but allows today", async () => {
    const future = await tryQuery(
      db,
      authed(U),
      "insert into public.meter_readings (household_id, fuel, read_on, value, unit) values ($1,'gas',(now() at time zone 'Europe/London')::date + 1,1,'m3')",
      [HA],
    );
    expect(future.error?.message).toMatch(/future/);
    const today = await as(db, authed(U), async (c) => {
      await c.query(
        "insert into public.meter_readings (id, household_id, fuel, read_on, value, unit) values ($1,$2,'gas',(now() at time zone 'Europe/London')::date,1.5,'m3')",
        [id(33), HA],
      );
      return (await c.query("select value::text from public.meter_readings where id=$1", [id(33)])).rows;
    });
    expect(today).toEqual([{ value: "1.500" }]);
  });

  it("source_message_hash is unique per household but reusable across households", async () => {
    const dup = await as(db, authed(U), async (c) => {
      await c.query(INS_EMAIL, [id(40), HA, "2026-02-01", "h1"]);
      try {
        await c.query(INS_EMAIL, [id(41), HA, "2026-02-02", "h1"]);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(dup).toMatch(/duplicate key/);
    const other = await tryQuery(db, authed(W), INS_EMAIL, [id(42), HB, "2026-02-01", "h1"]);
    expect(other.error).toBeFalsy();
  });

  it("allows only one reading per fuel per day", async () => {
    const r = await tryQuery(db, authed(U), INS, [id(50), HA, "electricity", "2026-01-01", 5, "kWh"]);
    expect(r.error?.message).toMatch(/duplicate key/);
  });
});

describe("audit", () => {
  it("records fuel and date only, never the value", async () => {
    const rid = id(60);
    const rows = await as(db, authed(U), async (c) => {
      await c.query(INS, [rid, HA, "gas", "2026-03-01", 98765.432, "m3"]);
      await c.query("update public.meter_readings set note='n' where id=$1", [rid]);
      await c.query("delete from public.meter_readings where id=$1", [rid]);
      return (
        await c.query(
          "select action, actor_user_id, household_id, entity_type, summary from public.audit_log where entity_id=$1 order by id",
          [rid],
        )
      ).rows;
    });
    expect(rows.map((r) => r.action)).toEqual(["meter_reading.added", "meter_reading.updated", "meter_reading.removed"]);
    for (const r of rows) {
      expect(r).toMatchObject({ actor_user_id: U, household_id: HA, entity_type: "meter_reading", summary: "gas 2026-03-01" });
      expect(JSON.stringify(r)).not.toContain("98765");
    }
  });
});
