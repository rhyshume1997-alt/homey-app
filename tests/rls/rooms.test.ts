import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "40040000-0000-4000-8000-0000000000a1";
const HB = "40040000-0000-4000-8000-0000000000b1";
const U = "40040000-0000-4000-8000-0000000000c1"; // HA
const V = "40040000-0000-4000-8000-0000000000c2"; // HA
const W = "40040000-0000-4000-8000-0000000000c3"; // HB

const id = (kind: number, n: number) => `40040000-0000-4000-8000-${String(kind * 1000 + n).padStart(12, "0")}`;
const RA = id(1, 1);
const RB = id(1, 2);
const TA = id(2, 1);
const GA = id(3, 1);

const INS_ROOM = "insert into public.rooms (id, household_id, name) values ($1,$2,$3)";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'ROOM-A'),($2,'ROOM-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u@room.example.test',$1,'owner','U'),('v@room.example.test',$1,'member','V'),('w@room.example.test',$2,'owner','W')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1,'u@room.example.test','{"provider":"google"}'),($2,'v@room.example.test','{"provider":"google"}'),($3,'w@room.example.test','{"provider":"google"}')`,
    [U, V, W],
  );
  await db.query(INS_ROOM, [RA, HA, "Fixture room A"]);
  await db.query(INS_ROOM, [RB, HB, "Fixture room B"]);
  await db.query("insert into public.tasks (id, household_id, title, room_id) values ($1,$2,'t',$3)", [TA, HA, RA]);
  await db.query("insert into public.snags (id, household_id, title, room_id) values ($1,$2,'s',$3)", [GA, HA, RA]);
}, 60000);

afterAll(async () => {
  await db?.end();
});

describe("anon", () => {
  it("cannot touch rooms", async () => {
    for (const sql of ["select * from public.rooms", "update public.rooms set notes='x'", "delete from public.rooms"]) {
      const r = await tryQuery(db, { role: "anon" }, sql);
      expect(r.error?.message).toMatch(/permission denied/);
    }
    const r = await tryQuery(db, { role: "anon" }, INS_ROOM, [id(1, 50), HA, "x"]);
    expect(r.error?.message).toMatch(/permission denied/);
  });
});

describe("isolation", () => {
  it("members see only their own household rooms", async () => {
    const a = await tryQuery(db, authed(U), "select id from public.rooms where id in ($1,$2)", [RA, RB]);
    expect(a.rows).toEqual([{ id: RA }]);
    const b = await tryQuery(db, authed(W), "select id from public.rooms where id in ($1,$2)", [RA, RB]);
    expect(b.rows).toEqual([{ id: RB }]);
  });

  it("another member of the household can rename and delete", async () => {
    const out = await as(db, authed(V), async (c) => {
      await c.query("update public.rooms set name='Renamed', notes='3.4 m wall' where id=$1", [RA]);
      const r = (await c.query("select name, notes from public.rooms where id=$1", [RA])).rows;
      await c.query("delete from public.rooms where id=$1", [RA]);
      const gone = (await c.query("select id from public.rooms where id=$1", [RA])).rows;
      return { r, gone };
    });
    expect(out).toEqual({ r: [{ name: "Renamed", notes: "3.4 m wall" }], gone: [] });
  });

  it("other household cannot update or delete, or insert into this household", async () => {
    const out = await as(db, authed(W), async (c) => {
      await c.query("update public.rooms set name='hacked' where id=$1", [RA]);
      await c.query("delete from public.rooms where id=$1", [RA]);
      await c.query("reset role");
      return (await c.query("select name from public.rooms where id=$1", [RA])).rows;
    });
    expect(out).toEqual([{ name: "Fixture room A" }]);
    const ins = await tryQuery(db, authed(W), INS_ROOM, [id(1, 20), HA, "x"]);
    expect(ins.error?.message).toMatch(/row-level security/);
  });

  it("household_id is immutable", async () => {
    await db.query("begin");
    try {
      await expect(db.query("update public.rooms set household_id=$2 where id=$1", [RA, HB])).rejects.toThrow(/immutable/);
    } finally {
      await db.query("rollback");
    }
  });
});

describe("room links", () => {
  it("a task or snag cannot point at another household's room", async () => {
    const t = await tryQuery(db, authed(U), "update public.tasks set room_id=$2 where id=$1", [TA, RB]);
    expect(t.error?.message).toMatch(/room not in this household/);
    const s = await tryQuery(db, authed(U), "update public.snags set room_id=$2 where id=$1", [GA, RB]);
    expect(s.error?.message).toMatch(/room not in this household/);
    const ti = await tryQuery(
      db, authed(U), "insert into public.tasks (household_id, title, room_id) values ($1,'x',$2)", [HA, RB],
    );
    expect(ti.error?.message).toMatch(/room not in this household/);
    const si = await tryQuery(
      db, authed(U), "insert into public.snags (household_id, title, room_id) values ($1,'x',$2)", [HA, RB],
    );
    expect(si.error?.message).toMatch(/room not in this household/);
  });

  it("a task or snag can point at its own household's room, or at none", async () => {
    const out = await as(db, authed(U), async (c) => {
      await c.query("update public.tasks set room_id=null where id=$1", [TA]);
      await c.query("update public.tasks set room_id=$2 where id=$1", [TA, RA]);
      const t = (await c.query("select room_id from public.tasks where id=$1", [TA])).rows;
      return t;
    });
    expect(out).toEqual([{ room_id: RA }]);
  });

  it("deleting a room keeps its tasks and snags with room_id null", async () => {
    const out = await as(db, authed(U), async (c) => {
      await c.query("delete from public.rooms where id=$1", [RA]);
      const t = (await c.query("select room_id from public.tasks where id=$1", [TA])).rows;
      const s = (await c.query("select room_id from public.snags where id=$1", [GA])).rows;
      return { t, s };
    });
    expect(out).toEqual({ t: [{ room_id: null }], s: [{ room_id: null }] });
  });
});

describe("constraints", () => {
  it("rejects bad values", async () => {
    const bad: Array<[string, unknown[]]> = [
      ["insert into public.rooms (household_id, name) values ($1,'')", [HA]],
      ["insert into public.rooms (household_id, name) values ($1,$2)", [HA, "x".repeat(61)]],
      ["insert into public.rooms (household_id, name, notes) values ($1,'n',$2)", [HA, "x".repeat(2001)]],
      ["insert into public.rooms (household_id, name, sort_order) values ($1,'n',1001)", [HA]],
    ];
    for (const [sql, params] of bad) {
      const r = await tryQuery(db, authed(U), sql, params);
      expect(r.error?.message, sql).toMatch(/violates check constraint/);
    }
  });

  it("room names are unique per household, case-insensitively, but may repeat across households", async () => {
    const dup = await as(db, authed(U), async (c) => {
      await c.query(INS_ROOM, [id(1, 30), HA, "Hall"]);
      try {
        await c.query(INS_ROOM, [id(1, 31), HA, "hall"]);
        return null;
      } catch (e) {
        return e as Error;
      }
    });
    expect(dup?.message).toMatch(/duplicate key/);
    const other = await tryQuery(db, authed(W), INS_ROOM, [id(1, 32), HB, "Hall"]);
    expect(other.error).toBeNull();
  });
});
