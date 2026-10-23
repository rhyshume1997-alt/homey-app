import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "3e4c0000-0000-4000-8000-0000000000a1";
const HB = "3e4c0000-0000-4000-8000-0000000000b1";
const U = "3e4c0000-0000-4000-8000-0000000000c1"; // HA
const V = "3e4c0000-0000-4000-8000-0000000000c2"; // HA
const W = "3e4c0000-0000-4000-8000-0000000000c3"; // HB

const id = (n: number) => `3e4c0000-0000-4000-8000-${String(1000 + n).padStart(12, "0")}`;
const EA = id(1);
const EB = id(2);

const INS = "insert into public.emergency_items (id, household_id, section, label, detail) values ($1,$2,$3,$4,$5)";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'EMG-A'),($2,'EMG-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u@emg.example.test',$1,'owner','U'),('v@emg.example.test',$1,'member','V'),('w@emg.example.test',$2,'owner','W')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1,'u@emg.example.test','{"provider":"google"}'),($2,'v@emg.example.test','{"provider":"google"}'),($3,'w@emg.example.test','{"provider":"google"}')`,
    [U, V, W],
  );
  await db.query(INS, [EA, HA, "location", "Stopcock", "Not set yet"]);
  await db.query(INS, [EB, HB, "number", "Water supplier", "Not set yet"]);
}, 60000);

afterAll(async () => {
  await db?.end();
});

describe("anon", () => {
  it("cannot touch the table", async () => {
    for (const sql of [
      "select * from public.emergency_items",
      "update public.emergency_items set label='x'",
      "delete from public.emergency_items",
    ]) {
      const r = await tryQuery(db, { role: "anon" }, sql);
      expect(r.error?.message, sql).toMatch(/permission denied/);
    }
    const r = await tryQuery(db, { role: "anon" }, `insert into public.emergency_items (household_id, section, label, detail) values ('${HA}','location','x','y')`);
    expect(r.error?.message).toMatch(/permission denied/);
  });
});

describe("isolation", () => {
  it("members see only their own household rows", async () => {
    const a = await tryQuery(db, authed(U), "select id from public.emergency_items where id in ($1,$2)", [EA, EB]);
    expect(a.rows).toEqual([{ id: EA }]);
    const b = await tryQuery(db, authed(W), "select id from public.emergency_items where id in ($1,$2)", [EA, EB]);
    expect(b.rows).toEqual([{ id: EB }]);
  });

  it("a member of the same household can update and delete", async () => {
    const out = await as(db, authed(V), async (c) => {
      await c.query("update public.emergency_items set detail='0123 456 789' where id=$1", [EA]);
      const d = (await c.query("select detail from public.emergency_items where id=$1", [EA])).rows;
      await c.query("delete from public.emergency_items where id=$1", [EA]);
      const gone = (await c.query("select id from public.emergency_items where id=$1", [EA])).rows;
      return { d, gone };
    });
    expect(out).toEqual({ d: [{ detail: "0123 456 789" }], gone: [] });
  });

  it("another household cannot update or delete", async () => {
    const out = await as(db, authed(W), async (c) => {
      await c.query("update public.emergency_items set label='hacked' where id=$1", [EA]);
      await c.query("delete from public.emergency_items where id=$1", [EA]);
      await c.query("reset role");
      return (await c.query("select label from public.emergency_items where id=$1", [EA])).rows;
    });
    expect(out).toEqual([{ label: "Stopcock" }]);
  });

  it("cannot insert into another household", async () => {
    const r = await tryQuery(db, authed(W), INS, [id(20), HA, "number", "x", "y"]);
    expect(r.error?.message).toMatch(/row-level security/);
  });

  it("household_id is immutable", async () => {
    await db.query("begin");
    try {
      await expect(
        db.query("update public.emergency_items set household_id=$2 where id=$1", [EA, HB]),
      ).rejects.toThrow(/immutable/);
    } finally {
      await db.query("rollback");
    }
  });
});

describe("constraints", () => {
  it("rejects bad values", async () => {
    const bad: Array<[string, unknown[]]> = [
      [INS, [id(30), HA, "location", "", "y"]],
      [INS, [id(31), HA, "location", "x".repeat(81), "y"]],
      [INS, [id(32), HA, "location", "x", ""]],
      [INS, [id(33), HA, "location", "x", "y".repeat(301)]],
      [INS, [id(34), HA, "garage", "x", "y"]],
    ];
    for (const [sql, params] of bad) {
      const r = await tryQuery(db, authed(U), sql, params);
      expect(r.error?.message, JSON.stringify(params.slice(2))).toMatch(/violates check constraint/);
    }
  });
});

describe("guard", () => {
  it("clients cannot spoof created_by or created_at", async () => {
    const out = await as(db, authed(U), async (c) => {
      await c.query(
        "insert into public.emergency_items (id, household_id, section, label, detail, created_by, created_at) values ($1,$2,'step','s','d',$3,'2000-01-01')",
        [id(40), HA, V],
      );
      await c.query("update public.emergency_items set created_by=$2, created_at='2000-01-01' where id=$1", [EA, V]);
      const a = (await c.query("select created_by, created_at > '2020-01-01' as recent from public.emergency_items where id=$1", [id(40)])).rows[0];
      const b = (await c.query("select created_by, created_at > '2020-01-01' as recent from public.emergency_items where id=$1", [EA])).rows[0];
      return { a, b };
    });
    expect(out.a).toEqual({ created_by: U, recent: true });
    expect(out.b).toEqual({ created_by: null, recent: true });
  });
});

describe("audit", () => {
  const audit = (c: Db, entity: string) =>
    c.query(
      "select action, actor_user_id, household_id, entity_type, summary, before, after from public.audit_log where entity_id=$1 order by id",
      [entity],
    );

  it("records added, updated and removed with the label only", async () => {
    const rid = id(50);
    const rows = await as(db, authed(U), async (c) => {
      await c.query(INS, [rid, HA, "number", "Gas emergency", "0800 111 999"]);
      await c.query("update public.emergency_items set detail='0800 111 999 (card)' where id=$1", [rid]);
      await c.query("delete from public.emergency_items where id=$1", [rid]);
      return (await audit(c, rid)).rows;
    });
    expect(rows.map((r) => r.action)).toEqual(["emergency.added", "emergency.updated", "emergency.removed"]);
    for (const r of rows) {
      expect(r).toMatchObject({
        actor_user_id: U, household_id: HA, entity_type: "emergency_item", summary: "Gas emergency", before: null, after: null,
      });
    }
  });

  it("audit entries are not visible to the other household", async () => {
    const r = await as(db, authed(W), async (c) => {
      return (await c.query("select id from public.audit_log where entity_id=$1 and household_id=$2", [EA, HA])).rows;
    });
    expect(r).toEqual([]);
  });
});
