import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

// Own fixture ids: independent of the other RLS test files.
const HA = "5c4e0000-0000-4000-8000-0000000000a1";
const HB = "5c4e0000-0000-4000-8000-0000000000a2";
const U1 = "5c4e0000-0000-4000-8000-0000000000b1"; // HA
const U2 = "5c4e0000-0000-4000-8000-0000000000b2"; // HB
const NOBODY = "5c4e0000-0000-4000-8000-0000000000ff"; // no household

const sid = (n: number) => `5c4e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const TODAY = "(now() at time zone 'Europe/London')::date";
const RUN = "select private.run_scheduled_jobs() as r";
const PRIVATE_FNS = ["private.run_scheduled_jobs()", "private.generate_household_notifications(uuid)"];

type Summary = { households: number; notifications: number; signatures_pruned: number };

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'SCHED-A'),($2,'SCHED-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u1@sched.example.test',$1,'owner','U1'),('u2@sched.example.test',$2,'owner','U2')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values
    ($1,'u1@sched.example.test','{"provider":"google"}'),($2,'u2@sched.example.test','{"provider":"google"}')`,
    [U1, U2],
  );
  // Household A: one task due today, one overdue. Household B: one task due tomorrow, one renewal.
  await db.query(
    `insert into public.tasks (id, household_id, title, due_date) values
     ($1,$3,'Sched A today',${TODAY}),($2,$3,'Sched A overdue',${TODAY} - 2)`,
    [sid(10), sid(11), HA],
  );
  await db.query(`insert into public.tasks (id, household_id, title, due_date) values ($1,$2,'Sched B tomorrow',${TODAY} + 1)`, [
    sid(12),
    HB,
  ]);
  await db.query(
    `insert into public.household_records (id, household_id, category, title, renewal_date)
     values ($1,$2,'insurance','Sched B insurance',${TODAY} + 5)`,
    [sid(20), HB],
  );
}, 30000);

afterAll(async () => {
  await db?.end();
});

/** Runs fn as the admin inside a transaction that is always rolled back. */
async function rolledBack<T>(fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

const run = async (c: Db) => (await c.query(RUN)).rows[0]!.r as Summary;

const generated = async (c: Db, hh: string) =>
  (
    await c.query(
      "select kind, title, dedupe_key from public.notifications where household_id=$1 order by kind, dedupe_key",
      [hh],
    )
  ).rows as { kind: string; title: string; dedupe_key: string }[];

describe("API roles cannot run the scheduled jobs", () => {
  it("anon and authenticated cannot execute the private functions", async () => {
    for (const actor of [{ role: "anon" } as const, authed(U1)]) {
      for (const sql of [
        "select private.run_scheduled_jobs()",
        `select private.generate_household_notifications('${HA}')`,
      ]) {
        const r = await tryQuery(db, actor, sql);
        expect(r.error?.message, `${actor.role}: ${sql}`).toMatch(/permission denied/);
      }
    }
  });

  it("execute is not granted to public, anon or authenticated", async () => {
    for (const fn of PRIVATE_FNS) {
      for (const role of ["public", "anon", "authenticated"]) {
        const sql =
          role === "public"
            ? "select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as ok"
            : `select has_function_privilege('${role}', $1::text, 'execute') as ok`;
        const r = await db.query(sql, [fn]);
        expect(r.rows[0]!.ok, `${role} on ${fn}`).toBe(false);
      }
    }
  });

  it("the private functions are security definer with an empty search_path", async () => {
    const r = await db.query(
      `select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname in ('run_scheduled_jobs', 'generate_household_notifications')
       order by p.proname`,
    );
    const rows = r.rows as { proname: string; prosecdef: boolean; proconfig: string[] | null }[];
    expect(rows.map((x) => x.proname)).toEqual(["generate_household_notifications", "run_scheduled_jobs"]);
    for (const x of rows) {
      expect(x.prosecdef, x.proname).toBe(true);
      expect(x.proconfig, x.proname).toHaveLength(1);
      expect(x.proconfig![0], x.proname).toMatch(/^search_path=(""|)$/);
    }
  });
});

describe("private.run_scheduled_jobs", () => {
  it("generates notifications for every household, each in its own household", async () => {
    const out = await rolledBack(async () => {
      const summary = await run(db);
      return { summary, a: await generated(db, HA), b: await generated(db, HB) };
    });
    expect(out.summary.households).toBeGreaterThanOrEqual(2);
    expect(out.summary.notifications).toBeGreaterThanOrEqual(4);
    expect(out.a.map((r) => r.kind)).toEqual(["task_due", "task_overdue"]);
    expect(out.b.map((r) => r.kind)).toEqual(["renewal_due", "task_due"]);
    expect(out.a.some((r) => r.title.includes("Sched B"))).toBe(false);
    expect(out.b.some((r) => r.title.includes("Sched A"))).toBe(false);
    expect(out.a.find((r) => r.kind === "task_due")!.title).toBe("Due today: Sched A today");
    expect(out.b.find((r) => r.kind === "task_due")!.title).toBe("Due tomorrow: Sched B tomorrow");
  });

  it("running twice creates no duplicates", async () => {
    const out = await rolledBack(async () => {
      const first = await run(db);
      const a1 = await generated(db, HA);
      const b1 = await generated(db, HB);
      const second = await run(db);
      const a2 = await generated(db, HA);
      const b2 = await generated(db, HB);
      return { first, second, a1, b1, a2, b2 };
    });
    expect(out.first.notifications).toBeGreaterThanOrEqual(4);
    expect(out.second.notifications).toBe(0);
    expect(out.second.households).toBe(out.first.households);
    expect(out.a2).toEqual(out.a1);
    expect(out.b2).toEqual(out.b1);
  });

  it("ignores and leaves alone the per-user rate limit", async () => {
    const out = await rolledBack(async () => {
      await db.query("insert into private.notification_runs (household_id, last_run) values ($1, now())", [HA]);
      await run(db);
      const a = await generated(db, HA);
      const runs = (
        await db.query("select household_id, last_run = now() as same from private.notification_runs where household_id in ($1,$2)", [
          HA,
          HB,
        ])
      ).rows;
      return { a, runs };
    });
    expect(out.a.map((r) => r.kind)).toEqual(["task_due", "task_overdue"]);
    expect(out.runs).toEqual([{ household_id: HA, same: true }]);
  });

  it("prunes used signatures older than a day and keeps recent ones", async () => {
    const out = await rolledBack(async () => {
      await db.query(
        `insert into private.used_signatures (sig, used_at) values
         ('sched-test-old', now() - interval '2 days'),
         ('sched-test-25h', now() - interval '25 hours'),
         ('sched-test-23h', now() - interval '23 hours'),
         ('sched-test-new', now())`,
      );
      const summary = await run(db);
      const left = (await db.query("select sig from private.used_signatures where sig like 'sched-test-%' order by sig")).rows;
      return { summary, left };
    });
    expect(out.summary.signatures_pruned).toBeGreaterThanOrEqual(2);
    expect(out.left).toEqual([{ sig: "sched-test-23h" }, { sig: "sched-test-new" }]);
  });
});

describe("refresh_my_notifications after the refactor", () => {
  const callAs = async (c: Db, claims: Record<string, string>) => {
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    return Number((await c.query("select public.refresh_my_notifications() as n")).rows[0]!.n);
  };

  it("still generates for a member's own household only, rate limited", async () => {
    const out = await as(db, authed(U1), async (c) => {
      const first = await callAs(c, { sub: U1, role: "authenticated" });
      const rows = (await c.query("select household_id, kind from public.notifications order by kind")).rows;
      const second = await callAs(c, { sub: U1, role: "authenticated" });
      await c.query("reset role");
      const b = await generated(c, HB);
      return { first, rows, second, b };
    });
    expect(out.first).toBe(2);
    expect(out.rows).toEqual([
      { household_id: HA, kind: "task_due" },
      { household_id: HA, kind: "task_overdue" },
    ]);
    expect(out.second).toBe(0);
    expect(out.b).toEqual([]);
  });

  it("adds nothing after the scheduled run has already generated", async () => {
    const out = await rolledBack(async () => {
      await run(db);
      await db.query("set local role authenticated");
      return callAs(db, { sub: U2, role: "authenticated" });
    });
    expect(out).toBe(0);
  });

  it("returns 0 with no signed-in user or no household, and anon still cannot call it", async () => {
    const noSub = await as(db, authed(U1), async (c) => callAs(c, { role: "authenticated" }));
    expect(noSub).toBe(0);
    const r = await tryQuery(db, authed(NOBODY), "select public.refresh_my_notifications() as n");
    expect(r.error).toBeNull();
    expect(Number((r.rows[0] as { n: number }).n)).toBe(0);
    const anon = await tryQuery(db, { role: "anon" }, "select public.refresh_my_notifications()");
    expect(anon.error?.message).toMatch(/permission denied/);
  });
});
