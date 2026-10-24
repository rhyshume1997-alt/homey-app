import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, connectionString } from "./helpers";
import {
  SEEDS, type Who, accept, createHousehold, extraClient, invite, mkUser, openTx, run, runOk,
} from "./multi-household-helpers";

let db: Db;
beforeAll(async () => {
  db = await adminClient();
}, 30000);
afterAll(async () => db?.end());

const ROOT = process.cwd();
const MIGRATION = "20261025100000_multi_household.sql";
const code = (e: Error | null) => (e as { code?: string } | null)?.code;

// 1. Upgrade rehearsal ------------------------------------------------------------------------------
describe("upgrade rehearsal: a legacy household survives the multi-household migration", () => {
  it("keeps every row, every member and every member's visibility", async () => {
    const dbName = `rehearsal_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const url = new URL(connectionString());
    url.pathname = `/${dbName}`;
    await db.query(`create database ${dbName}`);
    const c = new Client({ connectionString: url.toString() });
    try {
      await c.connect();
      // Roles are cluster-wide and already exist; everything else in the bootstrap is per database.
      const bootstrap = readFileSync(join(ROOT, "supabase/tests/bootstrap.sql"), "utf8").replace(/^create role [^;]*;$/gm, "");
      await c.query(bootstrap);
      const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
      expect(files).toContain(MIGRATION);
      for (const f of files.filter((x) => x !== MIGRATION)) await c.query(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));

      // Legacy household exactly as production has it: allowlist rows -> trigger creates memberships.
      const hh = randomUUID(), u1 = randomUUID(), u2 = randomUUID();
      await c.query("insert into public.households (id, name) values ($1,'Legacy')", [hh]);
      await c.query(
        "insert into private.allowed_emails (email, household_id, role, display_name) values ('one@legacy.test',$1,'owner','One'),('two@legacy.test',$1,'member','Two')",
        [hh],
      );
      await c.query(
        "insert into auth.users (id, email, raw_app_meta_data) values ($1,'one@legacy.test','{\"provider\":\"google\"}'),($2,'Two@Legacy.test','{\"provider\":\"google\"}')",
        [u1, u2],
      );
      expect((await c.query("select count(*)::int n from public.household_members where household_id=$1", [hh])).rows[0].n).toBe(2);

      const ids = [hh, u1, u2];
      const exists = async (t: string) =>
        (await c.query("select 1 from information_schema.tables where table_schema='public' and table_name=$1", [t])).rows.length > 0;
      for (const t of Object.keys(SEEDS)) {
        if (t === "household_members" || !(await exists(t))) continue; // members came from the trigger; invites are new
        const used = [...new Set([...SEEDS[t][1].matchAll(/\$([123])(?!\d)/g)].map((m) => Number(m[1])))].sort();
        const vals = SEEDS[t][1].replace(/\$([123])(?!\d)/g, (_m, d) => `$${used.indexOf(Number(d)) + 1}::uuid`);
        await c.query(`insert into public.${t} (${SEEDS[t][0]}) values (${vals})`, used.map((i) => ids[i - 1])).catch((e) => {
          throw new Error(`legacy seed for ${t} failed: ${e.message}`);
        });
      }
      const doc = (await c.query("select storage_path from public.documents where household_id=$1", [hh])).rows[0].storage_path;
      await c.query("insert into storage.objects (bucket_id, name) values ('documents',$1)", [doc]);

      const tables = (await c.query(
        "select table_name from information_schema.columns where table_schema='public' and column_name='household_id' order by 1",
      )).rows.map((r) => r.table_name as string).filter((t) => t !== "household_invites");
      expect(tables).toEqual(expect.arrayContaining(["tasks", "snags", "documents", "household_records", "email_threads", "kudos", "notifications", "wifi_networks", "meals"]));
      const all = ["households", ...tables];
      const cols: Record<string, string> = {};
      for (const t of all) {
        cols[t] = (await c.query(
          "select string_agg(quote_ident(column_name), ',' order by ordinal_position) s from information_schema.columns where table_schema='public' and table_name=$1", [t],
        )).rows[0].s;
      }
      const snap = async () => {
        const out: Record<string, { n: number; h: string }> = {};
        for (const t of all) {
          const key = t === "households" ? "id" : "household_id";
          out[t] = (await c.query(
            `select count(*)::int n, coalesce(md5(string_agg(x::text,'|' order by x::text)),'') h from (select ${cols[t]} from public.${t} where ${key}=$1) x`, [hh],
          )).rows[0];
        }
        out["storage.objects"] = (await c.query(
          "select count(*)::int n, coalesce(md5(string_agg(x::text,'|' order by x::text)),'') h from (select bucket_id, name from storage.objects where name like $1) x", [`${hh}/%`],
        )).rows[0];
        return out;
      };
      const asUser = async (sub: string, email: string) => {
        const out: Record<string, number> = {};
        for (const t of all) {
          const key = t === "households" ? "id" : "household_id";
          await c.query("begin");
          await c.query("set local role authenticated");
          await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub, email, role: "authenticated" })]);
          out[t] = (await c.query(`select count(*)::int n from public.${t} where ${key}=$1`, [hh])).rows[0].n;
          await c.query("rollback");
        }
        return out;
      };
      const members = async () => (await c.query("select user_id, role, display_name from public.household_members where household_id=$1 order by role", [hh])).rows;

      const before = await snap();
      for (const t of all) expect(before[t].n, `${t} has a legacy row`).toBeGreaterThan(0);
      const membersBefore = await members();
      const seeBefore = { u1: await asUser(u1, "one@legacy.test"), u2: await asUser(u2, "two@legacy.test") };
      for (const t of ["tasks", "snags", "documents", "household_records", "households", "wifi_networks"]) {
        expect(seeBefore.u1[t], t).toBeGreaterThan(0);
        expect(seeBefore.u2[t], t).toBeGreaterThan(0);
      }

      await c.query(readFileSync(join(ROOT, "supabase/migrations", MIGRATION), "utf8"));

      expect(await snap()).toEqual(before);
      expect(await members()).toEqual(membersBefore);
      const st = (await c.query("select status, role from public.household_members where household_id=$1 order by role", [hh])).rows;
      expect(st).toEqual([{ status: "active", role: "member" }, { status: "active", role: "owner" }]);
      expect(await asUser(u1, "one@legacy.test")).toEqual(seeBefore.u1);
      expect(await asUser(u2, "two@legacy.test")).toEqual(seeBefore.u2);
    } finally {
      await c.end().catch(() => {});
      await db.query(`drop database if exists ${dbName} with (force)`);
    }
  }, 120000);
});

// Shared fixtures -----------------------------------------------------------------------------
async function twoOwners() {
  const o1 = await mkUser(db, "own1");
  const hh = await createHousehold(db, o1);
  const email = `own2-${randomUUID().slice(0, 8)}@mh.example.test`;
  const o2: Who = { sub: randomUUID(), email };
  await db.query("insert into auth.users (id, email, raw_app_meta_data) values ($1,$2,'{\"provider\":\"google\"}')", [o2.sub, email]);
  const r = await accept(db, o2, await invite(db, o1, hh, email), "Owner two");
  if (r.error) throw r.error;
  await db.query("update public.household_members set role='owner' where household_id=$1 and user_id=$2", [hh, o2.sub]);
  return { o1, o2, hh };
}
const activeOwners = async (hh: string) =>
  (await db.query("select count(*)::int n from public.household_members where household_id=$1 and role='owner' and status='active'", [hh])).rows[0].n as number;

/** Both calls are real concurrent transactions: c1 takes the lock, c2 must block on it, then c1 commits. */
async function race(who1: Who, sql1: string, p1: unknown[], who2: Who, sql2: string, p2: unknown[]) {
  const c1 = await extraClient();
  const c2 = await extraClient();
  try {
    await openTx(c1, who1);
    await openTx(c2, who2);
    await c1.query(sql1, p1);
    let settled = false;
    const second = c2.query(sql2, p2).then(
      () => ({ ok: true as const, e: null as Error | null }),
      (e: Error) => ({ ok: false as const, e }),
    );
    second.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 400));
    expect(settled, "second call must be blocked on the owner lock").toBe(false);
    await c1.query("commit");
    const res = await second;
    await c2.query(res.ok ? "commit" : "rollback");
    return res;
  } finally {
    await c1.end();
    await c2.end();
  }
}

// 2. Concurrent owner leave / remove ------------------------------------------------------------------
describe("two owners cannot both leave or remove each other", () => {
  it("owner1 leaves while owner2 leaves", async () => {
    const { o1, o2, hh } = await twoOwners();
    expect(await activeOwners(hh)).toBe(2);
    const second = await race(o1, "select public.leave_household($1)", [hh], o2, "select public.leave_household($1)", [hh]);
    expect(second.ok).toBe(false);
    expect(second.e?.message).toMatch(/the last owner cannot leave or be removed/);
    expect(code(second.e)).toBe("42501");
    expect(await activeOwners(hh)).toBe(1);
  });
  it("owner1 removes owner2 while owner2 removes owner1", async () => {
    const { o1, o2, hh } = await twoOwners();
    const second = await race(o1, "select public.remove_member($1,$2)", [hh, o2.sub], o2, "select public.remove_member($1,$2)", [hh, o1.sub]);
    expect(second.ok).toBe(false);
    expect(second.e?.message).toMatch(/the last owner cannot leave or be removed/);
    expect(await activeOwners(hh)).toBe(1);
    const a = await db.query("select count(*)::int n from public.audit_log where household_id=$1 and action='member.removed'", [hh]);
    expect(a.rows[0].n).toBe(1);
  });
});

// 3. Removed member, DB side ------------------------------------------------------------------------
describe("a removed member's JWT is dead for that household", () => {
  it("cannot invite, revoke, remove, sync, store a token or read storage; token row is gone", async () => {
    const { o1, o2, hh } = await twoOwners();
    await db.query("update public.household_members set role='member' where household_id=$1 and user_id=$2", [hh, o2.sub]);
    await runOk(db, o1, "select public.create_invite($1,'pending@mh.example.test')", [hh]);
    const inviteId = (await db.query("select id from public.household_invites where household_id=$1 and email='pending@mh.example.test'", [hh])).rows[0].id;
    const path = `${hh}/rm-${randomUUID()}.pdf`;
    await db.query("insert into storage.objects (bucket_id, name) values ('documents',$1)", [path]);
    const seeObj = "select name from storage.objects where bucket_id='documents' and name=$1";
    expect((await run(db, o2, seeObj, [path])).rows).toHaveLength(1);
    await runOk(db, o2, "select public.store_my_google_token($1,'v1:abc','s')", [hh]);
    expect((await db.query("select 1 from private.google_tokens where user_id=$1 and household_id=$2", [o2.sub, hh])).rows).toHaveLength(1);

    await runOk(db, o1, "select public.remove_member($1,$2)", [hh, o2.sub]);

    for (const [sql, params] of [
      ["select public.create_invite($1,'x@mh.example.test')", [hh]],
      ["select public.revoke_invite($1)", [inviteId]],
      ["select public.remove_member($1,$2)", [hh, o1.sub]],
      ["select public.sync_my_email_threads($1,'Owner two','[]'::jsonb)", [hh]],
      ["select public.store_my_google_token($1,'v1:abc','s')", [hh]],
    ] as [string, unknown[]][]) {
      const r = await run(db, o2, sql, params);
      expect(r.error, sql).not.toBeNull();
      expect(code(r.error), sql).toBe("42501");
    }
    expect((await run(db, o2, seeObj, [path])).rows).toHaveLength(0);
    expect((await db.query("select 1 from private.google_tokens where user_id=$1 and household_id=$2", [o2.sub, hh])).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.household_invites where id=$1 and revoked_at is null", [inviteId])).rows).toHaveLength(1);
    expect(await activeOwners(hh)).toBe(1);
  });
});

// 4. Kill switch and rate limits ------------------------------------------------------------------------
describe("kill switch and rate limits", () => {
  it("paused creation is refused with 42501; re-opened works; clients cannot touch the switch", async () => {
    const u = await mkUser(db, "ks");
    expect((await db.query("select household_creation_open from private.app_settings")).rows).toEqual([{ household_creation_open: true }]);
    await db.query("update private.app_settings set household_creation_open=false, updated_at=now()");
    try {
      const r = await run(db, u, "select public.create_household('Paused','Me')");
      expect(r.error?.message).toMatch(/household creation is paused/);
      expect(code(r.error)).toBe("42501");
      expect((await db.query("select 1 from public.household_members where user_id=$1", [u.sub])).rows).toHaveLength(0);
    } finally {
      await db.query("update private.app_settings set household_creation_open=true, updated_at=now()");
    }
    expect(await createHousehold(db, u, "Open again")).toMatch(/^[0-9a-f-]{36}$/);
    for (const sql of ["select * from private.app_settings", "update private.app_settings set household_creation_open=false", "select * from private.usage_daily"]) {
      const r = await run(db, u, sql);
      expect(r.error?.message, sql).toMatch(/permission denied/);
    }
  });
  it("the 4th creation in 24 h is refused even when earlier ones were left or removed", async () => {
    const u = await mkUser(db, "rl");
    for (let i = 0; i < 3; i++) await createHousehold(db, u, `R${i}`);
    await db.query("update public.household_members set status='removed' where user_id=$1", [u.sub]);
    const r = await run(db, u, "select public.create_household('R4','Me')");
    expect(r.error?.message).toMatch(/^rate limit reached$/);
    expect(code(r.error)).toBe("42501");
    // Older than 24 h no longer counts.
    // (audit_log is append-only; the test fixture ages the rows with triggers off, on a dedicated connection.)
    const aged = await extraClient();
    try {
      await aged.query("set session_replication_role = replica");
      await aged.query("update public.audit_log set created_at = now() - interval '25 hours' where actor_user_id=$1 and action='household.created'", [u.sub]);
    } finally {
      await aged.end();
    }
    await createHousehold(db, u, "R5");
  });
  it("the 21st invite in 24 h is refused", async () => {
    const o = await mkUser(db, "inv");
    const hh = await createHousehold(db, o);
    for (let i = 0; i < 20; i++) await invite(db, o, hh, `i${i}-${randomUUID().slice(0, 6)}@mh.example.test`);
    const r = await run(db, o, "select public.create_invite($1,'one-too-many@mh.example.test')", [hh]);
    expect(r.error?.message).toMatch(/^rate limit reached$/);
    expect(code(r.error)).toBe("42501");
    // Another household of the same owner has its own budget.
    const hh2 = await createHousehold(db, o, "Second");
    await invite(db, o, hh2, "fine@mh.example.test");
    await db.query("update public.household_invites set created_at = now() - interval '25 hours' where household_id=$1", [hh]);
    await invite(db, o, hh, "later@mh.example.test");
  });
  it("usage_daily counts creations, invites, acceptances and removals", async () => {
    const before = (await db.query("select coalesce(sum(households_created),0)::int h, coalesce(sum(invites_created),0)::int i, coalesce(sum(invites_accepted),0)::int a, coalesce(sum(members_removed),0)::int r from private.usage_daily")).rows[0] as Record<"h" | "i" | "a" | "r", number>;
    const { o1, o2, hh } = await twoOwners();
    await runOk(db, o1, "select public.remove_member($1,$2)", [hh, o2.sub]);
    const after = (await db.query("select coalesce(sum(households_created),0)::int h, coalesce(sum(invites_created),0)::int i, coalesce(sum(invites_accepted),0)::int a, coalesce(sum(members_removed),0)::int r from private.usage_daily")).rows[0] as Record<"h" | "i" | "a" | "r", number>;
    expect({ h: after.h - before.h, i: after.i - before.i, a: after.a - before.a, r: after.r - before.r }).toEqual({ h: 1, i: 1, a: 1, r: 1 });
  });
});
