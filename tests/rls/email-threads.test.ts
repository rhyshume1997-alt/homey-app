import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "a2a20000-0000-4000-8000-00000000000a";
const HB = "a2a20000-0000-4000-8000-00000000000b";
const UA1 = "a2a20000-0000-4000-8000-0000000000a1";
const UA2 = "a2a20000-0000-4000-8000-0000000000a2";
const UB = "a2a20000-0000-4000-8000-0000000000b1";
const SECRET = "gmail-test-only-secret-0123456789abcdef0123";

const sign = (ts: number, body: string) => createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
const now = () => Math.floor(Date.now() / 1000);
const hash = (c: string) => c.repeat(64);

const thread = (o: Record<string, unknown> = {}) => ({
  thread_hash: hash("a"), subject: "Refund request", counterpart_domain: "natwest.com",
  last_message_at: "2026-10-10T09:00:00Z", last_from: "me", label_flag: false, ...o,
});
const payload = (threads: unknown[], member = "Alex", extra: Record<string, unknown> = {}) =>
  JSON.stringify({ member, threads, ...extra });

type Ingest = (body: string, ts?: number, sig?: string) => Promise<unknown>;
let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'ET-A'),($2,'ET-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
     ('a1@gmail-relay.example.test',$1,'owner','A1'),('a2@gmail-relay.example.test',$1,'member','A2'),('b1@gmail-relay.example.test',$2,'owner','B1')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values
     ($1,'a1@gmail-relay.example.test','{"provider":"google"}'),($2,'a2@gmail-relay.example.test','{"provider":"google"}'),($3,'b1@gmail-relay.example.test','{"provider":"google"}')`,
    [UA1, UA2, UB],
  );
  await db.query(`delete from private.integration_secrets where name = 'gmail'`);
  await db.query(`insert into private.integration_secrets (name, household_id, secret) values ('gmail',$1,$2)`, [HA, SECRET]);
}, 30000);
afterAll(async () => db?.end());

/** Runs fn in a rolled-back transaction; ingest() calls the RPC as anon, then returns to admin. */
async function tx<T>(fn: (ingest: Ingest) => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    const ingest = async (body: string, ts = now(), sig = sign(ts, body)) => {
      // No savepoints (remote harness): a failing call must be the last statement of its tx.
      await db.query("set local role anon");
      const r = (await db.query("select public.ingest_email_threads($1::bigint, $2, $3) as n", [ts, body, sig])).rows[0];
      await db.query("reset role");
      return r;
    };
    return await fn(ingest);
  } finally {
    await db.query("rollback");
  }
}

const rows = async () =>
  (await db.query("select * from public.email_threads where household_id = $1 order by thread_hash", [HA])).rows as Record<string, unknown>[];

describe("signature", () => {
  it("accepts a valid signed request and stores metadata", async () => {
    await tx(async (ingest) => {
      expect(await ingest(payload([thread()]))).toEqual({ n: 1 });
      const r = await rows();
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ household_id: HA, member: "Alex", counterpart_domain: "natwest.com", status: "awaiting", labelled: false });
      const audit = await db.query("select actor_user_id, summary from public.audit_log where household_id=$1 and action='email.synced'", [HA]);
      expect(audit.rows).toHaveLength(1);
      expect(String(audit.rows[0]?.summary)).not.toContain("Refund");
    });
  });
  it("rejects a wrong signature, wrong secret, stale timestamp", async () => {
    const body = payload([thread()]);
    for (const run of [
      (i: Ingest) => i(body, now(), "00".repeat(32)),
      (i: Ingest) => i(body, now(), sign(now(), body + " ")),
      (i: Ingest) => i(body, now() - 600, sign(now() - 600, body)),
    ]) {
      await tx(async (ingest) => {
        await expect(run(ingest)).rejects.toThrow(/bad signature|stale request/);
      });
    }
  });
  it("rejects a replay", async () => {
    await tx(async (ingest) => {
      const body = payload([thread()]);
      const ts = now();
      await ingest(body, ts);
      await expect(ingest(body, ts)).rejects.toThrow(/replayed request/);
    });
  });
});

describe("strict payload", () => {
  const bad: Record<string, string> = {
    "full email address in domain": payload([thread({ counterpart_domain: "someone@natwest.com" })]),
    "uppercase domain": payload([thread({ counterpart_domain: "NatWest.com" })]),
    "domain with display name": payload([thread({ counterpart_domain: "Bob <natwest.com>" })]),
    "single label domain": payload([thread({ counterpart_domain: "localhost" })]),
    "overlong subject": payload([thread({ subject: "x".repeat(151) })]),
    "extra thread field": payload([thread({ body: "hello" })]),
    "extra top-level field": payload([thread()], "Alex", { token: "x" }),
    "bad hash": payload([thread({ thread_hash: "ABC" })]),
    "bad last_from": payload([thread({ last_from: "other" })]),
    "bad timestamp": payload([thread({ last_message_at: "yesterday" })]),
    "non-boolean label": payload([thread({ label_flag: "yes" })]),
    "empty member": payload([thread()], ""),
    "overlong member": payload([thread()], "m".repeat(51)),
    "51 threads": payload(Array.from({ length: 51 }, (_, i) => thread({ thread_hash: i.toString(16).padStart(64, "0") }))),
    "threads not array": JSON.stringify({ member: "Alex", threads: {} }),
    "not json": "not json",
  };
  for (const [name, body] of Object.entries(bad)) {
    it(`rejects ${name}`, async () => {
      await tx(async (ingest) => {
        await expect(ingest(body)).rejects.toThrow(/invalid payload/);
      });
    });
  }
  it("accepts exactly 50 threads and an empty list", async () => {
    await tx(async (ingest) => {
      const fifty = Array.from({ length: 50 }, (_, i) => thread({ thread_hash: i.toString(16).padStart(64, "0") }));
      expect(await ingest(payload(fifty))).toEqual({ n: 50 });
      expect(await ingest(payload([]))).toEqual({ n: 0 });
    });
  });
});

describe("upsert and status transitions", () => {
  it("is idempotent and updates fields on the same thread hash", async () => {
    await tx(async (ingest) => {
      await ingest(payload([thread()]));
      await ingest(payload([thread({ subject: "Refund request 2", label_flag: true, last_message_at: "2026-10-12T09:00:00Z" })]));
      const r = await rows();
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ subject: "Refund request 2", labelled: true, status: "awaiting" });
    });
  });
  it("goes replied when they answer, back to awaiting when I follow up, never reopens closed", async () => {
    await tx(async (ingest) => {
      await ingest(payload([thread()]));
      await ingest(payload([thread({ last_from: "them", last_message_at: "2026-10-13T09:00:00Z" })]));
      expect((await rows())[0]).toMatchObject({ status: "replied", last_from: "them" });
      await ingest(payload([thread({ last_from: "me", last_message_at: "2026-10-14T09:00:00Z" })]));
      expect((await rows())[0]).toMatchObject({ status: "awaiting" });
      await db.query("update public.email_threads set status='closed' where household_id=$1", [HA]);
      await ingest(payload([thread({ last_from: "them", last_message_at: "2026-10-15T09:00:00Z" })]));
      await ingest(payload([thread({ last_from: "me", last_message_at: "2026-10-16T09:00:00Z" })]));
      expect((await rows())[0]).toMatchObject({ status: "closed" });
    });
  });
  it("writes into the household that owns the secret only", async () => {
    await tx(async (ingest) => {
      await ingest(payload([thread()]));
      expect((await db.query("select 1 from public.email_threads where household_id=$1", [HB])).rows).toHaveLength(0);
    });
  });
});

describe("member access", () => {
  const seed = async () => {
    await db.query(
      `insert into public.email_threads (id, household_id, thread_hash, member, subject, counterpart_domain, last_message_at, last_from)
       values ('a2a20000-0000-4000-8000-000000000101',$1,$3,'Alex','Sub','natwest.com',now(),'me'),
              ('a2a20000-0000-4000-8000-000000000102',$2,$4,'Other','Sub','bt.com',now(),'me')`,
      [HA, HB, hash("c"), hash("d")],
    );
  };
  const T_A = "a2a20000-0000-4000-8000-000000000101";
  const T_B = "a2a20000-0000-4000-8000-000000000102";

  it("members see their household's rows only; anon sees nothing", async () => {
    await db.query("begin");
    try {
      await seed();
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: UA2, role: "authenticated" })]);
      expect((await db.query("select id from public.email_threads")).rows).toEqual([{ id: T_A }]);
      await db.query("reset role");
      await db.query("set local role anon");
      await expect(db.query("select * from public.email_threads")).rejects.toThrow(/permission denied/);
    } finally {
      await db.query("rollback");
    }
  });

  it("members may update status only, in their own household", async () => {
    await db.query("begin");
    try {
      await seed();
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: UA1, role: "authenticated" })]);
      await db.query("update public.email_threads set status='closed' where id=$1", [T_A]);
      // Other household: RLS hides the row, nothing changes.
      expect((await db.query("update public.email_threads set status='closed' where id=$1 returning id", [T_B])).rows).toHaveLength(0);
      await db.query("reset role");
      expect((await db.query("select status from public.email_threads where id=$1", [T_A])).rows).toEqual([{ status: "closed" }]);
      expect((await db.query("select status from public.email_threads where id=$1", [T_B])).rows).toEqual([{ status: "awaiting" }]);
      const audit = await db.query("select summary from public.audit_log where action='email.status_changed' and household_id=$1", [HA]);
      expect(audit.rows).toHaveLength(1);
    } finally {
      await db.query("rollback");
    }
  });

  it("members cannot change other columns, insert or delete; status values are constrained", async () => {
    await db.query(
      `insert into public.email_threads (id, household_id, thread_hash, member, subject, counterpart_domain, last_message_at, last_from)
       values ('a2a20000-0000-4000-8000-000000000101',$1,$2,'Alex','Sub','natwest.com',now(),'me')`,
      [HA, hash("c")],
    );
    for (const sql of [
      "update public.email_threads set subject='x'",
      "update public.email_threads set counterpart_domain='evil.com'",
      "update public.email_threads set member='x'",
      "update public.email_threads set household_id='" + HB + "'",
      "delete from public.email_threads",
      `insert into public.email_threads (household_id, thread_hash, member, subject, counterpart_domain, last_message_at, last_from) values ('${HA}','${hash("e")}','x','x','a.com',now(),'me')`,
    ]) {
      const r = await tryQuery(db, authed(UA1), sql);
      expect(r.error?.message, sql).toMatch(/permission denied/);
    }
    const r = await tryQuery(db, authed(UA1), "update public.email_threads set status='bogus'");
    expect(r.error?.message).toMatch(/check constraint/);
    const anon = await tryQuery(db, { role: "anon" }, "update public.email_threads set status='closed'");
    expect(anon.error?.message).toMatch(/permission denied/);
  });

  it("only anon may execute the ingest function; helpers stay private", async () => {
    const body = payload([]);
    const ts = now();
    const call = "select public.ingest_email_threads($1::bigint,$2,$3)";
    const r = await tryQuery(db, authed(UA1), call, [ts, body, sign(ts, body)]);
    expect(r.error?.message).toMatch(/permission denied/);
    const rb = await as(db, { role: "anon" }, async (c) => (await c.query(call, [ts, body, "00".repeat(32)]).catch((e: Error) => e)) as Error);
    expect(rb.message).toMatch(/bad signature/);
  });
});

describe("oversize ingest body", () => {
  it("is rejected before the signature is checked", async () => {
    await tx(async (ingest) => {
      const big = JSON.stringify({ member: "Alex", threads: [], pad: "x".repeat(66000) });
      await expect(ingest(big)).rejects.toThrow(/payload too large/);
    });
  });
});

describe("authenticated sync (shared apply path)", () => {
  const call = "select public.sync_my_email_threads($1, $2::jsonb) as n";
  const asUser = async (sub: string) => {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: "authenticated" })]);
  };

  it("stores threads in the caller's household with the caller's name; records the sync time", async () => {
    await db.query("begin");
    try {
      await asUser(UA1);
      expect((await db.query(call, ["A1", JSON.stringify([thread()])])).rows[0]).toEqual({ n: 1 });
      expect((await db.query("select public.my_gmail_sync_at() as t")).rows[0]?.t).toBeTruthy();
      await db.query("reset role");
      expect((await db.query("select household_id, member, status from public.email_threads where member = 'A1'")).rows).toEqual([{ household_id: HA, member: "A1", status: "awaiting" }]);
      const a = await db.query("select actor_user_id, summary from public.audit_log where action='email.synced' and household_id=$1", [HA]);
      expect(a.rows).toMatchObject([{ actor_user_id: UA1 }]);
      expect(JSON.stringify(a.rows)).not.toContain("Refund");
    } finally {
      await db.query("rollback");
    }
  });

  it("applies the same strict validation and status transitions as the signed ingest", async () => {
    const bad = [
      [thread({ counterpart_domain: "someone@natwest.com" })],
      [thread({ body: "hello" })],
      [thread({ subject: "x".repeat(151) })],
      Array.from({ length: 51 }, (_, i) => thread({ thread_hash: i.toString(16).padStart(64, "0") })),
    ];
    for (const threads of bad) {
      expect((await tryQuery(db, authed(UA1), call, ["A1", JSON.stringify(threads)])).error?.message).toMatch(/invalid payload/);
    }
    await db.query("begin");
    try {
      await asUser(UA1);
      await db.query(call, ["A1", JSON.stringify([thread()])]);
      await db.query(call, ["A1", JSON.stringify([thread({ last_from: "them", last_message_at: "2026-10-13T09:00:00Z" })])]);
      await db.query("reset role");
      expect((await rows())[0]).toMatchObject({ status: "replied" });
    } finally {
      await db.query("rollback");
    }
  });

  it("cannot rewrite the other member's thread rows by reusing their hash (review S3)", async () => {
    await db.query("begin");
    try {
      await asUser(UA1);
      await db.query(call, ["A1", JSON.stringify([thread({ thread_hash: hash("e"), subject: "Mine" })])]);
      await db.query("reset role");
      await asUser(UA2);
      await db.query(call, ["A2", JSON.stringify([thread({ thread_hash: hash("e"), subject: "Hijacked" })])]);
      await db.query("reset role");
      expect((await db.query("select member, subject from public.email_threads where household_id=$1 and thread_hash=$2", [HA, hash("e")])).rows).toEqual([
        { member: "A1", subject: "Mine" },
      ]);
    } finally {
      await db.query("rollback");
    }
  });

  it("rejects another person's name, non-members and anon", async () => {
    expect((await tryQuery(db, authed(UA1), call, ["A2", "[]"])).error?.message).toMatch(/member mismatch/);
    expect((await tryQuery(db, authed("a2a20000-0000-4000-8000-0000000000ff"), call, ["x", "[]"])).error?.message).toMatch(/not a member/);
    expect((await tryQuery(db, { role: "anon" }, call, ["A1", "[]"])).error?.message).toMatch(/permission denied/);
  });

  it("a household B member writes only into household B", async () => {
    await db.query("begin");
    try {
      await asUser(UB);
      await db.query(call, ["B1", JSON.stringify([thread()])]);
      await db.query("reset role");
      expect((await db.query("select household_id from public.email_threads where member = 'B1'")).rows).toEqual([{ household_id: HB }]);
    } finally {
      await db.query("rollback");
    }
  });

  it("the private apply function is not callable by API roles", async () => {
    const sql = `select private.apply_email_threads($1::uuid, '{"member":"x","threads":[]}'::jsonb)`;
    for (const actor of [authed(UA1), { role: "anon" } as const]) {
      expect((await tryQuery(db, actor, sql, [HA])).error?.message).toMatch(/permission denied/);
    }
  });
});
