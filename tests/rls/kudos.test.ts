import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, authed, tryQuery } from "./helpers";

const HA = "40720000-0000-4000-8000-0000000000a1";
const HB = "40720000-0000-4000-8000-0000000000a2";
const U1 = "40720000-0000-4000-8000-0000000000b1"; // HA
const U2 = "40720000-0000-4000-8000-0000000000b2"; // HA
const U3 = "40720000-0000-4000-8000-0000000000b3"; // HB

let db: Db;
let auditA = 0;
let auditB = 0;

const INS = "insert into public.kudos (household_id, from_user, to_user, audit_id, message) values ($1,$2,$3,$4,$5)";

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'KUDOS-A'),($2,'KUDOS-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u1@kudos.example.test',$1,'owner','U1'),('u2@kudos.example.test',$1,'member','U2'),('u3@kudos.example.test',$2,'owner','U3')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values
    ($1,'u1@kudos.example.test','{"provider":"google"}'),($2,'u2@kudos.example.test','{"provider":"google"}'),($3,'u3@kudos.example.test','{"provider":"google"}')`,
    [U1, U2, U3],
  );
  const a = await db.query(
    `insert into public.audit_log (household_id, actor_user_id, action, entity_type, summary) values ($1,$2,'task.completed','task','Bins') returning id`,
    [HA, U2],
  );
  const b = await db.query(
    `insert into public.audit_log (household_id, actor_user_id, action, entity_type, summary) values ($1,$2,'task.completed','task','B task') returning id`,
    [HB, U3],
  );
  auditA = Number((a.rows[0] as { id: string }).id);
  auditB = Number((b.rows[0] as { id: string }).id);
}, 30000);

afterAll(async () => {
  await db?.end();
});

describe("kudos", () => {
  it("anon is denied", async () => {
    const sel = await tryQuery(db, { role: "anon" }, "select * from public.kudos");
    expect(sel.error).not.toBeNull();
    const ins = await tryQuery(db, { role: "anon" }, INS, [HA, U1, U2, null, "hi"]);
    expect(ins.error).not.toBeNull();
  });

  it("a member can thank the other member and from_user is the caller", async () => {
    const r = await tryQuery(db, authed(U1), `${INS} returning from_user`, [HA, U1, U2, auditA, "Thanks 💜"]);
    expect(r.error).toBeNull();
    expect((r.rows[0] as { from_user: string }).from_user).toBe(U1);
  });

  it("cannot spoof from_user (forced to auth.uid())", async () => {
    const r = await tryQuery(db, authed(U1), `${INS} returning from_user`, [HA, U2, U1, null, "spoof"]);
    // The trigger overwrites the sender with the caller, so thanking "U1" from U1 is self-thanks and fails.
    expect(r.error).not.toBeNull();
    const r2 = await tryQuery(db, authed(U1), `${INS} returning from_user`, [HA, U3, U2, null, "spoof"]);
    expect(r2.error).toBeNull();
    expect((r2.rows[0] as { from_user: string }).from_user).toBe(U1);
  });

  it("cannot thank yourself", async () => {
    const r = await tryQuery(db, authed(U1), INS, [HA, U1, U1, null, "me"]);
    expect(r.error).not.toBeNull();
  });

  it("cannot thank someone outside the household", async () => {
    const r = await tryQuery(db, authed(U1), INS, [HA, U1, U3, null, "outsider"]);
    expect(r.error).not.toBeNull();
  });

  it("cannot insert into another household", async () => {
    const r = await tryQuery(db, authed(U1), INS, [HB, U1, U3, null, "cross"]);
    expect(r.error).not.toBeNull();
  });

  it("cannot reference another household's audit row", async () => {
    const r = await tryQuery(db, authed(U1), INS, [HA, U1, U2, auditB, "cross audit"]);
    expect(r.error).not.toBeNull();
  });

  it("enforces message length 1..200", async () => {
    expect((await tryQuery(db, authed(U1), INS, [HA, U1, U2, null, ""])).error).not.toBeNull();
    expect((await tryQuery(db, authed(U1), INS, [HA, U1, U2, null, "a".repeat(201)])).error).not.toBeNull();
    expect((await tryQuery(db, authed(U1), INS, [HA, U1, U2, null, "a".repeat(200)])).error).toBeNull();
  });

  it("is isolated by household", async () => {
    await db.query(INS, [HA, U1, U2, null, "visible to A only"]);
    const a = await tryQuery(db, authed(U2), "select message from public.kudos where message = 'visible to A only'");
    expect(a.rows.length).toBe(1);
    const b = await tryQuery(db, authed(U3), "select message from public.kudos");
    expect(b.rows.length).toBe(0);
  });

  it("has no update or delete for members", async () => {
    await db.query(INS, [HA, U1, U2, null, "immutable"]);
    const upd = await tryQuery(db, authed(U1), "update public.kudos set message = 'changed' where message = 'immutable'");
    expect(upd.error).not.toBeNull();
    const del = await tryQuery(db, authed(U1), "delete from public.kudos where message = 'immutable'");
    expect(del.error).not.toBeNull();
  });

  it("allows one thank-you per sender per audit row", async () => {
    await db.query(INS, [HA, U2, U1, auditA, "first"]);
    const dup = await tryQuery(db, authed(U2), INS, [HA, U2, U1, auditA, "again"]);
    expect(dup.error).not.toBeNull();
  });
});
