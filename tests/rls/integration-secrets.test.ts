import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, tryQuery } from "./helpers";

const H = "15ec0000-0000-4000-8000-000000000001";
const SECRET = "test-only-secret-0123456789abcdef0123456789";
const sign = (ts: number, body: string) => createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'IS-H')`, [H]);
  await db.query(`insert into private.integration_secrets (name, household_id, secret) values ('test_feed',$1,$2)`, [H, SECRET]);
}, 30000);
afterAll(async () => db?.end());

const now = () => Math.floor(Date.now() / 1000);
const verify = (ts: number, body: string, sig: string, name = "test_feed") =>
  db.query("select private.verify_signed($1, $2::bigint, $3, $4) as h", [name, ts, body, sig]);

describe("private.verify_signed", () => {
  it("accepts a fresh, correct signature and returns the household", async () => {
    const ts = now();
    const body = '{"a":1}';
    await db.query("begin");
    try {
      expect((await verify(ts, body, sign(ts, body))).rows).toEqual([{ h: H }]);
    } finally {
      await db.query("rollback");
    }
  });
  it("rejects a wrong signature, unknown secret name, stale timestamp and a replay", async () => {
    const ts = now();
    const body = '{"a":2}';
    for (const run of [
      () => verify(ts, body, "00".repeat(32)),
      () => verify(ts, body, sign(ts, body), "nope"),
      () => verify(ts - 600, body, sign(ts - 600, body)),
    ]) {
      await db.query("begin");
      try {
        await expect(run()).rejects.toThrow(/bad signature|stale request/);
      } finally {
        await db.query("rollback");
      }
    }
    await db.query("begin");
    try {
      await verify(ts, body, sign(ts, body));
      await expect(verify(ts, body, sign(ts, body))).rejects.toThrow(/replayed request/);
    } finally {
      await db.query("rollback");
    }
  });
  it("is not callable by API roles and secrets are not readable", async () => {
    for (const actor of [{ role: "anon" } as const, { role: "authenticated", sub: "15ec0000-0000-4000-8000-0000000000aa" } as const]) {
      expect((await tryQuery(db, actor, "select private.verify_signed('test_feed', 1, 'x', 'y')")).error?.message).toMatch(/permission denied/);
      expect((await tryQuery(db, actor, "select * from private.integration_secrets")).error?.message).toMatch(/permission denied/);
    }
  });
});
