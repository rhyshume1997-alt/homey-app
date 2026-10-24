import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient } from "./helpers";
import {
  SEEDS, type Who, accept, createHousehold, extraClient, invite, mkUser, openTx, run, runOk,
} from "./multi-household-helpers";

let db: Db;
beforeAll(async () => {
  db = await adminClient();
}, 30000);
afterAll(async () => db?.end());

const status = async (hh: string, u: Who) =>
  (await db.query("select status, role, removed_by from public.household_members where household_id=$1 and user_id=$2", [hh, u.sub])).rows[0];

async function houseWithMember() {
  const owner = await mkUser(db, "owner", { creator: true });
  const hh = await createHousehold(db, owner);
  const email = `member-${randomUUID().slice(0, 8)}@mh.example.test`;
  const token = await invite(db, owner, hh, email);
  const member: Who = { sub: randomUUID(), email };
  await db.query("insert into auth.users (id, email, raw_app_meta_data) values ($1,$2,'{\"provider\":\"google\"}')", [member.sub, email]);
  const r = await accept(db, member, token);
  if (r.error) throw r.error;
  return { owner, hh, member, token };
}

describe("create_household", () => {
  it("works for a listed creator and makes them the active owner", async () => {
    const o = await mkUser(db, "c", { creator: true });
    const hh = await createHousehold(db, o, "  Mine  ");
    expect(await status(hh, o)).toMatchObject({ status: "active", role: "owner" });
    const name = (await db.query("select name from public.households where id=$1", [hh])).rows[0].name;
    expect(name).toBe("Mine");
    const a = await db.query("select actor_user_id from public.audit_log where household_id=$1 and action='household.created'", [hh]);
    expect(a.rows).toEqual([{ actor_user_id: o.sub }]);
  });
  it("is open to any signed-in user, limited to 3 owned households", async () => {
    const u = await mkUser(db, "fresh");
    for (let i = 0; i < 3; i++) await createHousehold(db, u, `H${i}`);
    const r = await run(db, u, "select public.create_household('X','Y')");
    expect(r.error?.message).toMatch(/household limit reached/);
    expect((r.error as { code?: string }).code).toBe("42501");
    // Removed memberships do not count towards the owned cap (the 24 h creation limit is tested separately).
    const v = await mkUser(db, "fresh2");
    const h = await createHousehold(db, v);
    await db.query("update public.household_members set status='removed' where household_id=$1", [h]);
    for (let i = 0; i < 2; i++) await createHousehold(db, v, `V${i}`);
  });
  it("a fresh user cannot see another household's data", async () => {
    const a = await houseWithMember();
    const u = await mkUser(db, "stranger");
    await createHousehold(db, u);
    expect((await run(db, u, "select id from public.households where id=$1", [a.hh])).rows).toHaveLength(0);
    expect((await run(db, u, "select 1 from public.tasks")).rows).toHaveLength(0);
  });
  it("validates names", async () => {
    const o = await mkUser(db, "c", { creator: true });
    for (const [n, d] of [["", "ok"], ["x".repeat(101), "ok"], ["ok", ""], ["ok", "x".repeat(51)]]) {
      const r = await run(db, o, "select public.create_household($1,$2)", [n, d]);
      expect((r.error as { code?: string }).code).toBe("22023");
    }
  });
  it("is not executable by anon", async () => {
    await db.query("begin");
    await db.query("set local role anon");
    await expect(db.query("select public.create_household('a','b')")).rejects.toThrow(/permission denied/);
    await db.query("rollback");
  });
});

describe("sign-up gate (open to any Google user)", () => {
  const signup = async (email: string, provider = "google") => {
    try {
      await db.query("insert into auth.users (id, email, raw_app_meta_data) values ($1,$2,$3)", [randomUUID(), email, JSON.stringify({ provider })]);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
  it("accepts any Google user with no invite and creates no membership", async () => {
    const id = randomUUID();
    await db.query("insert into auth.users (id, email, raw_app_meta_data) values ($1,$2,'{\"provider\":\"google\"}')", [id, `any-${id.slice(0, 8)}@mh.example.test`]);
    expect((await db.query("select 1 from public.household_members where user_id=$1", [id])).rows.length).toBe(0);
  });
  it("an invitee signing up gets no membership", async () => {
    const o = await mkUser(db, "o");
    const hh = await createHousehold(db, o);
    const e1 = `inv1-${randomUUID().slice(0, 6)}@mh.example.test`;
    await invite(db, o, hh, e1);
    expect(await signup(e1)).toBeNull();
    expect((await db.query("select 1 from public.household_members m join auth.users u on u.id=m.user_id where u.email=$1", [e1])).rows.length).toBe(0);
  });
  it("still requires Google", async () => {
    expect(await signup(`x-${randomUUID().slice(0, 8)}@mh.example.test`, "email")).toMatch(/only Google/);
  });
  it("legacy allowlist still creates the membership", async () => {
    const hh = (await db.query("insert into public.households (name) values ('legacy') returning id")).rows[0].id;
    const e = `legacy-${randomUUID().slice(0, 8)}@mh.example.test`;
    await db.query("insert into private.allowed_emails (email, household_id, role, display_name) values ($1,$2,'owner','L')", [e, hh]);
    const id = randomUUID();
    await db.query("insert into auth.users (id, email, raw_app_meta_data) values ($1,$2,'{\"provider\":\"google\"}')", [id, e]);
    const m = await db.query("select status from public.household_members where user_id=$1", [id]);
    expect(m.rows).toEqual([{ status: "active" }]);
  });
});

describe("household_invites table", () => {
  it("token_hash is never selectable; only active owners see invite rows", async () => {
    const { owner, hh, member } = await houseWithMember();
    const other = await mkUser(db, "oo", { creator: true });
    await createHousehold(db, other);
    await invite(db, owner, hh, "someone@mh.example.test");

    for (const who of [owner, member, other]) {
      for (const sql of ["select token_hash from public.household_invites", "select * from public.household_invites"]) {
        expect((await run(db, who, sql)).error?.message).toMatch(/permission denied/);
      }
    }
    const cols = "id,email,role,expires_at,accepted_at,revoked_at";
    expect((await run(db, owner, `select ${cols} from public.household_invites where household_id=$1`, [hh])).rows.length).toBeGreaterThan(0);
    expect((await run(db, member, `select ${cols} from public.household_invites`)).rows).toHaveLength(0);
    expect((await run(db, other, `select ${cols} from public.household_invites where household_id=$1`, [hh])).rows).toHaveLength(0);
    await db.query("begin");
    await db.query("set local role anon");
    await expect(db.query("select id from public.household_invites")).rejects.toThrow(/permission denied/);
    await db.query("rollback");
  });
  it("direct writes are denied; role is constrained to member", async () => {
    const { owner, hh } = await houseWithMember();
    for (const sql of [
      "insert into public.household_invites (household_id,email,token_hash) values ($1,'x@y.zz',repeat('a',64))",
      "update public.household_invites set revoked_at=null",
      "delete from public.household_invites",
    ]) {
      expect((await run(db, owner, sql, sql.startsWith("insert") ? [hh] : [])).error?.message).toMatch(/permission denied/);
    }
    await expect(
      db.query("insert into public.household_invites (household_id,email,role,token_hash) values ($1,'x@y.zz','owner',repeat('b',64))", [hh]),
    ).rejects.toThrow(/check constraint/);
  });
  it("stores only a sha256 hex of the token", async () => {
    const { owner, hh } = await houseWithMember();
    const t = await invite(db, owner, hh, "hash@mh.example.test");
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const r = await db.query("select token_hash, encode(extensions.digest($2,'sha256'),'hex') as h from public.household_invites where household_id=$1 and email='hash@mh.example.test' and revoked_at is null", [hh, t]);
    expect(r.rows[0].token_hash).toBe(r.rows[0].h);
    expect(r.rows[0].token_hash).not.toContain(t);
  });
});

describe("create_invite / revoke_invite", () => {
  it("only an active owner can invite or revoke", async () => {
    const { owner, hh, member } = await houseWithMember();
    const outsider = await mkUser(db, "out", { creator: true });
    for (const who of [member, outsider]) {
      const r = await run(db, who, "select public.create_invite($1,'a@b.cc')", [hh]);
      expect((r.error as { code?: string }).code).toBe("42501");
    }
    await invite(db, owner, hh, "p@mh.example.test");
    const id = (await db.query("select id from public.household_invites where household_id=$1 and email='p@mh.example.test'", [hh])).rows[0].id;
    for (const who of [member, outsider]) {
      expect((await run(db, who, "select public.revoke_invite($1)", [id])).error).not.toBeNull();
    }
    await runOk(db, owner, "select public.revoke_invite($1)", [id]);
    expect((await db.query("select revoked_at from public.household_invites where id=$1", [id])).rows[0].revoked_at).not.toBeNull();
    // Already revoked: not pending.
    expect((await run(db, owner, "select public.revoke_invite($1)", [id])).error).not.toBeNull();
  });
  it("an owner of another household cannot invite into or revoke here", async () => {
    const a = await houseWithMember();
    const b = await houseWithMember();
    expect((await run(db, b.owner, "select public.create_invite($1,'z@mh.example.test')", [a.hh])).error).not.toBeNull();
    await invite(db, a.owner, a.hh, "q@mh.example.test");
    const id = (await db.query("select id from public.household_invites where household_id=$1 and email='q@mh.example.test'", [a.hh])).rows[0].id;
    expect((await run(db, b.owner, "select public.revoke_invite($1)", [id])).error).not.toBeNull();
  });
  it("rejects bad emails and existing active members; replaces a pending invite", async () => {
    const { owner, hh, member } = await houseWithMember();
    expect((await run(db, owner, "select public.create_invite($1,'nope')", [hh])).error).not.toBeNull();
    const r = await run(db, owner, "select public.create_invite($1,$2)", [hh, member.email.toUpperCase()]);
    expect(r.error?.message).toMatch(/already a member/);
    const t1 = await invite(db, owner, hh, "again@mh.example.test");
    const t2 = await invite(db, owner, hh, "Again@mh.example.test");
    expect(t1).not.toBe(t2);
    const pend = await db.query("select count(*)::int as n from public.household_invites where household_id=$1 and email='again@mh.example.test' and revoked_at is null", [hh]);
    expect(pend.rows[0].n).toBe(1);
  });
  it("audits invite creation without the token or email", async () => {
    const { owner, hh } = await houseWithMember();
    const t = await invite(db, owner, hh, "audit@mh.example.test");
    const rows = (await db.query("select summary, entity_id from public.audit_log where household_id=$1 and action='invite.created'", [hh])).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(t);
    expect(JSON.stringify(rows)).not.toContain("audit@mh");
  });
});

describe("accept_invite", () => {
  const fresh = async () => {
    const owner = await mkUser(db, "o", { creator: true });
    const hh = await createHousehold(db, owner);
    const joiner = await mkUser(db, "joiner", { creator: true });
    return { owner, hh, joiner };
  };
  it("joins as a member, marks accepted, audits", async () => {
    const { owner, hh, joiner } = await fresh();
    const t = await invite(db, owner, hh, joiner.email.toUpperCase());
    const r = await accept(db, joiner, t, "  Jo  ");
    expect(r.error).toBeNull();
    expect(r.rows[0].id).toBe(hh);
    expect(await status(hh, joiner)).toMatchObject({ status: "active", role: "member" });
    const dn = (await db.query("select display_name from public.household_members where user_id=$1", [joiner.sub])).rows[0].display_name;
    expect(dn).toBe("Jo");
    expect((await db.query("select accepted_by from public.household_invites where household_id=$1 and accepted_at is not null", [hh])).rows[0].accepted_by).toBe(joiner.sub);
    expect((await db.query("select 1 from public.audit_log where household_id=$1 and action='invite.accepted' and actor_user_id=$2", [hh, joiner.sub])).rows.length).toBe(1);
  });
  it("fails for the wrong email and leaves the invite pending", async () => {
    const { owner, hh, joiner } = await fresh();
    const thief = await mkUser(db, "thief", { creator: true });
    const t = await invite(db, owner, hh, joiner.email);
    const r = await accept(db, thief, t);
    expect(r.error).not.toBeNull();
    expect(await status(hh, thief)).toBeUndefined();
    expect((await accept(db, joiner, t)).error).toBeNull();
  });
  it("fails when reused", async () => {
    const { owner, hh, joiner } = await fresh();
    const t = await invite(db, owner, hh, joiner.email);
    expect((await accept(db, joiner, t)).error).toBeNull();
    expect((await accept(db, joiner, t)).error?.message).toMatch(/not valid/);
  });
  it("fails when expired", async () => {
    const { owner, hh, joiner } = await fresh();
    const t = await invite(db, owner, hh, joiner.email);
    await db.query("update public.household_invites set expires_at = now() - interval '1 second' where household_id=$1", [hh]);
    expect((await accept(db, joiner, t)).error?.message).toMatch(/not valid/);
    expect(await status(hh, joiner)).toBeUndefined();
  });
  it("fails when revoked, and when superseded by a newer invite", async () => {
    const { owner, hh, joiner } = await fresh();
    const t1 = await invite(db, owner, hh, joiner.email);
    const id = (await db.query("select id from public.household_invites where household_id=$1", [hh])).rows[0].id;
    await runOk(db, owner, "select public.revoke_invite($1)", [id]);
    expect((await accept(db, joiner, t1)).error?.message).toMatch(/not valid/);
    const t2 = await invite(db, owner, hh, joiner.email);
    const t3 = await invite(db, owner, hh, joiner.email);
    expect((await accept(db, joiner, t2)).error).not.toBeNull();
    expect((await accept(db, joiner, t3)).error).toBeNull();
  });
  it("fails for garbage, unknown and anonymous tokens", async () => {
    const { joiner } = await fresh();
    for (const t of ["", "short", "x".repeat(43), "a b".repeat(20), "'; drop table x; --"]) {
      expect((await accept(db, joiner, t)).error).not.toBeNull();
    }
    await db.query("begin");
    await db.query("set local role anon");
    await expect(db.query("select public.accept_invite('x','y')")).rejects.toThrow(/permission denied/);
    await db.query("rollback");
  });
  it("two concurrent accepts: exactly one succeeds", async () => {
    const { owner, hh, joiner } = await fresh();
    const t = await invite(db, owner, hh, joiner.email);
    const c1 = await extraClient();
    const c2 = await extraClient();
    try {
      await openTx(c1, joiner);
      await openTx(c2, joiner);
      await c1.query("select public.accept_invite($1,'One')", [t]); // holds the invite row lock
      let settled = false;
      const p2 = c2.query("select public.accept_invite($1,'Two')", [t]).then(
        () => ({ ok: true as const }),
        (e: Error) => ({ ok: false as const, e }),
      );
      p2.then(() => (settled = true));
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false); // second caller is blocked on FOR UPDATE
      await c1.query("commit");
      const second = await p2;
      await c2.query("rollback");
      expect(second.ok).toBe(false);
      const accepted = await db.query("select count(*)::int as n from public.household_invites where household_id=$1 and accepted_at is not null", [hh]);
      expect(accepted.rows[0].n).toBe(1);
      const m = await db.query("select display_name from public.household_members where household_id=$1 and user_id=$2", [hh, joiner.sub]);
      expect(m.rows).toEqual([{ display_name: "One" }]);
      expect((await db.query("select count(*)::int as n from public.audit_log where household_id=$1 and action='invite.accepted'", [hh])).rows[0].n).toBe(1);
    } finally {
      await c1.end();
      await c2.end();
    }
  });
  it("two concurrent accepts of different tokens by different users both work independently", async () => {
    const { owner, hh } = await fresh();
    const j1 = await mkUser(db, "j1", { creator: true });
    const j2 = await mkUser(db, "j2", { creator: true });
    const [t1, t2] = [await invite(db, owner, hh, j1.email), await invite(db, owner, hh, j2.email)];
    const [r1, r2] = await Promise.all([
      (async () => { const c = await extraClient(); try { await openTx(c, j1); await c.query("select public.accept_invite($1,'A')", [t1]); await c.query("commit"); return true; } finally { await c.end(); } })(),
      (async () => { const c = await extraClient(); try { await openTx(c, j2); await c.query("select public.accept_invite($1,'B')", [t2]); await c.query("commit"); return true; } finally { await c.end(); } })(),
    ]);
    expect([r1, r2]).toEqual([true, true]);
  });
});

describe("remove_member / leave_household", () => {
  it("only active owners remove; removed member loses access immediately; rows are kept", async () => {
    const { owner, hh, member } = await houseWithMember();
    // Fixture rows
    await db.query("insert into public.tasks (household_id, title) values ($1,'secret task')", [hh]);
    const seeTasks = () => run(db, member, "select title from public.tasks where household_id=$1", [hh]);
    expect((await seeTasks()).rows).toHaveLength(1);
    expect((await run(db, member, "select public.remove_member($1,$2)", [hh, owner.sub])).error).not.toBeNull();
    await runOk(db, owner, "select public.remove_member($1,$2)", [hh, member.sub]);
    expect(await status(hh, member)).toMatchObject({ status: "removed", removed_by: owner.sub });
    expect((await seeTasks()).rows).toHaveLength(0);
    expect((await run(db, member, "select id from public.households")).rows).toHaveLength(0);
    expect((await run(db, member, "select 1 from public.household_members where household_id=$1", [hh])).rows).toHaveLength(0);
    expect((await run(db, member, "insert into public.tasks (household_id, title) values ($1,'x')", [hh])).error?.message).toMatch(/row-level security/);
    expect((await run(db, member, "select public.log_audit($1,'a','b',null,null,null,null)", [hh])).error?.message).toMatch(/not a member/);
    expect((await run(db, member, "select public.refresh_my_notifications()")).error).toBeNull();
    expect((await run(db, member, "select public.sync_my_email_threads($1,'Joiner','[]'::jsonb)", [hh])).error?.message).toMatch(/not a member/);
    expect((await run(db, member, "select public.store_my_google_token($1,'v1:abc','s')", [hh])).error?.message).toMatch(/not a member/);
    expect((await db.query("select 1 from public.audit_log where household_id=$1 and action='member.removed'", [hh])).rows.length).toBe(1);
  });
  it("removed member loses document storage access", async () => {
    const { owner, hh, member } = await houseWithMember();
    const name = `${hh}/f-${randomUUID()}.pdf`;
    await db.query("insert into storage.objects (bucket_id, name) values ('documents',$1)", [name]);
    const q = "select name from storage.objects where bucket_id='documents' and name=$1";
    expect((await run(db, member, q, [name])).rows).toHaveLength(1);
    await runOk(db, owner, "select public.remove_member($1,$2)", [hh, member.sub]);
    expect((await run(db, member, q, [name])).rows).toHaveLength(0);
    expect((await run(db, member, "insert into storage.objects (bucket_id, name) values ('documents',$1)", [`${hh}/new.pdf`])).error).not.toBeNull();
    await db.query("delete from storage.objects where name=$1", [name]);
  });
  it("cleans per-user rows for that household only", async () => {
    const { owner, hh, member } = await houseWithMember();
    const other = await houseWithMember(); // member stays in no other house; use a second user row below
    const nid = randomUUID();
    await db.query("insert into public.notifications (id, household_id, kind, title, dedupe_key) values ($1,$2,'system','t','k1')", [nid, hh]);
    await db.query("insert into public.notification_reads (notification_id, household_id, user_id) values ($1,$2,$3),($1,$2,$4)", [nid, hh, member.sub, owner.sub]);
    await db.query("insert into public.push_subscriptions (household_id,user_id,endpoint,p256dh,auth) values ($1,$2,$3,'k','a'),($1,$4,$5,'k','a'),($6,$2,$7,'k','a')",
      [hh, member.sub, `https://p.test/${randomUUID()}`, owner.sub, `https://p.test/${randomUUID()}`, other.hh, `https://p.test/${randomUUID()}`]);
    await db.query("insert into private.google_tokens (user_id, household_id, ciphertext, scopes) values ($1,$2,'v1:x','s')", [member.sub, hh]);
    await runOk(db, owner, "select public.remove_member($1,$2)", [hh, member.sub]);
    const count = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows[0].n as number;
    expect(await count("select count(*)::int n from public.push_subscriptions where user_id=$1 and household_id=$2", [member.sub, hh])).toBe(0);
    expect(await count("select count(*)::int n from public.push_subscriptions where user_id=$1 and household_id=$2", [owner.sub, hh])).toBe(1);
    expect(await count("select count(*)::int n from public.push_subscriptions where user_id=$1 and household_id=$2", [member.sub, other.hh])).toBe(1);
    expect(await count("select count(*)::int n from public.notification_reads where user_id=$1", [member.sub])).toBe(0);
    expect(await count("select count(*)::int n from public.notification_reads where user_id=$1", [owner.sub])).toBe(1);
    expect(await count("select count(*)::int n from private.google_tokens where user_id=$1", [member.sub])).toBe(0);
    expect(await count("select count(*)::int n from public.notifications where household_id=$1", [hh])).toBe(1);
  });
  it("rejects removing someone who is not an active member, or from the wrong household", async () => {
    const a = await houseWithMember();
    const b = await houseWithMember();
    expect((await run(db, a.owner, "select public.remove_member($1,$2)", [a.hh, b.member.sub])).error?.message).toMatch(/not an active member/);
    expect((await run(db, a.owner, "select public.remove_member($1,$2)", [b.hh, b.member.sub])).error).not.toBeNull();
    expect((await run(db, b.owner, "select public.remove_member($1,$2)", [a.hh, a.member.sub])).error).not.toBeNull();
    expect(await status(a.hh, a.member)).toMatchObject({ status: "active" });
  });
  it("a member can leave; an owner cannot leave or remove themselves when last", async () => {
    const { owner, hh, member } = await houseWithMember();
    expect((await run(db, owner, "select public.leave_household($1)", [hh])).error?.message).toMatch(/last owner/);
    expect((await run(db, owner, "select public.remove_member($1,$2)", [hh, owner.sub])).error?.message).toMatch(/last owner/);
    await runOk(db, member, "select public.leave_household($1)", [hh]);
    expect(await status(hh, member)).toMatchObject({ status: "removed", removed_by: member.sub });
    expect((await run(db, member, "select public.leave_household($1)", [hh])).error).not.toBeNull();
    expect((await db.query("select 1 from public.audit_log where household_id=$1 and action='member.left'", [hh])).rows.length).toBe(1);
    expect(await status(hh, owner)).toMatchObject({ status: "active" });
  });
  it("with two owners one can leave, then the last is protected", async () => {
    const { owner, hh, member } = await houseWithMember();
    await db.query("update public.household_members set role='owner' where household_id=$1 and user_id=$2", [hh, member.sub]); // operator action
    await runOk(db, owner, "select public.leave_household($1)", [hh]);
    expect((await run(db, member, "select public.leave_household($1)", [hh])).error?.message).toMatch(/last owner/);
    expect((await run(db, member, "select public.remove_member($1,$2)", [hh, member.sub])).error?.message).toMatch(/last owner/);
  });
  it("a removed person can be re-invited; role resets to member", async () => {
    const { owner, hh, member } = await houseWithMember();
    await db.query("update public.household_members set role='owner' where household_id=$1 and user_id=$2", [hh, member.sub]);
    await runOk(db, owner, "select public.remove_member($1,$2)", [hh, member.sub]);
    const t = await invite(db, owner, hh, member.email);
    expect((await accept(db, member, t, "Back")).error).toBeNull();
    expect(await status(hh, member)).toMatchObject({ status: "active", role: "member", removed_by: null });
    expect((await run(db, member, "select 1 from public.tasks where household_id=$1", [hh])).error).toBeNull();
  });
  it("an active member cannot use an invite to change their own role or details", async () => {
    const { owner, hh, member } = await houseWithMember();
    // create_invite refuses an active member's email; force one as the operator to prove accept_invite also refuses.
    expect((await run(db, owner, "select public.create_invite($1,$2)", [hh, member.email])).error?.message).toMatch(/already a member/);
    await db.query("insert into public.household_invites (household_id,email,token_hash) values ($1,$2,encode(extensions.digest('forced-token-forced-token-1','sha256'),'hex'))", [hh, member.email]);
    const r = await accept(db, member, "forced-token-forced-token-1", "Renamed");
    expect(r.error?.message).toMatch(/already a member/);
    expect((await db.query("select display_name from public.household_members where household_id=$1 and user_id=$2", [hh, member.sub])).rows[0].display_name).toBe("Joiner");
  });
});

describe("no self-promotion", () => {
  it("direct writes to household_members are denied for members and owners", async () => {
    const { owner, hh, member } = await houseWithMember();
    for (const who of [member, owner]) {
      for (const [sql, p] of [
        ["update public.household_members set role='owner' where user_id=$1", [member.sub]],
        ["update public.household_members set status='active'", []],
        ["insert into public.household_members (household_id,user_id,role,display_name) values ($1,$2,'owner','x')", [hh, randomUUID()]],
        ["delete from public.household_members where user_id=$1", [member.sub]],
      ] as const) {
        expect((await run(db, who, sql, [...p])).error?.message).toMatch(/permission denied/);
      }
    }
    expect(await status(hh, member)).toMatchObject({ role: "member" });
  });
  it("no public function other than the audited RPCs writes household_members", async () => {
    const r = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosrc ~* '(insert into|update|delete from)\\s+public\\.household_members'`);
    expect(r.rows.map((x) => x.proname).sort()).toEqual(
      ["accept_invite", "create_household"], // remove/leave go through private.deactivate_member
    );
    const d = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private' and p.prosrc ~* '(insert into|update|delete from)\\s+public\\.household_members'`);
    expect(d.rows.map((x) => x.proname).sort()).toEqual(["deactivate_member", "on_auth_user_created"]);
  });
  it("accept_invite can only ever assign role member", async () => {
    const { owner, hh } = await houseWithMember();
    const j = await mkUser(db, "j", { creator: true });
    await accept(db, j, await invite(db, owner, hh, j.email));
    expect(await status(hh, j)).toMatchObject({ role: "member" });
  });
});

// household_members and kudos need B's members; fixtures created by houseWithMember() already add rows
// for members/invites/audit_log, and the explicit seeds below add a second real row each.

describe("explicit household and active-member guards (security round 1)", () => {
  it("old sync/store signatures no longer exist", async () => {
    const r = await db.query(
      "select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('sync_my_email_threads','store_my_google_token') order by 1",
    );
    expect(r.rows.map((x) => x.sig)).toEqual([
      "store_my_google_token(uuid,text,text)",
      "sync_my_email_threads(uuid,text,jsonb)",
    ]);
    const { owner, hh } = await houseWithMember();
    expect((await run(db, owner, "select public.store_my_google_token('v1:a','s')")).error?.message).toMatch(/does not exist/);
    expect((await run(db, owner, "select public.sync_my_email_threads('Owner','[]'::jsonb)")).error?.message).toMatch(/does not exist/);
    const grants = await db.query(
      "select has_function_privilege('anon','public.store_my_google_token(uuid,text,text)','execute') a, has_function_privilege('authenticated','public.store_my_google_token(uuid,text,text)','execute') b, has_function_privilege('anon','public.sync_my_email_threads(uuid,text,jsonb)','execute') c, has_function_privilege('authenticated','public.sync_my_email_threads(uuid,text,jsonb)','execute') d",
    );
    expect(grants.rows[0]).toEqual({ a: false, b: true, c: false, d: true });
    await runOk(db, owner, "select public.store_my_google_token($1,'v1:a','s')", [hh]);
    expect((await run(db, owner, "select public.sync_my_email_threads($1,'Owner','[]'::jsonb)", [hh])).error).toBeNull();
    await db.query("delete from private.google_tokens where user_id=$1", [owner.sub]);
  });

  it("a household the caller is not an active member of is refused; null too", async () => {
    const a = await houseWithMember();
    const b = await houseWithMember();
    expect((await run(db, a.owner, "select public.store_my_google_token($1,'v1:a','s')", [b.hh])).error?.message).toMatch(/not a member/);
    expect((await run(db, a.owner, "select public.sync_my_email_threads($1,'Owner','[]'::jsonb)", [b.hh])).error?.message).toMatch(/not a member/);
    expect((await run(db, a.owner, "select public.store_my_google_token(null,'v1:a','s')")).error?.message).toMatch(/not a member/);
    expect((await run(db, a.owner, "select public.sync_my_email_threads(null,'Owner','[]'::jsonb)")).error?.message).toMatch(/not a member/);
    const pre = await db.query("select count(*)::int n from public.audit_log where household_id=$1 and action='google.connected'", [b.hh]);
    expect(pre.rows[0].n).toBe(0);
  });

  it("with two memberships the explicit household is the one written", async () => {
    const o1 = await mkUser(db, "o1");
    const h1 = await createHousehold(db, o1, "First");
    const o2 = await mkUser(db, "o2");
    const h2 = await createHousehold(db, o2, "Second");
    // o1 is the OLDEST member of h1, and joins h2 later by invite as "Second-name".
    const token = await invite(db, o2, h2, o1.email);
    const r = await accept(db, o1, token, "Second-name");
    expect(r.error).toBeNull();
    const thread = {
      thread_hash: "a".repeat(64), counterpart_domain: "example.com", subject: "Hello", last_from: "them",
      last_message_at: "2026-10-13T09:00:00Z", label_flag: false,
    };
    // Gmail goes only into the household where Google was connected: connected in h1, so h2 is refused.
    await runOk(db, o1, "select public.store_my_google_token($1,'v1:abc','s')", [h1]);
    expect((await run(db, o1, "select public.sync_my_email_threads($1,'Second-name',$2::jsonb)", [h2, JSON.stringify([thread])])).error?.message).toMatch(/google connected to another household/);
    expect((await db.query("select 1 from public.email_threads where household_id=$1", [h2])).rows.length).toBe(0);
    // Connecting in h2 moves the connection there (explicit consent in that household).
    await runOk(db, o1, "select public.store_my_google_token($1,'v1:abc','s')", [h2]);
    // Display name differs per household, so the name check also follows p_household.
    expect((await run(db, o1, "select public.sync_my_email_threads($1,'Owner','[]'::jsonb)", [h2])).error?.message).toMatch(/member mismatch/);
    await runOk(db, o1, "select public.sync_my_email_threads($1,'Second-name',$2::jsonb)", [h2, JSON.stringify([thread])]);
    const rows = (await db.query("select household_id from public.email_threads where member='Second-name'")).rows;
    expect(rows).toEqual([{ household_id: h2 }]);
    expect((await db.query("select household_id from private.google_tokens where user_id=$1", [o1.sub])).rows).toEqual([{ household_id: h2 }]);
    expect((await db.query("select household_id from public.audit_log where action='google.connected' and actor_user_id=$1 order by id", [o1.sub])).rows).toEqual([{ household_id: h1 }, { household_id: h2 }]);
    await runOk(db, o1, "select public.store_my_google_token($1,'v1:abc','s')", [h1]);
    expect((await db.query("select household_id from private.google_tokens where user_id=$1", [o1.sub])).rows).toEqual([{ household_id: h1 }]);
    // google.test.ts counts every row in private.google_tokens, so leave none behind.
    await db.query("delete from private.google_tokens where user_id=$1", [o1.sub]);
  });

  it("a removed member is refused by sync/store for that household", async () => {
    const { owner, hh, member } = await houseWithMember();
    await runOk(db, owner, "select public.remove_member($1,$2)", [hh, member.sub]);
    expect((await run(db, member, "select public.store_my_google_token($1,'v1:a','s')", [hh])).error?.message).toMatch(/not a member/);
  });

  it("a removed member cannot be assigned a task (insert or update) but an active one can", async () => {
    const { owner, hh, member } = await houseWithMember();
    const t = (await db.query("insert into public.tasks (household_id, title) values ($1,'t') returning id", [hh])).rows[0].id;
    expect((await run(db, owner, "update public.tasks set assignee_user_id=$2 where id=$1", [t, member.sub])).error).toBeNull();
    await runOk(db, owner, "select public.remove_member($1,$2)", [hh, member.sub]);
    expect((await run(db, owner, "update public.tasks set assignee_user_id=$2 where id=$1", [t, member.sub])).error?.message).toMatch(/not a member/);
    expect((await run(db, owner, "insert into public.tasks (household_id, title, assignee_user_id) values ($1,'x',$2)", [hh, member.sub])).error?.message).toMatch(/not a member/);
    // Service-side insert (no JWT) is guarded too.
    await expect(db.query("insert into public.tasks (household_id, title, assignee_user_id) values ($1,'x',$2)", [hh, member.sub])).rejects.toThrow(/not a member/);
  });

  it("completing a recurring task whose assignee was removed still works, unassigned", async () => {
    const { owner, hh, member } = await houseWithMember();
    const t = (await db.query("insert into public.tasks (household_id, title, assignee_user_id, recurrence) values ($1,'r',$2,'weekly') returning id", [hh, member.sub])).rows[0].id;
    await runOk(db, owner, "select public.remove_member($1,$2)", [hh, member.sub]);
    await runOk(db, owner, "update public.tasks set status='done' where id=$1", [t]);
    const n = (await db.query("select assignee_user_id from public.tasks where household_id=$1 and id<>$2 and title='r'", [hh, t])).rows;
    expect(n).toEqual([{ assignee_user_id: null }]);
  });

  it("kudos to or from a removed member are rejected", async () => {
    const { owner, hh, member } = await houseWithMember();
    await runOk(db, owner, "select public.remove_member($1,$2)", [hh, member.sub]);
    const r = await run(db, owner, "insert into public.kudos (household_id, to_user, message) values ($1,$2,'thanks')", [hh, member.sub]);
    expect(r.error).not.toBeNull();
    await expect(
      db.query("insert into public.kudos (household_id, from_user, to_user, message) values ($1,$2,$3,'thanks')", [hh, owner.sub, member.sub]),
    ).rejects.toThrow(/both people must be in the household/);
  });
});

describe("cross-household isolation matrix", () => {
  it("every household table: A cannot read, change, delete or insert into B's real rows", async () => {
    const A = await houseWithMember();
    const B = await houseWithMember();
    await db.query("insert into public.tasks (household_id, title) values ($1,'A-task')", [A.hh]);

    const tables = (await db.query(
      `select table_name from information_schema.columns where table_schema='public' and column_name='household_id' order by 1`,
    )).rows.map((r) => r.table_name as string);
    const missing = tables.filter((t) => !(t in SEEDS));
    expect(missing, "tables with household_id but no matrix seed").toEqual([]);
    expect(Object.keys(SEEDS).filter((t) => !tables.includes(t)), "seeds for unknown tables").toEqual([]);

    const all = [B.hh, B.owner.sub, B.member.sub];
    const prep = (t: string) => {
      const used = [...new Set([...SEEDS[t][1].matchAll(/\$([123])(?!\d)/g)].map((m) => Number(m[1])))].sort();
      const vals = SEEDS[t][1].replace(/\$([123])(?!\d)/g, (_m, d) => `$${used.indexOf(Number(d)) + 1}::uuid`);
      return { sql: `insert into public.${t} (${SEEDS[t][0]}) values (${vals})`, params: used.map((i) => all[i - 1]) };
    };
    for (const t of Object.keys(SEEDS)) {
      if (t === "household_members") continue; // real rows already exist from houseWithMember()
      const q = prep(t);
      await db.query(q.sql, q.params).catch((e) => {
        throw new Error(`seed for ${t} failed: ${e.message}`);
      });
    }
    const snap = async (t: string) =>
      (await db.query(
        `select count(*)::int n, coalesce(md5(string_agg(x::text,'|' order by x::text)),'') h from public.${t} x where household_id=$1`, [B.hh],
      )).rows[0] as { n: number; h: string };

    for (const t of tables) {
      const before = await snap(t);
      expect(before.n, `${t} has no seeded row in B`).toBeGreaterThan(0);
      for (const who of [A.owner, A.member]) {
        const sel = await run(db, who, `select 1 from public.${t} where household_id=$1`, [B.hh]);
        if (sel.error) expect(sel.error.message, `${t} select`).toMatch(/permission denied/);
        else expect(sel.rows, `${t} select`).toHaveLength(0);
        const upd = await run(db, who, `with u as (update public.${t} set household_id=household_id where household_id=$1 returning 1) select count(*)::int n from u`, [B.hh]);
        if (upd.error) expect(upd.error.message, `${t} update`).toMatch(/permission denied/);
        else expect(upd.rows[0].n, `${t} update`).toBe(0);
        const del = await run(db, who, `with d as (delete from public.${t} where household_id=$1 returning 1) select count(*)::int n from d`, [B.hh]);
        if (del.error) expect(del.error.message, `${t} delete`).toMatch(/permission denied/);
        else expect(del.rows[0].n, `${t} delete`).toBe(0);
        const q = prep(t);
        const ins = await run(db, who, q.sql, q.params);
        expect(ins.error, `${t} insert into B must be rejected`).not.toBeNull();
        // Guard triggers (kudos, meal_ingredients, ...) may fire before RLS; any such rejection counts, schema errors do not.
        expect(ins.error!.message, `${t} insert`).not.toMatch(/null value|violates (not-null|check|foreign key|unique)|duplicate key|invalid input|could not determine|does not exist/);
      }
      expect(await snap(t), `${t} B rows changed`).toEqual(before);
    }
    expect((await run(db, A.member, "select title from public.tasks")).rows).toEqual([{ title: "A-task" }]);
    expect((await run(db, A.owner, "select id from public.households where id=$1", [B.hh])).rows).toHaveLength(0);
  });
});
