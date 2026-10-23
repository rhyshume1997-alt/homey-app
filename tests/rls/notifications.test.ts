import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "40710000-0000-4000-8000-0000000000a1";
const HB = "40710000-0000-4000-8000-0000000000a2";
const U1 = "40710000-0000-4000-8000-0000000000b1"; // HA
const U2 = "40710000-0000-4000-8000-0000000000b2"; // HA
const U3 = "40710000-0000-4000-8000-0000000000b3"; // HB

const nid = (n: number) => `40710000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const N_ALL = nid(1);
const N_U1 = nid(2);
const N_B = nid(3);

const TODAY = "(now() at time zone 'Europe/London')::date";
const INS_N =
  "insert into public.notifications (id, household_id, recipient_user_id, kind, title, dedupe_key) values ($1,$2,$3,'system',$4,$5)";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
}, 30000);

afterAll(async () => {
  await db?.end();
});

beforeAll(async () => {
  await db.query(`insert into public.households (id, name) values ($1,'NOTIF-A'),($2,'NOTIF-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u1@notify.example.test',$1,'owner','U1'),('u2@notify.example.test',$1,'member','U2'),('u3@notify.example.test',$2,'owner','U3')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values
    ($1,'u1@notify.example.test','{"provider":"google"}'),($2,'u2@notify.example.test','{"provider":"google"}'),($3,'u3@notify.example.test','{"provider":"google"}')`,
    [U1, U2, U3],
  );
  await db.query(INS_N, [N_ALL, HA, null, "for everyone", "k-all"]);
  await db.query(INS_N, [N_U1, HA, U1, "for u1 only", "k-u1"]);
  await db.query(INS_N, [N_B, HB, null, "household b", "k-b"]);
  // Generator fixtures in household A.
  await db.query(
    `insert into public.tasks (id, household_id, title, due_date) values
     ($1,$3,'Due today task',${TODAY}),($2,$3,'Overdue task',${TODAY} - 3)`,
    [nid(10), nid(11), HA],
  );
  await db.query(
    `insert into public.household_records (id, household_id, category, title, renewal_date, amount, unit, reference_last4)
     values ($1,$2,'insurance','Home insurance',${TODAY} + 10, 123.45, 'GBP', '9876')`,
    [nid(20), HA],
  );
  await db.query(`insert into public.tasks (id, household_id, title, due_date) values ($1,$2,'B task',${TODAY})`, [nid(12), HB]);
});

const titles = (rows: unknown[]) => (rows as { title: string }[]).map((r) => r.title).sort();

describe("anon", () => {
  it("cannot touch notifications or run the generator", async () => {
    for (const sql of [
      "select * from public.notifications",
      "select * from public.notification_reads",
      "select public.refresh_my_notifications()",
    ]) {
      const r = await tryQuery(db, { role: "anon" }, sql);
      expect(r.error?.message, sql).toMatch(/permission denied/);
    }
  });
});

describe("select isolation and targeting", () => {
  it("members see household-wide and own targeted notifications", async () => {
    const r1 = await tryQuery(db, authed(U1), "select title from public.notifications where household_id=$1", [HA]);
    expect(titles(r1.rows)).toContain("for everyone");
    expect(titles(r1.rows)).toContain("for u1 only");
  });

  it("a targeted notification is hidden from the other member", async () => {
    const r = await tryQuery(db, authed(U2), "select title from public.notifications where household_id=$1", [HA]);
    expect(titles(r.rows)).toContain("for everyone");
    expect(titles(r.rows)).not.toContain("for u1 only");
  });

  it("other households see nothing", async () => {
    const r = await tryQuery(db, authed(U3), "select title from public.notifications where id in ($1,$2)", [N_ALL, N_U1]);
    expect(r.rows).toEqual([]);
  });
});

describe("no user writes to notifications", () => {
  it("insert, update and delete are denied", async () => {
    const ins = await tryQuery(db, authed(U1), INS_N, [nid(30), HA, null, "x", "k-x"]);
    expect(ins.error?.message).toMatch(/permission denied/);
    const upd = await tryQuery(db, authed(U1), "update public.notifications set title='x'");
    expect(upd.error?.message).toMatch(/permission denied/);
    const del = await tryQuery(db, authed(U1), "delete from public.notifications");
    expect(del.error?.message).toMatch(/permission denied/);
  });
});

describe("notification_reads", () => {
  it("a member can mark a visible notification read, only for themselves", async () => {
    const out = await as(db, authed(U1), async (c) => {
      await c.query("insert into public.notification_reads (notification_id) values ($1)", [N_ALL]);
      return (await c.query("select user_id from public.notification_reads")).rows;
    });
    expect(out).toEqual([{ user_id: U1 }]);
  });

  it("cannot write a read on behalf of someone else", async () => {
    const r = await tryQuery(db, authed(U1), "insert into public.notification_reads (notification_id, user_id) values ($1,$2)", [N_ALL, U2]);
    expect(r.error?.message).toMatch(/row-level security/);
  });

  it("cannot mark a notification read that they cannot see", async () => {
    const hidden = await tryQuery(db, authed(U2), "insert into public.notification_reads (notification_id) values ($1)", [N_U1]);
    expect(hidden.error?.message).toMatch(/row-level security/);
    const other = await tryQuery(db, authed(U3), "insert into public.notification_reads (notification_id) values ($1)", [N_ALL]);
    expect(other.error?.message).toMatch(/row-level security/);
  });

  it("reads of others are invisible and cannot be deleted by others", async () => {
    const out = await as(db, authed(U1), async (c) => {
      await c.query("insert into public.notification_reads (notification_id) values ($1)", [N_ALL]);
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U2, role: "authenticated" })]);
      const seen = (await c.query("select * from public.notification_reads")).rows;
      await c.query("delete from public.notification_reads");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U1, role: "authenticated" })]);
      const still = (await c.query("select user_id from public.notification_reads")).rows;
      return { seen, still };
    });
    expect(out.seen).toEqual([]);
    expect(out.still).toEqual([{ user_id: U1 }]);
  });

  it("update is not granted", async () => {
    const r = await tryQuery(db, authed(U1), "update public.notification_reads set read_at = now()");
    expect(r.error?.message).toMatch(/permission denied/);
  });
});

describe("link check", () => {
  it("rejects protocol-relative and absolute links, accepts relative", async () => {
    for (const link of ["//evil.com", "https://evil.com", "javascript:alert(1)", "/a b", "tasks"]) {
      await db.query("begin");
      try {
        await expect(
          db.query(
            "insert into public.notifications (household_id, kind, title, link, dedupe_key) values ($1,'system','t',$2,'k-link')",
            [HA, link],
          ),
          link,
        ).rejects.toThrow(/violates check constraint/);
      } finally {
        await db.query("rollback");
      }
    }
    await db.query("begin");
    try {
      await db.query(
        "insert into public.notifications (household_id, kind, title, link, dedupe_key) values ($1,'system','t','/tasks?x=1','k-link-ok')",
        [HA],
      );
    } finally {
      await db.query("rollback");
    }
  });

  it("rejects bad kinds and over-long titles", async () => {
    for (const [kind, title] of [["nope", "t"], ["system", ""], ["system", "x".repeat(121)]]) {
      await db.query("begin");
      try {
        await expect(
          db.query("insert into public.notifications (household_id, kind, title, dedupe_key) values ($1,$2,$3,'k-bad')", [HA, kind, title]),
        ).rejects.toThrow(/violates check constraint/);
      } finally {
        await db.query("rollback");
      }
    }
  });

  it("dedupe_key is unique per household", async () => {
    await db.query("begin");
    try {
      await expect(db.query(INS_N, [nid(31), HA, null, "dup", "k-all"])).rejects.toThrow(/duplicate key/);
    } finally {
      await db.query("rollback");
    }
  });
});

describe("refresh_my_notifications", () => {
  const callAs = async (c: Db, sub: string) => {
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: "authenticated" })]);
    return Number((await c.query("select public.refresh_my_notifications() as n")).rows[0]!.n);
  };

  it("generates for own household only, from titles only", async () => {
    const out = await as(db, authed(U1), async (c) => {
      const n = await callAs(c, U1);
      const rows = (await c.query("select household_id, kind, title, body, link, dedupe_key from public.notifications where dedupe_key not like 'k-%'")).rows;
      return { n, rows };
    });
    expect(out.n).toBe(3);
    const kinds = (out.rows as { kind: string }[]).map((r) => r.kind).sort();
    expect(kinds).toEqual(["renewal_due", "task_due", "task_overdue"]);
    for (const r of out.rows as { household_id: string; title: string; body: string | null; link: string | null }[]) {
      expect(r.household_id).toBe(HA);
      expect(`${r.title} ${r.body ?? ""}`).not.toMatch(/123|9876/);
      expect(r.link === null || /^\/[A-Za-z0-9/_?=&.-]*$/.test(r.link)).toBe(true);
    }
    expect((out.rows as { title: string }[]).some((r) => r.title.includes("B task"))).toBe(false);
  });

  it("is idempotent via dedupe_key", async () => {
    const out = await as(db, authed(U1), async (c) => {
      const first = await callAs(c, U1);
      const count1 = Number((await c.query("select count(*) as n from public.notifications")).rows[0]!.n);
      // Clear the rate limit (superuser) to prove dedupe_key, not the limiter, prevents duplicates.
      await c.query("reset role");
      await c.query("delete from private.notification_runs");
      await c.query("set local role authenticated");
      const second = await callAs(c, U1);
      const count2 = Number((await c.query("select count(*) as n from public.notifications")).rows[0]!.n);
      return { first, second, count1, count2 };
    });
    expect(out.first).toBe(3);
    expect(out.second).toBe(0);
    expect(out.count2).toBe(out.count1);
  });

  it("rate limits repeat calls for the same household within 60 seconds", async () => {
    const out = await as(db, authed(U1), async (c) => {
      const first = await callAs(c, U1);
      // A new task would otherwise be picked up by a second run.
      await c.query("reset role");
      await c.query(`insert into public.tasks (id, household_id, title, due_date) values ($1,$2,'Late task',${TODAY} - 1)`, [nid(13), HA]);
      await c.query("set local role authenticated");
      const second = await callAs(c, U2); // same household, other member
      await c.query("reset role");
      await c.query("update private.notification_runs set last_run = now() - interval '2 minutes'");
      await c.query("set local role authenticated");
      const third = await callAs(c, U1);
      return { first, second, third };
    });
    expect(out.first).toBe(3);
    expect(out.second).toBe(0);
    expect(out.third).toBe(1);
  });

  it("never crosses households", async () => {
    const out = await as(db, authed(U3), async (c) => {
      const n = await callAs(c, U3);
      const rows = (await c.query("select household_id, title from public.notifications where dedupe_key not like 'k-%'")).rows as { household_id: string; title: string }[];
      await c.query("reset role");
      const aRows = (await c.query("select count(*) as n from public.notifications where household_id=$1 and dedupe_key not like 'k-%'", [HA])).rows;
      return { n, rows, aRows };
    });
    expect(out.n).toBe(1);
    expect(out.rows.every((r) => r.household_id === HB)).toBe(true);
    expect(Number((out.aRows[0] as { n: string | number }).n)).toBe(0);
  });

  it("works whether or not the optional bin and document tables exist", async () => {
    const t = (await db.query("select to_regclass('public.bin_collections') as b, to_regclass('public.documents') as d")).rows[0];
    const out = await as(db, authed(U1), async (c) => callAs(c, U1));
    expect(out).toBe(3);
    expect(t).toBeDefined();
  });

  it("a user with no household gets zero", async () => {
    const r = await tryQuery(db, authed("40710000-0000-4000-8000-0000000000ff"), "select public.refresh_my_notifications() as n");
    expect(r.error).toBeNull();
    expect(Number((r.rows[0] as { n: number }).n)).toBe(0);
  });
});
