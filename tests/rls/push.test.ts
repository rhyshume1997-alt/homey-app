import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const H1 = "90540000-0000-4000-8000-0000000000a1";
const H2 = "90540000-0000-4000-8000-0000000000a2";
const U1 = "90540000-0000-4000-8000-0000000000b1"; // H1
const U2 = "90540000-0000-4000-8000-0000000000b2"; // H1
const U3 = "90540000-0000-4000-8000-0000000000b3"; // H2
const S1 = "90540000-0000-4000-8000-0000000000c1";
const S2 = "90540000-0000-4000-8000-0000000000c2";

const INS = "insert into public.push_subscriptions (id, household_id, user_id, endpoint, p256dh, auth) values ($1,$2,$3,$4,'k','a')";
let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'PUSH-1'),($2,'PUSH-2')`, [H1, H2]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u1@push.example.test',$1,'owner','U1'),('u2@push.example.test',$1,'member','U2'),('u3@push.example.test',$2,'owner','U3')`,
    [H1, H2],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values
    ($1,'u1@push.example.test','{"provider":"google"}'),($2,'u2@push.example.test','{"provider":"google"}'),($3,'u3@push.example.test','{"provider":"google"}')`,
    [U1, U2, U3],
  );
  await db.query(INS, [S1, H1, U1, "https://fcm.googleapis.com/fcm/send/one"]);
  await db.query(INS, [S2, H1, U2, "https://fcm.googleapis.com/fcm/send/two"]);
}, 30000);

afterAll(async () => db?.end());

describe("push_subscriptions", () => {
  it("anon has no access", async () => {
    for (const sql of ["select * from public.push_subscriptions", "delete from public.push_subscriptions"]) {
      expect((await tryQuery(db, { role: "anon" }, sql)).error?.message).toMatch(/permission denied/);
    }
  });

  it("a user sees only their own rows, even within the household", async () => {
    const r = await tryQuery(db, authed(U1), "select id from public.push_subscriptions");
    expect(r.rows).toEqual([{ id: S1 }]);
    expect((await tryQuery(db, authed(U3), "select id from public.push_subscriptions")).rows).toEqual([]);
  });

  it("insert works for self only, in own household, https only", async () => {
    const ins = (u: string, h: string, ep: string) => tryQuery(db, authed(u), INS, [crypto.randomUUID(), h, u, ep]);
    expect((await ins(U1, H1, "https://fcm.googleapis.com/fcm/send/new")).error).toBeNull();
    expect((await ins(U1, H2, "https://fcm.googleapis.com/fcm/send/x1")).error?.message).toMatch(/row-level security/);
    expect((await tryQuery(db, authed(U1), INS, [crypto.randomUUID(), H1, U2, "https://fcm.googleapis.com/fcm/send/x2"])).error?.message).toMatch(/row-level security/);
    expect((await ins(U1, H1, "http://push.example.test/x3")).error?.message).toMatch(/check constraint/);
    expect((await ins(U1, H1, `https://fcm.googleapis.com/fcm/send/${"a".repeat(1000)}`)).error?.message).toMatch(/check constraint/);
    expect((await ins(U1, H1, "https://fcm.googleapis.com/fcm/send/two")).error?.message).toMatch(/duplicate key/);
  });

  it("users cannot update rows directly", async () => {
    const r = await tryQuery(db, authed(U1), "update public.push_subscriptions set failure_count = 9");
    expect(r.error?.message).toMatch(/permission denied/);
  });

  it("delete only affects own rows", async () => {
    // The remote harness does not return rows from non-select statements, so verify by reading state afterwards.
    const left = await as(db, authed(U1), async (c) => {
      await c.query("delete from public.push_subscriptions where id = $1", [S1]);
      await c.query("delete from public.push_subscriptions where id = $1", [S2]);
      await c.query("reset role");
      return (await c.query("select id from public.push_subscriptions where id in ($1,$2) order by id", [S1, S2])).rows;
    });
    expect(left).toEqual([{ id: S2 }]);
  });

  it("push_record_result updates only the caller's own subscription", async () => {
    const fc = await as(db, authed(U1), async (c) => {
      await c.query("select public.push_record_result($1, false)", [S1]);
      return (await c.query("select failure_count from public.push_subscriptions where id = $1", [S1])).rows;
    });
    expect(fc).toEqual([{ failure_count: 1 }]);
    await tryQuery(db, authed(U1), "select public.push_record_result($1, false)", [S2]);
    const { rows } = await db.query("select failure_count from public.push_subscriptions where id = $1", [S2]);
    expect(rows).toEqual([{ failure_count: 0 }]);
    expect((await tryQuery(db, { role: "anon" }, "select public.push_record_result($1, true)", [S1])).error?.message).toMatch(/permission denied/);
  });
});
