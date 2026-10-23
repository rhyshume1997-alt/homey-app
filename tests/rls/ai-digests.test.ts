import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "d1d10000-0000-4000-8000-0000000000a1";
const HB = "d1d10000-0000-4000-8000-0000000000b1";
const U = "d1d10000-0000-4000-8000-0000000000c1"; // HA
const V = "d1d10000-0000-4000-8000-0000000000c2"; // HA
const W = "d1d10000-0000-4000-8000-0000000000c3"; // HB

const did = (n: number) => `d1d10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DA = did(1);
const DB = did(2);
const HASH = (c: string) => c.repeat(64);
const BODY = JSON.stringify({ summary: "Morning!", top: [] });
const TODAY = "(now() at time zone 'UTC')::date";
const INS = `insert into public.ai_digests (household_id, user_id, day, input_hash, trigger, model, body)
  values ($1, $2, ${TODAY}, $3, 'first_open', 'claude-haiku-5-5', $4::jsonb) returning user_id`;

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'DG-HA'),($2,'DG-HB')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
     ('u@dg.example.test',$1,'owner','U'),('v@dg.example.test',$1,'member','V'),('w@dg.example.test',$2,'owner','W')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values
     ($1,'u@dg.example.test','{"provider":"google"}'),($2,'v@dg.example.test','{"provider":"google"}'),($3,'w@dg.example.test','{"provider":"google"}')`,
    [U, V, W],
  );
  await db.query(
    `insert into public.ai_digests (id, household_id, user_id, day, input_hash, trigger, model, body) values
     ($1,$2,$3,${TODAY},$4,'sign_in','claude-haiku-5-5',$6::jsonb),
     ($5,$7,$8,${TODAY},$4,'sign_in','claude-haiku-5-5',$6::jsonb)`,
    [DA, HA, U, HASH("a"), DB, BODY, HB, W],
  );
}, 30000);

afterAll(async () => {
  await db?.end();
});

describe("ai_digests", () => {
  it("anon cannot read or write", async () => {
    for (const sql of [
      "select * from public.ai_digests",
      `insert into public.ai_digests (household_id, user_id, day, input_hash, trigger, model, body) values ('${HA}','${U}',current_date,'${HASH("b")}','refresh','claude-haiku-5-5','{}')`,
    ]) {
      expect((await tryQuery(db, { role: "anon" }, sql)).error?.message).toMatch(/permission denied/);
    }
  });

  it("members see only their own household's rows (including the other member's)", async () => {
    const r = await tryQuery(db, authed(V), "select id from public.ai_digests where id in ($1,$2)", [DA, DB]);
    expect(r.rows).toEqual([{ id: DA }]);
    const w = await tryQuery(db, authed(W), "select id from public.ai_digests where id in ($1,$2)", [DA, DB]);
    expect(w.rows).toEqual([{ id: DB }]);
  });

  it("a member inserts their own row for today; created_at is server time", async () => {
    const out = await as(db, authed(U), async (c) => {
      await c.query(
        `insert into public.ai_digests (household_id, user_id, day, input_hash, trigger, model, body, created_at)
         values ($1,$2,${TODAY},$3,'refresh','claude-haiku-5-5',$4::jsonb,'2000-01-01')`,
        [HA, U, HASH("c"), BODY],
      );
      return (await c.query("select user_id, created_at > now() - interval '1 minute' as fresh from public.ai_digests where input_hash=$1", [HASH("c")])).rows;
    });
    expect(out).toEqual([{ user_id: U, fresh: true }]);
  });

  it("cannot insert for another member, another household, or a far-off day", async () => {
    expect((await tryQuery(db, authed(U), INS, [HA, V, HASH("d"), BODY])).error?.message).toMatch(/row-level security/);
    expect((await tryQuery(db, authed(U), INS, [HB, U, HASH("d"), BODY])).error?.message).toMatch(/row-level security/);
    expect((await tryQuery(db, authed(U), INS, [HB, W, HASH("d"), BODY])).error?.message).toMatch(/row-level security/);
    const far = `insert into public.ai_digests (household_id, user_id, day, input_hash, trigger, model, body)
      values ($1,$2,${TODAY} + 5,$3,'refresh','claude-haiku-5-5',$4::jsonb)`;
    expect((await tryQuery(db, authed(U), far, [HA, U, HASH("d"), BODY])).error?.message).toMatch(/row-level security/);
  });

  it("rejects bad trigger, model, hash, non-object or oversized body, and duplicates", async () => {
    const bad = (trigger: string, model: string, hash: string, body: string) =>
      tryQuery(
        db,
        authed(U),
        `insert into public.ai_digests (household_id, user_id, day, input_hash, trigger, model, body) values ($1,$2,${TODAY},$3,$4,$5,$6::jsonb)`,
        [HA, U, hash, trigger, model, body],
      );
    expect((await bad("cron", "claude-haiku-5-5", HASH("e"), BODY)).error).not.toBeNull();
    expect((await bad("refresh", "gpt-4", HASH("e"), BODY)).error).not.toBeNull();
    expect((await bad("refresh", "claude-haiku-5-5", "not-a-hash", BODY)).error).not.toBeNull();
    expect((await bad("refresh", "claude-haiku-5-5", HASH("e"), "[]")).error).not.toBeNull();
    expect((await bad("refresh", "claude-haiku-5-5", HASH("e"), JSON.stringify({ summary: "x".repeat(5000) }))).error).not.toBeNull();
    expect((await bad("refresh", "claude-haiku-5-5", HASH("a"), BODY)).error?.message).toMatch(/duplicate key|unique/);
  });

  it("members cannot update or delete", async () => {
    for (const sql of [
      `update public.ai_digests set body='{"summary":"hacked","top":[]}' where id='${DA}'`,
      `update public.ai_digests set household_id='${HB}' where id='${DA}'`,
      `delete from public.ai_digests where id='${DA}'`,
    ]) {
      expect((await tryQuery(db, authed(U), sql)).error?.message).toMatch(/permission denied/);
    }
  });

  it("forces RLS on the table", async () => {
    const r = await db.query("select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.ai_digests'::regclass");
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
