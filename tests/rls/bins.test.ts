import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "b1500000-0000-4000-8000-00000000000a";
const HB = "b1500000-0000-4000-8000-00000000000b";
const UA = "b1500000-0000-4000-8000-0000000000a1";
const UB = "b1500000-0000-4000-8000-0000000000b1";
const SECRET = "bins-test-only-secret-0123456789abcdef0123";
const rid = (n: number) => `b1500000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const sign = (ts: number, body: string) => createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
const now = () => Math.floor(Date.now() / 1000);
const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
const payload = (items: { date: string; bin: string }[]) => JSON.stringify({ collections: items });

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'BINS-A'),($2,'BINS-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
     ('a@bins.example.test',$1,'owner','A'),('b@bins.example.test',$2,'owner','B')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values
     ($1,'a@bins.example.test','{"provider":"google"}'),($2,'b@bins.example.test','{"provider":"google"}')`,
    [UA, UB],
  );
  // The live DB may already hold a real 'bins' secret; override it inside this (rolled back) fixture.
  await db.query(
    `insert into private.integration_secrets (name, household_id, secret) values ('bins',$1,$2)
     on conflict (name) do update set household_id = excluded.household_id, secret = excluded.secret`,
    [HA, SECRET],
  );
  await db.query(
    `insert into public.bin_collections (id, household_id, collection_date, bin_name) values ($1,$2,$3,'A fixture'),($4,$5,$3,'B fixture')`,
    [rid(1), HA, day(30), rid(2), HB],
  );
}, 30000);
afterAll(async () => db?.end());

/**
 * Calls the ingest as anon; returns the error (or null) and the household A rows afterwards.
 * Errors are caught inside a plpgsql helper (its own subtransaction) rather than with SAVEPOINT,
 * because the remote harness cannot execute transaction-control statements.
 */
async function ingest(body: string, opts: { ts?: number; sig?: string; repeat?: boolean } = {}) {
  const ts = opts.ts ?? now();
  const sig = opts.sig ?? sign(ts, body);
  return as(db, { role: "anon" }, async (c) => {
    await c.query("reset role");
    await c.query(`create function pg_temp.try_ingest(ts bigint, body text, sig text) returns text language plpgsql as $f$
      begin
        return 'ok:' || public.ingest_bin_collections(ts, body, sig)::text;
      exception when others then
        return 'err:' || sqlerrm;
      end $f$`);
    await c.query("set local role anon");
    const call = async () => {
      const r = await c.query("select pg_temp.try_ingest($1::bigint,$2,$3) as r", [ts, body, sig]);
      const v = (r.rows[0] as { r: string }).r;
      return v.startsWith("ok:")
        ? { error: null as Error | null, n: Number(v.slice(3)) }
        : { error: new Error(v.slice(4)), n: null };
    };
    const first = await call();
    const second = opts.repeat ? await call() : null;
    await c.query("reset role");
    const rows = (await c.query("select collection_date::text as d, bin_name as b from public.bin_collections where household_id=$1 order by 1,2", [HA])).rows as { d: string; b: string }[];
    const audit = (await c.query("select summary, actor_user_id from public.audit_log where household_id=$1 and action='bins.synced'", [HA])).rows as { summary: string; actor_user_id: string | null }[];
    return { ...first, second, rows, audit };
  });
}

describe("ingest_bin_collections", () => {
  it("accepts a valid signed payload, upserts, audits and replaces future rows", async () => {
    const body = payload([
      { date: day(3), bin: "Black bin" },
      { date: day(3), bin: "Green bin" },
      { date: day(10), bin: "Blue bin" },
    ]);
    const r = await ingest(body);
    expect(r.error).toBeNull();
    expect(r.n).toBe(3);
    expect(r.rows.map((x) => x.b)).toEqual(["Black bin", "Green bin", "Blue bin"]);
    expect(r.rows.some((x) => x.b === "A fixture")).toBe(false); // old future row removed
    expect(r.audit).toEqual([{ summary: "3 collections", actor_user_id: null }]);
  });

  it("does not touch another household and keeps past rows", async () => {
    const r = await as(db, { role: "anon" }, async (c) => {
      await c.query("reset role");
      await c.query(`insert into public.bin_collections (household_id, collection_date, bin_name) values ($1,$2,'Past bin')`, [HA, day(-3)]);
      await c.query("set local role anon");
      const body = payload([{ date: day(4), bin: "Only" }]);
      const ts = now();
      await c.query("select public.ingest_bin_collections($1::bigint,$2,$3)", [ts, body, sign(ts, body)]);
      await c.query("reset role");
      return {
        a: (await c.query("select bin_name from public.bin_collections where household_id=$1 order by 1", [HA])).rows,
        b: (await c.query("select bin_name from public.bin_collections where household_id=$1", [HB])).rows,
      };
    });
    expect(r.a).toEqual([{ bin_name: "Only" }, { bin_name: "Past bin" }]);
    expect(r.b).toEqual([{ bin_name: "B fixture" }]);
  });

  it("rejects a bad signature, stale timestamp and a replay", async () => {
    const body = payload([{ date: day(2), bin: "X" }]);
    expect((await ingest(body, { sig: "00".repeat(32) })).error?.message).toMatch(/bad signature/);
    const old = now() - 600;
    expect((await ingest(body, { ts: old })).error?.message).toMatch(/stale request/);
    const r = await ingest(body, { repeat: true });
    expect(r.error).toBeNull();
    expect(r.second?.error?.message).toMatch(/replayed request/);
  });

  it("rejects invalid payloads with 22023 and leaves data unchanged", async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ date: day(1 + (i % 50)), bin: `b${i}` }));
    const bad = [
      "not json",
      "[]",
      JSON.stringify({ collections: [] }),
      payload(many),
      payload([{ date: "2026-02-30", bin: "X" }]),
      payload([{ date: "26-01-01", bin: "X" }]),
      payload([{ date: day(-30), bin: "X" }]),
      payload([{ date: day(500), bin: "X" }]),
      payload([{ date: day(2), bin: "" }]),
      payload([{ date: day(2), bin: "x".repeat(121) }]),
      JSON.stringify({ collections: [{ date: day(2) }] }),
    ];
    for (const body of bad) {
      const r = await ingest(body);
      expect((r.error as (Error & { code?: string }) | null)?.message).toMatch(/invalid payload/);
      expect(r.rows.map((x) => x.b)).toEqual(["A fixture"]);
    }
  });
});

describe("bin_collections access", () => {
  it("users read only their own household", async () => {
    const a = await as(db, authed(UA), (c) => c.query("select bin_name from public.bin_collections"));
    expect(a.rows).toEqual([{ bin_name: "A fixture" }]);
    const b = await as(db, authed(UB), (c) => c.query("select bin_name from public.bin_collections"));
    expect(b.rows).toEqual([{ bin_name: "B fixture" }]);
  });

  it("users cannot insert, update or delete", async () => {
    for (const sql of [
      `insert into public.bin_collections (household_id, collection_date, bin_name) values ('${HA}','${day(5)}','x')`,
      "update public.bin_collections set bin_name='x'",
      "delete from public.bin_collections",
    ]) {
      expect((await tryQuery(db, authed(UA), sql)).error?.message).toMatch(/permission denied/);
    }
  });

  it("anon cannot select or write, and users cannot call ingest", async () => {
    expect((await tryQuery(db, { role: "anon" }, "select * from public.bin_collections")).error?.message).toMatch(/permission denied/);
    expect((await tryQuery(db, { role: "anon" }, "delete from public.bin_collections")).error?.message).toMatch(/permission denied/);
    const r = await tryQuery(db, authed(UA), "select public.ingest_bin_collections(1, '{}', 'x')");
    expect(r.error?.message).toMatch(/permission denied/);
  });
});
