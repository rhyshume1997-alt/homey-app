import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed } from "./helpers";

// Own fixture ids: independent of the other RLS test files.
const H5 = "55555555-5555-4555-8555-555555555555";
const H6 = "66666666-6666-4666-8666-666666666666";
const U = "b1b1b1b1-0000-4000-8000-0000000000b1"; // member of H5
const V = "b2b2b2b2-0000-4000-8000-0000000000b2"; // member of H5
const W = "b3b3b3b3-0000-4000-8000-0000000000b3"; // member of H6

const rid = (n: number) => `4ec00000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'RC-H5'),($2,'RC-H6')`, [H5, H6]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u@recur.example.test',$1,'owner','U'),('v@recur.example.test',$1,'member','V'),('w@recur.example.test',$2,'owner','W')`,
    [H5, H6],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values
    ($1,'u@recur.example.test','{"provider":"google"}'),($2,'v@recur.example.test','{"provider":"google"}'),($3,'w@recur.example.test','{"provider":"google"}')`,
    [U, V, W],
  );
}, 30000);

afterAll(async () => {
  await db?.end();
});

const NEXT_SQL = `select n.id, n.household_id, n.title, n.notes, n.assignee_user_id, n.recurrence, n.status, n.created_by,
  n.due_date::text as due_date, n.next_task_id from public.tasks t join public.tasks n on n.id = t.next_task_id where t.id = $1`;

const asClaims = (c: Db, sub: string) =>
  c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: "authenticated" })]);

async function spawn(recurrence: string, due: string | null, n: number) {
  const id = rid(n);
  return as(db, authed(U), async (c) => {
    await c.query(
      `insert into public.tasks (id, household_id, title, notes, assignee_user_id, due_date, recurrence)
       values ($1,$2,$3,'some notes',$4,$5,$6)`,
      [id, H5, `Recurring ${n}`, V, due, recurrence],
    );
    await c.query("update public.tasks set status='done' where id=$1", [id]);
    return (await c.query(NEXT_SQL, [id])).rows;
  });
}

describe("recurring date math", () => {
  const cases: [string, string, string][] = [
    ["daily", "2027-03-10", "2027-03-11"],
    ["daily", "2027-12-31", "2028-01-01"],
    ["weekly", "2027-03-10", "2027-03-17"],
    ["weekly", "2027-12-28", "2028-01-04"],
    ["monthly", "2027-03-10", "2027-04-10"],
    ["monthly", "2027-01-31", "2027-02-28"],
    ["monthly", "2028-01-31", "2028-02-29"],
    ["monthly", "2027-12-15", "2028-01-15"],
    ["yearly", "2027-05-01", "2028-05-01"],
    ["yearly", "2028-02-29", "2029-02-28"],
    ["yearly", "2027-12-31", "2028-12-31"],
  ];
  cases.forEach(([rec, due, expected], i) => {
    it(`${rec} ${due} -> ${expected}`, async () => {
      const rows = await spawn(rec, due, 100 + i);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        due_date: expected,
        household_id: H5,
        title: `Recurring ${100 + i}`,
        notes: "some notes",
        assignee_user_id: V,
        recurrence: rec,
        status: "open",
        created_by: U,
        next_task_id: null,
      });
    });
  });

  it("null due date uses today in Europe/London", async () => {
    for (const [i, rec, days] of [
      [0, "daily", 1],
      [1, "weekly", 7],
    ] as const) {
      const id = rid(200 + i);
      const rows = await as(db, authed(U), async (c) => {
        await c.query("insert into public.tasks (id, household_id, title, recurrence) values ($1,$2,'No due',$3)", [id, H5, rec]);
        await c.query("update public.tasks set status='done' where id=$1", [id]);
        return (
          await c.query(
            `select (n.due_date = (now() at time zone 'Europe/London')::date + ${days}) as ok
             from public.tasks t join public.tasks n on n.id = t.next_task_id where t.id = $1`,
            [id],
          )
        ).rows;
      });
      expect(rows).toEqual([{ ok: true }]);
    }
  });
});

describe("spawn rules", () => {
  it("recurrence none spawns nothing", async () => {
    const id = rid(300);
    const out = await as(db, authed(U), async (c) => {
      await c.query("insert into public.tasks (id, household_id, title) values ($1,$2,'One-off none')", [id, H5]);
      await c.query("update public.tasks set status='done' where id=$1", [id]);
      return {
        next: (await c.query("select next_task_id from public.tasks where id=$1", [id])).rows,
        count: (await c.query("select count(*)::int as n from public.tasks where title='One-off none'")).rows,
      };
    });
    expect(out.next).toEqual([{ next_task_id: null }]);
    expect(out.count).toEqual([{ n: 1 }]);
  });

  it("completing twice or reopen then complete spawns once; reopen keeps the spawned task", async () => {
    const id = rid(310);
    const out = await as(db, authed(U), async (c) => {
      await c.query(
        "insert into public.tasks (id, household_id, title, due_date, recurrence) values ($1,$2,'Once only','2027-05-01','daily')",
        [id, H5],
      );
      await c.query("update public.tasks set status='done' where id=$1", [id]);
      const first = (await c.query("select next_task_id from public.tasks where id=$1", [id])).rows[0];
      await c.query("update public.tasks set status='done' where id=$1", [id]);
      await c.query("update public.tasks set status='open' where id=$1", [id]);
      const afterReopen = (await c.query("select count(*)::int as n from public.tasks where title='Once only'")).rows[0];
      await c.query("update public.tasks set status='done' where id=$1", [id]);
      // Same-query check: the link still points at the one spawned row (ids differ per remote replay).
      const last = (
        await c.query(
          "select (t.next_task_id = n.id) as same from public.tasks t join public.tasks n on n.title = t.title and n.id <> t.id where t.id=$1",
          [id],
        )
      ).rows;
      const count = (await c.query("select count(*)::int as n from public.tasks where title='Once only'")).rows[0];
      return { first, afterReopen, last, count };
    });
    expect(out.first?.next_task_id).toBeTruthy();
    expect(out.afterReopen).toEqual({ n: 2 });
    expect(out.last).toEqual([{ same: true }]);
    expect(out.count).toEqual({ n: 2 });
  });

  it("the spawned task can itself recur when completed", async () => {
    const id = rid(320);
    const rows = await as(db, authed(V), async (c) => {
      await c.query(
        "insert into public.tasks (id, household_id, title, due_date, recurrence) values ($1,$2,'Chain','2027-06-01','weekly')",
        [id, H5],
      );
      await c.query("update public.tasks set status='done' where id=$1", [id]);
      await c.query("update public.tasks set status='done' where id=(select next_task_id from public.tasks where id=$1)", [id]);
      return (
        await c.query(
          `select n2.due_date::text as due_date, n2.created_by from public.tasks t
           join public.tasks n1 on n1.id=t.next_task_id join public.tasks n2 on n2.id=n1.next_task_id where t.id=$1`,
          [id],
        )
      ).rows;
    });
    expect(rows).toEqual([{ due_date: "2027-06-15", created_by: V }]);
  });

  it("created_by is the completer, not the original creator", async () => {
    const id = rid(330);
    const rows = await as(db, authed(U), async (c) => {
      await c.query("insert into public.tasks (id, household_id, title, recurrence) values ($1,$2,'Who completes','daily')", [id, H5]);
      await asClaims(c, V);
      await c.query("update public.tasks set status='done' where id=$1", [id]);
      return (await c.query(NEXT_SQL, [id])).rows;
    });
    expect(rows[0]).toMatchObject({ created_by: V });
  });
});

describe("next_task_id is read-only to clients", () => {
  it("ignores client updates and inserts", async () => {
    const a = rid(400);
    const b = rid(401);
    const out = await as(db, authed(U), async (c) => {
      await c.query("insert into public.tasks (id, household_id, title) values ($1,$2,'Target')", [b, H5]);
      await c.query("insert into public.tasks (id, household_id, title, next_task_id) values ($1,$2,'Forged insert',$3)", [a, H5, b]);
      const afterInsert = (await c.query("select next_task_id from public.tasks where id=$1", [a])).rows[0];
      await c.query("update public.tasks set next_task_id=$2, title='Forged update' where id=$1", [a, b]);
      const afterUpdate = (await c.query("select next_task_id, title from public.tasks where id=$1", [a])).rows[0];
      return { afterInsert, afterUpdate };
    });
    expect(out.afterInsert).toEqual({ next_task_id: null });
    expect(out.afterUpdate).toEqual({ next_task_id: null, title: "Forged update" });
  });

  it("a client cannot clear a spawned link to force a duplicate", async () => {
    const id = rid(410);
    const n = await as(db, authed(U), async (c) => {
      await c.query("insert into public.tasks (id, household_id, title, recurrence) values ($1,$2,'No dup','daily')", [id, H5]);
      await c.query("update public.tasks set status='done' where id=$1", [id]);
      await c.query("update public.tasks set next_task_id=null, status='open' where id=$1", [id]);
      await c.query("update public.tasks set next_task_id=null, status='done' where id=$1", [id]);
      return (await c.query("select count(*)::int as n from public.tasks where title='No dup'")).rows[0];
    });
    expect(n).toEqual({ n: 2 });
  });
});

describe("isolation and audit", () => {
  it("spawned task is visible only to the same household", async () => {
    const id = rid(500);
    const out = await as(db, authed(U), async (c) => {
      await c.query("insert into public.tasks (id, household_id, title, recurrence) values ($1,$2,'Isolated','daily')", [id, H5]);
      await c.query("update public.tasks set status='done' where id=$1", [id]);
      const own = (await c.query("select count(*)::int as n from public.tasks where title='Isolated'")).rows[0];
      await asClaims(c, V);
      const sameHousehold = (await c.query("select count(*)::int as n from public.tasks where title='Isolated'")).rows[0];
      await asClaims(c, W);
      const other = (await c.query("select count(*)::int as n from public.tasks where title='Isolated'")).rows[0];
      return { own, sameHousehold, other };
    });
    expect(out).toEqual({ own: { n: 2 }, sameHousehold: { n: 2 }, other: { n: 0 } });
  });

  it("spawn is audited as task.created with actor = completer", async () => {
    const id = rid(510);
    const rows = await as(db, authed(U), async (c) => {
      await c.query("insert into public.tasks (id, household_id, title, recurrence) values ($1,$2,'Audited spawn','daily')", [id, H5]);
      await asClaims(c, V);
      await c.query("update public.tasks set status='done' where id=$1", [id]);
      return (
        await c.query(
          `select a.action, a.actor_user_id, a.household_id, a.entity_type, a.summary
           from public.tasks t join public.audit_log a on a.entity_id = t.next_task_id::text
           where t.id=$1 order by a.id`,
          [id],
        )
      ).rows;
    });
    expect(rows).toEqual([{ action: "task.created", actor_user_id: V, household_id: H5, entity_type: "task", summary: "Audited spawn" }]);
  });

  it("trigger function is not executable by API roles", async () => {
    const r = await db.query(
      `select has_function_privilege('authenticated','private.spawn_next_task()','execute') as a,
              has_function_privilege('anon','private.spawn_next_task()','execute') as b`,
    );
    expect(r.rows[0]).toEqual({ a: false, b: false });
  });
});

describe("assignee who left the household (review S3)", () => {
  it("does not block completion; the next occurrence is unassigned", async () => {
    const id = rid(900);
    const rows = await as(db, authed(U), async (c) => {
      await c.query(
        `insert into public.tasks (id, household_id, title, assignee_user_id, due_date, recurrence)
         values ($1,$2,'Left member chore',$3,'2027-05-01','weekly')`,
        [id, H5, V],
      );
      await c.query("reset role");
      await c.query("delete from public.household_members where household_id=$1 and user_id=$2", [H5, V]);
      await c.query("set local role authenticated");
      await asClaims(c, U);
      await c.query("update public.tasks set status='done' where id=$1", [id]);
      return (await c.query(NEXT_SQL, [id])).rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ assignee_user_id: null, due_date: "2027-05-08", status: "open" });
  });
});

describe("room is kept", () => {
  it("the next occurrence keeps the completed task's room", async () => {
    const id = rid(900);
    const room = "4ec00000-0000-4000-8000-0000000009aa";
    const rows = await as(db, authed(U), async (c) => {
      await c.query("insert into public.rooms (id, household_id, name) values ($1,$2,'RC Kitchen')", [room, H5]);
      await c.query(
        "insert into public.tasks (id, household_id, title, recurrence, due_date, room_id) values ($1,$2,'Roomy',$3,'2027-03-10',$4)",
        [id, H5, "yearly", room],
      );
      await c.query("update public.tasks set status='done' where id=$1", [id]);
      return (await c.query("select n.room_id, n.due_date::text as due_date from public.tasks t join public.tasks n on n.id = t.next_task_id where t.id = $1", [id])).rows;
    });
    expect(rows).toEqual([{ room_id: room, due_date: "2028-03-10" }]);
  });
});
