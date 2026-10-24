import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient } from "./helpers";
import { run } from "./multi-household-helpers";

const id = (n: number) => `90610000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const H1 = id(1), H2 = id(2);
const A = id(11), B = id(12), C = id(13), D = id(14), E = id(15); // A,B,C(removed),D in H1; E in H2
const T = (n: number) => id(100 + n);

let db: Db;
const anon = async (sql: string, p: unknown[]) => {
  await db.query("begin");
  try {
    await db.query("set local role anon");
    await db.query(sql, p);
    return { error: null as Error | null };
  } catch (e) {
    return { error: e as Error };
  } finally {
    await db.query("rollback");
  }
};
const who = (u: string) => ({ sub: u, email: `${u.slice(-2)}@nudge.example.test` });
const nudge = (u: string, t: string) => run(db, who(u), "select * from public.nudge_task($1)", [t], true);
const read = (u: string, sql: string, p: unknown[] = []) => run(db, who(u), sql, p);
const addTask = (n: number, o: { hh?: string; assignee?: string | null; status?: string } = {}) =>
  db.query("insert into public.tasks (id, household_id, title, assignee_user_id, status) values ($1,$2,$3,$4,$5)", [
    T(n), o.hh ?? H1, `Chore ${n}`, o.assignee === undefined ? B : o.assignee, o.status ?? "open",
  ]);

beforeAll(async () => {
  db = await adminClient();
  await db.query("insert into public.households (id, name) values ($1,'NUDGE-1'),($2,'NUDGE-2')", [H1, H2]);
  for (const [u, n] of [[A, "a"], [B, "b"], [C, "c"], [D, "d"], [E, "e"]]) {
    await db.query("insert into auth.users (id, email, raw_app_meta_data) values ($1,$2,'{\"provider\":\"google\"}')", [u, `${n}@nudge.example.test`]);
  }
  await db.query(
    `insert into public.household_members (household_id, user_id, role, display_name, status) values
     ($1,$2,'owner','Ann','active'),($1,$3,'member','Bob','active'),($1,$4,'member','Cat','active'),($1,$5,'member','Dan','active'),($6,$7,'owner','Eve','active')
     on conflict (household_id, user_id) do update set status = excluded.status, display_name = excluded.display_name`,
    [H1, A, B, C, D, H2, E],
  );
  await db.query(
    "insert into public.push_subscriptions (household_id, user_id, endpoint, p256dh, auth) values ($1,$2,'https://p.test/b','k','a'),($1,$3,'https://p.test/a','k','a')",
    [H1, B, A],
  );
}, 30000);
afterAll(async () => db?.end());

describe("nudge_task", () => {
  it("anon cannot call it", async () => {
    expect((await anon("select * from public.nudge_task($1)", [T(0)])).error?.message).toMatch(/permission denied/);
  });

  it("notifies the assignee only, privately, and logs it", async () => {
    await addTask(1);
    const r = await nudge(A, T(1));
    expect(r.error).toBeNull();
    expect(r.rows[0]).toMatchObject({ recipient_user_id: B, title: "Chore 1" });
    const n = await db.query("select * from public.notifications where kind='chore_nudge' and dedupe_key = 'nudge:' || $1", [r.rows[0].nudge_id]);
    expect(n.rows[0]).toMatchObject({ recipient_user_id: B, household_id: H1, title: "Ann nudged you: Chore 1", link: "/tasks" });
    // Not visible to the sender or another member; visible to the recipient.
    const seen = (u: string) => read(u, "select id from public.notifications where kind='chore_nudge'");
    expect((await seen(B)).rows).toHaveLength(1);
    expect((await seen(A)).rows).toHaveLength(0);
    expect((await seen(D)).rows).toHaveLength(0);
  });

  it("refuses unassigned, self, removed assignee, closed, other household, missing", async () => {
    await addTask(2, { assignee: null });
    await addTask(3, { assignee: A });
    await addTask(4, { assignee: C });
    await db.query("update public.household_members set status='removed' where user_id=$1", [C]);
    await addTask(5, { status: "done" });
    await addTask(6, { hh: H2, assignee: E });
    const msg = async (u: string, t: string) => (await nudge(u, t)).error?.message;
    expect(await msg(A, T(2))).toMatch(/not assigned/);
    expect(await msg(A, T(3))).toMatch(/yourself/);
    expect(await msg(A, T(4))).toMatch(/not an active member/);
    expect(await msg(A, T(5))).toMatch(/closed/);
    expect(await msg(A, T(6))).toMatch(/not found/);
    expect(await msg(A, id(999))).toMatch(/not found/);
    // A removed member cannot nudge either.
    expect(await msg(C, T(1))).toMatch(/not found/);
  });

  it("allows one nudge per task per 30 minutes, then again after", async () => {
    await addTask(7);
    expect((await nudge(A, T(7))).error).toBeNull();
    expect((await nudge(A, T(7))).error?.message).toMatch(/rate limit reached/);
    expect((await nudge(D, T(7))).error?.message).toMatch(/rate limit reached/);
    await db.query("update private.chore_nudges set created_at = now() - interval '31 minutes' where task_id = $1", [T(7)]);
    expect((await nudge(A, T(7))).error).toBeNull();
  });

  it("caps a user at 20 nudges per rolling day", async () => {
    // D has sent none yet: 19 old-ish rows on other tasks, then 1 real, then refuse.
    for (let i = 0; i < 19; i++) {
      await db.query("insert into private.chore_nudges (household_id, task_id, sender_user_id, recipient_user_id, created_at) values ($1,$2,$3,$4, now() - interval '2 hours')", [H1, T(1), D, B]);
    }
    await addTask(8);
    expect((await nudge(D, T(8))).error).toBeNull();
    await addTask(9);
    expect((await nudge(D, T(9))).error?.message).toMatch(/rate limit reached/);
    await db.query("update private.chore_nudges set created_at = now() - interval '25 hours' where sender_user_id = $1", [D]);
    expect((await nudge(D, T(9))).error).toBeNull();
  });

  it("the log table is private", async () => {
    expect((await read(A, "select * from private.chore_nudges")).error?.message).toMatch(/permission denied/);
  });
});

describe("nudge_push_targets", () => {
  it("gives the sender only the recipient's devices for their own fresh nudge", async () => {
    await addTask(10);
    const n = (await nudge(A, T(10))).rows[0].nudge_id as string;
    const q = (u: string) => read(u, "select endpoint from public.nudge_push_targets($1)", [n]);
    expect((await q(B)).rows).toEqual([]); // the recipient is not the sender
    expect((await q(D)).rows).toEqual([]);
    expect((await q(E)).rows).toEqual([]);
    expect((await q(A)).rows).toEqual([{ endpoint: "https://p.test/b" }]);
    // Single use: two reads in one transaction (read() rolls back after each call) give the devices once.
    const twice = await read(A, "select count(*)::int as n from public.nudge_push_targets($1) union all select count(*)::int from public.nudge_push_targets($1)", [n]);
    expect(twice.rows.map((r) => r.n).sort()).toEqual([0, 1]);
  });

  it("returns nothing once the nudge is older than 5 minutes", async () => {
    await addTask(11);
    const n = (await nudge(A, T(11))).rows[0].nudge_id as string;
    await db.query("update private.chore_nudges set created_at = now() - interval '10 minutes' where id = $1", [n]);
    expect((await read(A, "select endpoint from public.nudge_push_targets($1)", [n])).rows).toEqual([]);
    expect((await anon("select * from public.nudge_push_targets($1)", [n])).error?.message).toMatch(/permission denied/);
  });
});
