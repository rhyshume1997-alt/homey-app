import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "a1a10000-0000-4000-8000-0000000000a1";
const HB = "a1a10000-0000-4000-8000-0000000000b1";
const U = "a1a10000-0000-4000-8000-0000000000c1"; // HA
const V = "a1a10000-0000-4000-8000-0000000000c2"; // HA
const W = "a1a10000-0000-4000-8000-0000000000c3"; // HB

const pid = (n: number) => `a1a10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PA = pid(1);
const PB = pid(2);
const RPC = "select public.record_ai_usage($1,$2,$3,$4,$5)";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'AI-HA'),($2,'AI-HB')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
     ('u@ai.example.test',$1,'owner','U'),('v@ai.example.test',$1,'member','V'),('w@ai.example.test',$2,'owner','W')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values
     ($1,'u@ai.example.test','{"provider":"google"}'),($2,'v@ai.example.test','{"provider":"google"}'),($3,'w@ai.example.test','{"provider":"google"}')`,
    [U, V, W],
  );
  await db.query(`insert into public.ai_proposals (id, household_id, kind, payload) values ($1,$2,'create_task','{"title":"a"}'),($3,$4,'create_task','{"title":"b"}')`, [PA, HA, PB, HB]);
  await db.query(
    `insert into public.ai_usage (household_id, month, model, input_tokens, output_tokens, cost_pence) values ($1,'2026-10-01','claude-sonnet-5-5',1,1,7),($2,'2026-10-01','claude-sonnet-5-5',1,1,9)`,
    [HA, HB],
  );
}, 30000);

afterAll(async () => {
  await db?.end();
});

describe("anon", () => {
  it("cannot touch ai tables or the usage function", async () => {
    for (const sql of [
      "select * from public.ai_usage",
      "select * from public.ai_proposals",
      `insert into public.ai_proposals (household_id, kind, payload) values ('${HA}','note','{}')`,
      `select public.record_ai_usage('${HA}','claude-sonnet-5-5',1,1,1)`,
    ]) {
      expect((await tryQuery(db, { role: "anon" }, sql)).error?.message).toMatch(/permission denied/);
    }
  });
});

describe("ai_usage", () => {
  it("members read only own household rows", async () => {
    const r = await tryQuery(db, authed(U), "select household_id, cost_pence from public.ai_usage");
    expect(r.rows).toEqual([{ household_id: HA, cost_pence: 7 }]);
  });

  it("members cannot insert, update or delete directly", async () => {
    for (const sql of [
      `insert into public.ai_usage (household_id, month, model, input_tokens, output_tokens, cost_pence) values ('${HA}','2026-10-01','claude-x',1,1,0)`,
      "update public.ai_usage set cost_pence = 0",
      "delete from public.ai_usage",
    ]) {
      expect((await tryQuery(db, authed(U), sql)).error?.message).toMatch(/permission denied/);
    }
  });

  it("record_ai_usage records for a member with the current month and caller id", async () => {
    const out = await as(db, authed(U), async (c) => {
      await c.query(RPC, [HA, "claude-haiku-5-5", 100, 50, 3]);
      return (await c.query("select user_id, month, cost_pence from public.ai_usage where cost_pence = 3")).rows[0];
    });
    expect(out.user_id).toBe(U);
    expect(new Date(out.month as string).getUTCDate()).toBe(1);
  });

  it("record_ai_usage refuses non-members and invalid values", async () => {
    expect((await tryQuery(db, authed(W), RPC, [HA, "claude-sonnet-5-5", 1, 1, 1])).error?.message).toMatch(/not a member/);
    for (const args of [
      [HA, "gpt-4", 1, 1, 1],
      [HA, "claude-sonnet-5-5", -1, 1, 1],
      [HA, "claude-sonnet-5-5", 1, 1, 100000],
      [HA, "claude-sonnet-5-5", 1, 1, -5],
      [HA, "claude-sonnet-5-5", null, 1, 1],
    ]) {
      expect((await tryQuery(db, authed(U), RPC, args)).error).not.toBeNull();
    }
  });
});

describe("ai_proposals", () => {
  const INS = "insert into public.ai_proposals (household_id, kind, payload) values ($1,$2,$3)";

  it("members see only own household proposals", async () => {
    const r = await tryQuery(db, authed(U), "select id from public.ai_proposals where id in ($1,$2)", [PA, PB]);
    expect(r.rows).toEqual([{ id: PA }]);
  });

  it("members insert pending proposals with created_by set and an audit row", async () => {
    const out = await as(db, authed(V), async (c) => {
      await c.query(INS, [HA, "create_snag", JSON.stringify({ title: "Tile" })]);
      const p = (await c.query("select status, created_by, decided_at from public.ai_proposals where payload->>'title'='Tile'")).rows[0];
      const a = (await c.query("select action from public.audit_log where entity_type='ai_proposal' and summary like '%Tile'")).rows;
      return { p, a };
    });
    expect(out.p).toEqual({ status: "pending", created_by: V, decided_at: null });
    expect(out.a).toEqual([{ action: "ai.proposed" }]);
  });

  it("cannot insert into another household, pre-decided, bad kind or oversized payload", async () => {
    expect((await tryQuery(db, authed(U), INS, [HB, "note", "{}"])).error?.message).toMatch(/row-level security/);
    expect((await tryQuery(db, authed(U), `insert into public.ai_proposals (household_id, kind, payload, status) values ($1,'note','{}','confirmed')`, [HA])).error).not.toBeNull();
    expect((await tryQuery(db, authed(U), INS, [HA, "send_email", "{}"])).error).not.toBeNull();
    const big = JSON.stringify({ text: "x".repeat(5000) });
    expect((await tryQuery(db, authed(U), INS, [HA, "note", big])).error).not.toBeNull();
    expect((await tryQuery(db, authed(U), INS, [HA, "note", "[]"])).error).not.toBeNull();
  });

  it("confirms pending, setting decided_by/at and auditing; cannot decide twice", async () => {
    const out = await as(db, authed(V), async (c) => {
      await c.query("update public.ai_proposals set status='confirmed' where id=$1", [PA]);
      const p = (await c.query("select status, decided_by, decided_at is not null as decided from public.ai_proposals where id=$1", [PA])).rows[0];
      const a = (await c.query("select action from public.audit_log where entity_id=$1 and action <> 'ai.proposed' order by id", [PA])).rows;
      await c.query("update public.ai_proposals set status='rejected' where id=$1", [PA]);
      const after = (await c.query("select status from public.ai_proposals where id=$1", [PA])).rows[0];
      return { p, a, after };
    });
    expect(out.p).toEqual({ status: "confirmed", decided_by: V, decided: true });
    expect(out.a).toEqual([{ action: "ai.confirmed" }]);
    expect(out.after).toEqual({ status: "confirmed" }); // second decision is a no-op (policy hides non-pending rows)
  });

  it("rejects pending with an audit row", async () => {
    const a = await as(db, authed(U), async (c) => {
      await c.query("update public.ai_proposals set status='rejected' where id=$1", [PA]);
      return (await c.query("select action from public.audit_log where entity_id=$1 and action <> 'ai.proposed' order by id", [PA])).rows;
    });
    expect(a).toEqual([{ action: "ai.rejected" }]);
  });

  it("cannot edit content, move household, set pending, or decide another household's proposal", async () => {
    expect((await tryQuery(db, authed(U), "update public.ai_proposals set payload='{\"title\":\"z\"}' where id=$1", [PA])).error?.message).toMatch(/immutable|row-level security|invalid/);
    expect((await tryQuery(db, authed(U), "update public.ai_proposals set household_id=$2 where id=$1", [PA, HB])).error).not.toBeNull();
    expect((await tryQuery(db, authed(U), "update public.ai_proposals set status='pending' where id=$1", [PA])).error).not.toBeNull();
    const cross = await as(db, authed(U), async (c) => {
      await c.query("update public.ai_proposals set status='confirmed' where id=$1", [PB]);
      return (await c.query("select status from public.ai_proposals where id=$1", [PB])).rows;
    });
    expect(cross).toEqual([]);
  });

  it("cannot delete", async () => {
    expect((await tryQuery(db, authed(U), "delete from public.ai_proposals")).error?.message).toMatch(/permission denied/);
  });
});
