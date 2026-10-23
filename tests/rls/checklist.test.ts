import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "5c0c0000-0000-4000-8000-0000000000a1";
const HB = "5c0c0000-0000-4000-8000-0000000000b1";
const U = "5c0c0000-0000-4000-8000-0000000000c1"; // HA
const W = "5c0c0000-0000-4000-8000-0000000000c3"; // HB
const IA = "5c0c0000-0000-4000-8000-000000001001";
const IB = "5c0c0000-0000-4000-8000-000000001002";
const RB = "5c0c0000-0000-4000-8000-000000002002"; // room in HB

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'CL-A'),($2,'CL-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u@cl.example.test',$1,'owner','U'),('w@cl.example.test',$2,'owner','W')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1,'u@cl.example.test','{"provider":"google"}'),($2,'w@cl.example.test','{"provider":"google"}')`,
    [U, W],
  );
  await db.query(`insert into public.rooms (id, household_id, name) values ($1,$2,'CL room b')`, [RB, HB]);
  await db.query(
    `insert into public.checklist_items (id, household_id, title, frequency, month) values ($1,$2,'Fixture a','yearly',10),($3,$4,'Fixture b','yearly',10)`,
    [IA, HA, IB, HB],
  );
}, 60000);

afterAll(async () => {
  await db?.end();
});

describe("access", () => {
  it("anon is denied", async () => {
    const r = await tryQuery(db, { role: "anon" }, "select * from public.checklist_items");
    expect(r.error?.message).toMatch(/permission denied/);
  });

  it("RLS is enabled and forced", async () => {
    const r = await db.query("select relrowsecurity, relforcerowsecurity from pg_class where relname = 'checklist_items'");
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("members see only their own household", async () => {
    const a = await tryQuery(db, authed(U), "select id from public.checklist_items where id in ($1,$2)", [IA, IB]);
    expect(a.rows).toEqual([{ id: IA }]);
  });

  it("cannot write into, update or delete another household", async () => {
    const ins = await tryQuery(db, authed(U), "insert into public.checklist_items (household_id, title, frequency) values ($1,'x','monthly')", [HB]);
    expect(ins.error?.message).toMatch(/row-level security/);
    const upd = await tryQuery(db, authed(U), "update public.checklist_items set notes='hi' where id=$1 returning id", [IB]);
    expect(upd.rows ?? []).toEqual([]);
    const del = await tryQuery(db, authed(U), "delete from public.checklist_items where id=$1 returning id", [IB]);
    expect(del.rows ?? []).toEqual([]);
  });

  it("rejects a room from another household", async () => {
    const r = await tryQuery(db, authed(U), "insert into public.checklist_items (household_id, title, frequency, room_id) values ($1,'Room test','monthly',$2)", [HA, RB]);
    expect(r.error?.message).toMatch(/room not in this household/);
  });
});

describe("next_due_on", () => {
  const calc = (n: number, frequency: string, month: number | null, last: string | null) =>
    as(db, authed(U), async (c) => {
      const id = `5c0c0000-0000-4000-8000-${String(3000 + n).padStart(12, "0")}`;
      await c.query(
        "insert into public.checklist_items (id, household_id, title, frequency, month, last_done_on) values ($1,$2,$3,$4,$5,$6)",
        [id, HA, `Calc ${n}`, frequency, month, last],
      );
      return (await c.query("select next_due_on::text as d from public.checklist_items where id=$1", [id])).rows[0] as { d: string | null };
    });

  it("yearly with a month is the 1st of that month, a year on after being done", async () => {
    expect((await calc(1, "yearly", 10, "2026-10-22")).d).toBe("2027-10-01");
    expect((await calc(2, "yearly", 10, "2026-09-05")).d).toBe("2027-10-01");
    expect((await calc(3, "yearly", 10, "2025-12-01")).d).toBe("2026-10-01");
  });

  it("monthly is a month after being done", async () => {
    expect((await calc(4, "monthly", null, "2026-10-22")).d).toBe("2026-11-22");
  });

  it("yearly without a month is a year after, or empty when never done", async () => {
    expect((await calc(5, "yearly", null, "2026-03-04")).d).toBe("2027-03-04");
    expect((await calc(6, "yearly", null, null)).d).toBeNull();
  });

  it("is recomputed when marked done, and a client cannot set it", async () => {
    const out = await as(db, authed(U), async (c) => {
      await c.query("update public.checklist_items set last_done_on='2026-10-22', next_due_on='2030-01-01' where id=$1", [IA]);
      return (await c.query("select next_due_on::text as d from public.checklist_items where id=$1", [IA])).rows[0] as { d: string };
    });
    expect(out.d).toBe("2027-10-01");
  });

  it("writes audit rows with the title only", async () => {
    const rows = await as(db, authed(U), async (c) => {
      await c.query("update public.checklist_items set last_done_on='2026-10-22' where id=$1", [IA]);
      return (await c.query("select action, summary from public.audit_log where entity_type='checklist_item' and entity_id=$1", [IA])).rows;
    });
    expect(rows).toContainEqual({ action: "checklist.done", summary: "Fixture a" });
  });
});

describe("seed", () => {
  it("is idempotent per household and title", async () => {
    const r = await db.query(
      "select count(*)::int as n from (select household_id, lower(title) from public.checklist_items group by 1,2 having count(*) > 1) d",
    );
    expect(r.rows[0]).toEqual({ n: 0 });
  });
});
