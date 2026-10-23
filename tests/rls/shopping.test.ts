import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "5a0b0000-0000-4000-8000-0000000000a1";
const HB = "5a0b0000-0000-4000-8000-0000000000b1";
const U = "5a0b0000-0000-4000-8000-0000000000c1"; // HA
const V = "5a0b0000-0000-4000-8000-0000000000c2"; // HA
const W = "5a0b0000-0000-4000-8000-0000000000c3"; // HB

const id = (kind: number, n: number) => `5a0b0000-0000-4000-8000-${String(kind * 1000 + n).padStart(12, "0")}`;
const SA = id(1, 1);
const SB = id(1, 2);
const PA = id(2, 1);
const PB = id(2, 2);

const INS_ITEM = "insert into public.shopping_items (id, household_id, title) values ($1,$2,$3)";
const INS_SUP = "insert into public.supplies (id, household_id, name) values ($1,$2,$3)";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'SHOP-A'),($2,'SHOP-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u@shop.example.test',$1,'owner','U'),('v@shop.example.test',$1,'member','V'),('w@shop.example.test',$2,'owner','W')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1,'u@shop.example.test','{"provider":"google"}'),($2,'v@shop.example.test','{"provider":"google"}'),($3,'w@shop.example.test','{"provider":"google"}')`,
    [U, V, W],
  );
  await db.query(INS_ITEM, [SA, HA, "fixture a"]);
  await db.query(INS_ITEM, [SB, HB, "fixture b"]);
  await db.query(INS_SUP, [PA, HA, "Fixture A"]);
  await db.query(INS_SUP, [PB, HB, "Fixture B"]);
}, 60000);

afterAll(async () => {
  await db?.end();
});

describe("anon", () => {
  it("cannot touch either table", async () => {
    for (const t of ["shopping_items", "supplies"]) {
      for (const sql of [`select * from public.${t}`, `update public.${t} set created_at=now()`, `delete from public.${t}`]) {
        const r = await tryQuery(db, { role: "anon" }, sql);
        expect(r.error?.message).toMatch(/permission denied/);
      }
    }
    const r = await tryQuery(db, { role: "anon" }, `insert into public.shopping_items (household_id, title) values ('${HA}','x')`);
    expect(r.error?.message).toMatch(/permission denied/);
  });
});

describe("isolation", () => {
  it("members see only their own household rows", async () => {
    const a = await tryQuery(db, authed(U), "select id from public.shopping_items where id in ($1,$2)", [SA, SB]);
    expect(a.rows).toEqual([{ id: SA }]);
    const b = await tryQuery(db, authed(W), "select id from public.supplies where id in ($1,$2)", [PA, PB]);
    expect(b.rows).toEqual([{ id: PB }]);
  });

  it("a member of the same household can update and delete", async () => {
    const out = await as(db, authed(V), async (c) => {
      await c.query("update public.shopping_items set title='by v' where id=$1", [SA]);
      const t = (await c.query("select title from public.shopping_items where id=$1", [SA])).rows;
      await c.query("delete from public.supplies where id=$1", [PA]);
      const gone = (await c.query("select id from public.supplies where id=$1", [PA])).rows;
      return { t, gone };
    });
    expect(out).toEqual({ t: [{ title: "by v" }], gone: [] });
  });

  it("other household cannot update or delete", async () => {
    const out = await as(db, authed(W), async (c) => {
      await c.query("update public.shopping_items set title='hacked' where id=$1", [SA]);
      await c.query("delete from public.shopping_items where id=$1", [SA]);
      await c.query("update public.supplies set status='out' where id=$1", [PA]);
      await c.query("delete from public.supplies where id=$1", [PA]);
      await c.query("reset role");
      const i = (await c.query("select title from public.shopping_items where id=$1", [SA])).rows;
      const s = (await c.query("select status from public.supplies where id=$1", [PA])).rows;
      return { i, s };
    });
    expect(out).toEqual({ i: [{ title: "fixture a" }], s: [{ status: "ok" }] });
  });

  it("cannot insert into another household", async () => {
    const a = await tryQuery(db, authed(W), INS_ITEM, [id(1, 20), HA, "x"]);
    expect(a.error?.message).toMatch(/row-level security/);
    const b = await tryQuery(db, authed(W), INS_SUP, [id(2, 20), HA, "x"]);
    expect(b.error?.message).toMatch(/row-level security/);
  });

  it("household_id is immutable", async () => {
    for (const sql of [
      "update public.shopping_items set household_id=$2 where id=$1",
      "update public.supplies set household_id=$2 where id=$1",
    ]) {
      await db.query("begin");
      try {
        const target = sql.includes("shopping_items") ? SA : PA;
        await expect(db.query(sql, [target, HB])).rejects.toThrow(/immutable/);
      } finally {
        await db.query("rollback");
      }
    }
  });
});

describe("constraints", () => {
  it("rejects bad values", async () => {
    const bad: Array<[string, unknown[]]> = [
      ["insert into public.shopping_items (household_id, title) values ($1,'')", [HA]],
      ["insert into public.shopping_items (household_id, title) values ($1,$2)", [HA, "x".repeat(121)]],
      ["insert into public.shopping_items (household_id, title, quantity) values ($1,'t',$2)", [HA, "x".repeat(41)]],
      ["insert into public.shopping_items (household_id, title, shop) values ($1,'t',$2)", [HA, "x".repeat(61)]],
      ["insert into public.supplies (household_id, name) values ($1,'')", [HA]],
      ["insert into public.supplies (household_id, name) values ($1,$2)", [HA, "x".repeat(81)]],
      ["insert into public.supplies (household_id, name, location) values ($1,'n',$2)", [HA, "x".repeat(61)]],
      ["insert into public.supplies (household_id, name, notes) values ($1,'n',$2)", [HA, "x".repeat(301)]],
      ["insert into public.supplies (household_id, name, status) values ($1,'n','plenty')", [HA]],
    ];
    for (const [sql, params] of bad) {
      const r = await tryQuery(db, authed(U), sql, params);
      expect(r.error?.message, sql).toMatch(/violates check constraint/);
    }
  });

  it("supply names are unique per household, case-insensitively", async () => {
    const dup = await as(db, authed(U), async (c) => {
      await c.query(INS_SUP, [id(2, 30), HA, "Bin Bags"]);
      try {
        await c.query(INS_SUP, [id(2, 31), HA, "bin bags"]);
        return null;
      } catch (e) {
        return e as Error;
      }
    });
    expect(dup?.message).toMatch(/duplicate key|unique/);
    const other = await as(db, authed(W), async (c) => {
      await c.query(INS_SUP, [id(2, 32), HB, "Bin Bags"]);
      return true;
    });
    expect(other).toBe(true);
  });
});

describe("triggers", () => {
  it("sets done_at/done_by when done flips and clears them on undo", async () => {
    const out = await as(db, authed(V), async (c) => {
      const q = "select done, done_at is not null as has_at, done_by from public.shopping_items where id=$1";
      const before = (await c.query(q, [SA])).rows[0];
      await c.query("update public.shopping_items set done=true where id=$1", [SA]);
      const bought = (await c.query(q, [SA])).rows[0];
      await c.query("update public.shopping_items set done=false where id=$1", [SA]);
      const undone = (await c.query(q, [SA])).rows[0];
      return { before, bought, undone };
    });
    expect(out.before).toEqual({ done: false, has_at: false, done_by: null });
    expect(out.bought).toEqual({ done: true, has_at: true, done_by: V });
    expect(out.undone).toEqual({ done: false, has_at: false, done_by: null });
  });

  it("clients cannot spoof done_at/done_by or created_by", async () => {
    const out = await as(db, authed(U), async (c) => {
      await c.query(
        "insert into public.shopping_items (id, household_id, title, created_by, done, done_at, done_by) values ($1,$2,'s',$3,false,now(),$3)",
        [id(1, 40), HA, V],
      );
      const a = (await c.query("select created_by, done_at, done_by from public.shopping_items where id=$1", [id(1, 40)])).rows[0];
      await c.query("update public.shopping_items set done_by=$2, created_by=$2, title='s2' where id=$1", [SA, V]);
      const b = (await c.query("select created_by, done_by, title from public.shopping_items where id=$1", [SA])).rows[0];
      return { a, b };
    });
    expect(out.a).toEqual({ created_by: U, done_at: null, done_by: null });
    expect(out.b).toMatchObject({ created_by: null, done_by: null, title: "s2" });
  });

  it("last_checked_at is set only when status changes and cannot be spoofed", async () => {
    // Every comparison happens inside one query so replay-generated now() values cannot differ.
    const res = await as(db, authed(W), async (c) => {
      const q = "select status, last_checked_at from public.supplies where id=$1";
      const start = (await c.query(q, [PB])).rows[0];
      await c.query("update public.supplies set notes='note' where id=$1", [PB]);
      const noteOnly = (await c.query(q, [PB])).rows[0];
      await c.query("update public.supplies set status='low' where id=$1", [PB]);
      const low = (await c.query(q, [PB])).rows[0];
      await c.query("update public.supplies set last_checked_at='2000-01-01' where id=$1", [PB]);
      const spoof = (
        await c.query(
          "select status, last_checked_at is not null as set, last_checked_at > '2020-01-01' as recent, last_checked_at <= now() as not_future from public.supplies where id=$1",
          [PB],
        )
      ).rows[0];
      // Compare against the value after the status change inside one select (a temp copy lives in the same tx).
      await c.query("reset role");
      await c.query("create temp table lc_low on commit drop as select last_checked_at as v from public.supplies where id=$1", [PB]);
      await c.query("set local role authenticated");
      await c.query("update public.supplies set last_checked_at='1999-01-01' where id=$1", [PB]);
      await c.query("reset role");
      const same = (
        await c.query("select s.last_checked_at = l.v as unchanged from public.supplies s, lc_low l where s.id=$1", [PB])
      ).rows[0];
      return { start, noteOnly, low, spoof, same };
    });
    expect(res.start.last_checked_at).toBeNull();
    expect(res.noteOnly.last_checked_at).toBeNull();
    expect(res.low.status).toBe("low");
    expect(res.low.last_checked_at).not.toBeNull();
    expect(res.spoof).toEqual({ status: "low", set: true, recent: true, not_future: true });
    expect(res.same).toEqual({ unchanged: true });
  });

  it("a new supply starts unchecked even if the client sends last_checked_at", async () => {
    const r = await as(db, authed(U), async (c) => {
      await c.query("insert into public.supplies (id, household_id, name, last_checked_at) values ($1,$2,'Spoof',now())", [id(2, 50), HA]);
      return (await c.query("select last_checked_at from public.supplies where id=$1", [id(2, 50)])).rows[0];
    });
    expect(r).toEqual({ last_checked_at: null });
  });
});

describe("audit", () => {
  const audit = (c: Db, entity: string) =>
    c.query(
      "select action, actor_user_id, household_id, entity_type, summary, before, after from public.audit_log where entity_id=$1 order by id",
      [entity],
    );

  it("records shopping added, bought and removed with the title only", async () => {
    const rid = id(1, 60);
    const rows = await as(db, authed(U), async (c) => {
      await c.query(INS_ITEM, [rid, HA, "Milk"]);
      await c.query("update public.shopping_items set quantity='2' where id=$1", [rid]);
      await c.query("update public.shopping_items set done=true where id=$1", [rid]);
      await c.query("delete from public.shopping_items where id=$1", [rid]);
      return (await audit(c, rid)).rows;
    });
    expect(rows.map((r) => r.action)).toEqual(["shopping.added", "shopping.updated", "shopping.bought", "shopping.removed"]);
    for (const r of rows) {
      expect(r).toMatchObject({ actor_user_id: U, household_id: HA, entity_type: "shopping_item", summary: "Milk", before: null, after: null });
    }
  });

  it("records supply added, status_changed and removed with name and new status only", async () => {
    const rid = id(2, 60);
    const rows = await as(db, authed(U), async (c) => {
      await c.query(INS_SUP, [rid, HA, "Salt"]);
      await c.query("update public.supplies set status='out' where id=$1", [rid]);
      await c.query("update public.supplies set notes='n' where id=$1", [rid]);
      await c.query("delete from public.supplies where id=$1", [rid]);
      return (await audit(c, rid)).rows;
    });
    expect(rows.map((r) => [r.action, r.summary])).toEqual([
      ["supply.added", "Salt"],
      ["supply.status_changed", "Salt: out"],
      ["supply.updated", "Salt"],
      ["supply.removed", "Salt"],
    ]);
    for (const r of rows) expect(r).toMatchObject({ entity_type: "supply", household_id: HA, before: null, after: null });
  });

  it("audit entries are not visible to the other household", async () => {
    const r = await as(db, authed(W), async (c) => {
      await c.query(INS_ITEM, [id(1, 70), HB, "Private"]);
      return (await c.query("select id from public.audit_log where entity_id=$1 and household_id=$2", [id(1, 70), HA])).rows;
    });
    expect(r).toEqual([]);
  });
});
