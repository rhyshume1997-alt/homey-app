import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "5a0c0000-0000-4000-8000-0000000000a1";
const HB = "5a0c0000-0000-4000-8000-0000000000b1";
const U = "5a0c0000-0000-4000-8000-0000000000c1"; // HA
const W = "5a0c0000-0000-4000-8000-0000000000c3"; // HB
const EA = "5a0c0000-0000-4000-8000-000000001001";
const EB = "5a0c0000-0000-4000-8000-000000001002";
const RA = "5a0c0000-0000-4000-8000-000000002001";
const RB = "5a0c0000-0000-4000-8000-000000002002";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'EV-A'),($2,'EV-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u@ev.example.test',$1,'owner','U'),('w@ev.example.test',$2,'owner','W')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1,'u@ev.example.test','{"provider":"google"}'),($2,'w@ev.example.test','{"provider":"google"}')`,
    [U, W],
  );
  await db.query(`insert into public.rooms (id, household_id, name) values ($1,$2,'RA-room'),($3,$4,'RB-room')`, [RA, HA, RB, HB]);
  await db.query(`insert into public.household_events (id, household_id, title, starts_on) values ($1,$2,'a','2026-10-30'),($3,$4,'b','2026-10-30')`, [EA, HA, EB, HB]);
}, 60000);

afterAll(async () => {
  await db?.end();
});

describe("household_events", () => {
  it("anon is denied", async () => {
    const r = await tryQuery(db, { role: "anon" }, "select * from public.household_events");
    expect(r.error?.message).toMatch(/permission denied/);
  });

  it("members see only their household", async () => {
    const r = await tryQuery(db, authed(U), "select id from public.household_events where id in ($1,$2)", [EA, EB]);
    expect(r.rows).toEqual([{ id: EA }]);
  });

  it("member can create with a room in their household and it is audited", async () => {
    const n = await as(db, authed(U), async (c) => {
      await c.query(
        "insert into public.household_events (household_id, title, starts_on, room_id) values ($1,'Plumber','2026-11-01',$2)", [HA, RA]);
      const a = await c.query("select count(*)::int as n from public.audit_log where action='event.created' and summary='Plumber'");
      return a.rows[0].n as number;
    });
    expect(n).toBe(1);
  });

  it("rejects a room from another household", async () => {
    const r = await tryQuery(db, authed(U),
      "insert into public.household_events (household_id, title, starts_on, room_id) values ($1,'x','2026-11-01',$2)", [HA, RB]);
    expect(r.error?.message).toMatch(/room not in this household/);
  });

  it("rejects writes into another household", async () => {
    const r = await tryQuery(db, authed(U),
      "insert into public.household_events (household_id, title, starts_on) values ($1,'x','2026-11-01')", [HB]);
    expect(r.error).toBeTruthy();
  });

  it("enforces title length, end date and time-needs-not-all-day", async () => {
    const t = await tryQuery(db, authed(U), "insert into public.household_events (household_id, title, starts_on) values ($1,'','2026-11-01')", [HA]);
    expect(t.error).toBeTruthy();
    const e = await tryQuery(db, authed(U), "insert into public.household_events (household_id, title, starts_on, ends_on) values ($1,'x','2026-11-02','2026-11-01')", [HA]);
    expect(e.error).toBeTruthy();
    const a = await tryQuery(db, authed(U), "insert into public.household_events (household_id, title, starts_on, starts_at, all_day) values ($1,'x','2026-11-02','10:00',true)", [HA]);
    expect(a.error).toBeTruthy();
  });

  it("cannot update or delete another household's event", async () => {
    await tryQuery(db, authed(U), "update public.household_events set title='hacked' where id=$1", [EB]);
    await tryQuery(db, authed(U), "delete from public.household_events where id=$1", [EB]);
    const r = await db.query("select title from public.household_events where id=$1", [EB]);
    expect(r.rows).toEqual([{ title: "b" }]);
  });

  it("a member can delete their own household's event", async () => {
    const rows = await as(db, authed(U), async (c) => {
      await c.query("delete from public.household_events where id=$1", [EA]);
      return (await c.query("select id from public.household_events where id=$1", [EA])).rows;
    });
    expect(rows).toEqual([]);
  });
});
