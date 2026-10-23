import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "3ea10000-0000-4000-8000-0000000000a1";
const HB = "3ea10000-0000-4000-8000-0000000000b1";
const U = "3ea10000-0000-4000-8000-0000000000c1"; // HA
const V = "3ea10000-0000-4000-8000-0000000000c2"; // HA
const W = "3ea10000-0000-4000-8000-0000000000c3"; // HB

const id = (kind: number, n: number) => `3ea10000-0000-4000-8000-${String(kind * 1000 + n).padStart(12, "0")}`;
const MA = id(1, 1);
const MB = id(1, 2);
const IA = id(2, 1);
const IB = id(2, 2);
const PA = id(3, 1); // supply HA
const PB = id(3, 2); // supply HB

const INS_MEAL = "insert into public.meals (id, household_id, planned_on, title) values ($1,$2,'2026-10-20',$3)";
const INS_ING = "insert into public.meal_ingredients (id, household_id, meal_id, name) values ($1,$2,$3,$4)";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'MEAL-A'),($2,'MEAL-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u@meal.example.test',$1,'owner','U'),('v@meal.example.test',$1,'member','V'),('w@meal.example.test',$2,'owner','W')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1,'u@meal.example.test','{"provider":"google"}'),($2,'v@meal.example.test','{"provider":"google"}'),($3,'w@meal.example.test','{"provider":"google"}')`,
    [U, V, W],
  );
  await db.query(INS_MEAL, [MA, HA, "fixture a"]);
  await db.query(INS_MEAL, [MB, HB, "fixture b"]);
  await db.query(INS_ING, [IA, HA, MA, "Fixture A"]);
  await db.query(INS_ING, [IB, HB, MB, "Fixture B"]);
  await db.query("insert into public.supplies (id, household_id, name) values ($1,$2,'Sup A'),($3,$4,'Sup B')", [PA, HA, PB, HB]);
}, 60000);

afterAll(async () => {
  await db?.end();
});

describe("anon", () => {
  it("cannot touch either table", async () => {
    for (const t of ["meals", "meal_ingredients"]) {
      for (const sql of [`select * from public.${t}`, `update public.${t} set created_at=now()`, `delete from public.${t}`]) {
        const r = await tryQuery(db, { role: "anon" }, sql);
        expect(r.error?.message).toMatch(/permission denied/);
      }
    }
  });
});

describe("isolation", () => {
  it("members see only their own household rows", async () => {
    const a = await tryQuery(db, authed(U), "select id from public.meals where id in ($1,$2)", [MA, MB]);
    expect(a.rows).toEqual([{ id: MA }]);
    const b = await tryQuery(db, authed(W), "select id from public.meal_ingredients where id in ($1,$2)", [IA, IB]);
    expect(b.rows).toEqual([{ id: IB }]);
  });

  it("a member of the same household can update and delete", async () => {
    const out = await as(db, authed(V), async (c) => {
      await c.query("update public.meals set title='by v' where id=$1", [MA]);
      const t = (await c.query("select title from public.meals where id=$1", [MA])).rows;
      await c.query("delete from public.meals where id=$1", [MA]);
      const gone = (await c.query("select id from public.meal_ingredients where meal_id=$1", [MA])).rows;
      return { t, gone };
    });
    expect(out).toEqual({ t: [{ title: "by v" }], gone: [] }); // ingredients cascade
  });

  it("other household cannot update or delete", async () => {
    const out = await as(db, authed(W), async (c) => {
      await c.query("update public.meals set title='hacked' where id=$1", [MA]);
      await c.query("delete from public.meals where id=$1", [MA]);
      await c.query("update public.meal_ingredients set name='hacked' where id=$1", [IA]);
      await c.query("delete from public.meal_ingredients where id=$1", [IA]);
      await c.query("reset role");
      const m = (await c.query("select title from public.meals where id=$1", [MA])).rows;
      const i = (await c.query("select name from public.meal_ingredients where id=$1", [IA])).rows;
      return { m, i };
    });
    expect(out).toEqual({ m: [{ title: "fixture a" }], i: [{ name: "Fixture A" }] });
  });

  it("cannot insert into another household", async () => {
    const a = await tryQuery(db, authed(W), INS_MEAL, [id(1, 20), HA, "x"]);
    expect(a.error?.message).toMatch(/row-level security/);
    const b = await tryQuery(db, authed(W), INS_ING, [id(2, 20), HA, MA, "x"]);
    expect(b.error?.message).toMatch(/row-level security/);
  });

  it("household_id is immutable", async () => {
    for (const [sql, target] of [
      ["update public.meals set household_id=$2 where id=$1", MA],
      ["update public.meal_ingredients set household_id=$2 where id=$1", IA],
    ] as const) {
      await db.query("begin");
      try {
        await expect(db.query(sql, [target, HB])).rejects.toThrow(/immutable/);
      } finally {
        await db.query("rollback");
      }
    }
  });
});

describe("same-household guards", () => {
  it("an ingredient cannot point at another household's meal", async () => {
    const r = await tryQuery(db, authed(U), INS_ING, [id(2, 30), HA, MB, "x"]);
    expect(r.error?.message).toMatch(/meal not in this household/);
  });

  it("an ingredient cannot link another household's supply, on insert or update", async () => {
    const ins = await tryQuery(db, authed(U), "insert into public.meal_ingredients (household_id, meal_id, name, supply_id) values ($1,$2,'x',$3)", [HA, MA, PB]);
    expect(ins.error?.message).toMatch(/supply not in this household/);
    const upd = await tryQuery(db, authed(U), "update public.meal_ingredients set supply_id=$2 where id=$1", [IA, PB]);
    expect(upd.error?.message).toMatch(/supply not in this household/);
  });

  it("an ingredient can link its own household's supply, and unlinks when the supply is deleted", async () => {
    const out = await as(db, authed(U), async (c) => {
      await c.query("update public.meal_ingredients set supply_id=$2 where id=$1", [IA, PA]);
      const linked = (await c.query("select supply_id from public.meal_ingredients where id=$1", [IA])).rows[0];
      await c.query("delete from public.supplies where id=$1", [PA]);
      const after = (await c.query("select supply_id from public.meal_ingredients where id=$1", [IA])).rows[0];
      return { linked, after };
    });
    expect(out).toEqual({ linked: { supply_id: PA }, after: { supply_id: null } });
  });
});

describe("constraints", () => {
  it("rejects bad values", async () => {
    const bad: Array<[string, unknown[]]> = [
      ["insert into public.meals (household_id, planned_on, title) values ($1,'2026-10-20','')", [HA]],
      ["insert into public.meals (household_id, planned_on, title) values ($1,'2026-10-20',$2)", [HA, "x".repeat(81)]],
      ["insert into public.meals (household_id, planned_on, title, notes) values ($1,'2026-10-20','t',$2)", [HA, "x".repeat(301)]],
      ["insert into public.meals (household_id, planned_on, title, slot) values ($1,'2026-10-20','t','breakfast')", [HA]],
      ["insert into public.meal_ingredients (household_id, meal_id, name) values ($1,$2,'')", [HA, MA]],
      ["insert into public.meal_ingredients (household_id, meal_id, name) values ($1,$2,$3)", [HA, MA, "x".repeat(61)]],
      ["insert into public.meal_ingredients (household_id, meal_id, name, quantity) values ($1,$2,'n',$3)", [HA, MA, "x".repeat(31)]],
      ["insert into public.meal_ingredients (household_id, meal_id, name, unit_price_estimate) values ($1,$2,'n',-1)", [HA, MA]],
    ];
    for (const [sql, params] of bad) {
      const r = await tryQuery(db, authed(U), sql, params);
      expect(r.error?.message, sql).toMatch(/violates check constraint/);
    }
  });

  it("slot defaults to dinner and price may be null", async () => {
    const r = await as(db, authed(U), async (c) => {
      await c.query(INS_MEAL, [id(1, 40), HA, "Default"]);
      await c.query(INS_ING, [id(2, 40), HA, id(1, 40), "Beans"]);
      const m = (await c.query("select slot from public.meals where id=$1", [id(1, 40)])).rows[0];
      const i = (await c.query("select unit_price_estimate from public.meal_ingredients where id=$1", [id(2, 40)])).rows[0];
      return { m, i };
    });
    expect(r).toEqual({ m: { slot: "dinner" }, i: { unit_price_estimate: null } });
  });
});

describe("audit", () => {
  it("records meal created, updated and deleted with the title only", async () => {
    const rid = id(1, 60);
    const rows = await as(db, authed(U), async (c) => {
      await c.query(INS_MEAL, [rid, HA, "Risotto"]);
      await c.query("insert into public.meal_ingredients (household_id, meal_id, name, unit_price_estimate) values ($1,$2,'Rice',4.5)", [HA, rid]);
      await c.query("update public.meals set notes='n' where id=$1", [rid]);
      await c.query("delete from public.meals where id=$1", [rid]);
      return (
        await c.query(
          "select action, actor_user_id, household_id, entity_type, summary, before, after from public.audit_log where entity_id=$1 order by id",
          [rid],
        )
      ).rows;
    });
    expect(rows.map((r) => [r.action, r.summary])).toEqual([
      ["meal.created", "Risotto"],
      ["meal.updated", "Risotto"],
      ["meal.deleted", "Risotto"],
    ]);
    for (const r of rows) expect(r).toMatchObject({ actor_user_id: U, household_id: HA, entity_type: "meal", before: null, after: null });
    expect(JSON.stringify(rows)).not.toMatch(/4\.5|Rice/);
  });
});
