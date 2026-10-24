import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, buildWorld, db, expectRpcDenied, rowsOf, type World } from "./helpers";

// Household A must not read or write household B through PostgREST, even with B's real row ids.
type Spec = {
  table: string;
  key: string;
  value: (w: World) => string;
  cols: string; // explicit columns (household_invites forbids select *: token_hash has no grant)
  insert: (w: World) => Record<string, unknown>;
  update: Record<string, unknown>;
};

const specs: Spec[] = [
  { table: "tasks", key: "id", value: (w) => w.b.seed.taskId, cols: "id,household_id,title", insert: () => ({ title: "intruder" }), update: { title: "hacked" } },
  { table: "snags", key: "id", value: (w) => w.b.seed.snagId, cols: "id,household_id,title", insert: () => ({ title: "intruder" }), update: { title: "hacked" } },
  {
    table: "documents",
    key: "id",
    value: (w) => w.b.seed.documentId,
    cols: "id,household_id,title",
    insert: (w) => ({ title: "intruder", category: "other", storage_path: `${w.b.householdId}/${randomUUID()}/x.pdf`, mime_type: "application/pdf", size_bytes: 1 }),
    update: { title: "hacked" },
  },
  { table: "household_records", key: "id", value: (w) => w.b.seed.recordId, cols: "id,household_id,title", insert: () => ({ category: "contact", title: "intruder" }), update: { title: "hacked" } },
  { table: "wifi_networks", key: "id", value: (w) => w.b.seed.wifiId, cols: "id,household_id,ssid", insert: () => ({ ssid: "intruder", security: "nopass" }), update: { ssid: "hacked" } },
  {
    table: "notifications",
    key: "id",
    value: (w) => w.b.seed.notificationId,
    cols: "id,household_id,title",
    insert: () => ({ kind: "system", title: "intruder", dedupe_key: "intruder" }),
    update: { title: "hacked" },
  },
  {
    table: "household_members",
    key: "user_id",
    value: (w) => w.b.id,
    cols: "user_id,household_id,role",
    insert: (w) => ({ user_id: w.a.id, role: "owner", display_name: "intruder" }),
    update: { display_name: "hacked" },
  },
  {
    table: "household_invites",
    key: "id",
    value: (w) => w.b.seed.inviteId,
    cols: "id,household_id,email",
    insert: () => ({ email: "intruder@example.test", token_hash: "0".repeat(64) }),
    update: { email: "hacked@example.test" },
  },
  { table: "audit_log", key: "id", value: (w) => w.b.seed.auditId, cols: "id,household_id,action", insert: () => ({ action: "x", entity_type: "x" }), update: { summary: "hacked" } },
];

async function snapshot(table: string, household: string): Promise<string[]> {
  return db(async (c) => {
    const r = await c.query(`select to_jsonb(t)::text as j from public.${table} t where household_id = $1`, [household]);
    return (r.rows as { j: string }[]).map((x) => x.j).sort();
  });
}

describe("cross-household isolation through PostgREST", () => {
  let w: World;
  beforeAll(async () => {
    w = await buildWorld();
  });

  it.each(specs.map((s) => [s.table, s] as const))("%s: A cannot select, insert, update or delete B's rows", async (_t, s) => {
    const A = w.a.client;
    const hhB = w.b.householdId;
    const before = await snapshot(s.table, hhB);
    expect(before.length).toBeGreaterThan(0);

    // Positive control: A sees its own rows, and only its own.
    const own = await A.from(s.table).select(s.cols);
    expect(own.error).toBeNull();
    const ownRows = rowsOf(own) as { household_id: string }[];
    expect(ownRows.length).toBeGreaterThan(0);
    expect(ownRows.every((r) => r.household_id === w.a.householdId)).toBe(true);

    // SELECT by B's real id and by B's household id.
    expect(rowsOf(await A.from(s.table).select(s.cols).eq(s.key, s.value(w)))).toHaveLength(0);
    expect(rowsOf(await A.from(s.table).select(s.cols).eq("household_id", hhB))).toHaveLength(0);

    // INSERT into B's household is refused.
    const ins = await A.from(s.table).insert({ household_id: hhB, ...s.insert(w) });
    expect(ins.error).not.toBeNull();

    // UPDATE and DELETE by B's real id affect nothing.
    const upd = await A.from(s.table).update(s.update).eq(s.key, s.value(w)).select(s.cols);
    if (!upd.error) expect(rowsOf(upd)).toHaveLength(0);
    const upd2 = await A.from(s.table).update(s.update).eq("household_id", hhB).select(s.cols);
    if (!upd2.error) expect(rowsOf(upd2)).toHaveLength(0);
    const del = await A.from(s.table).delete().eq(s.key, s.value(w)).select(s.cols);
    if (!del.error) expect(rowsOf(del)).toHaveLength(0);
    const del2 = await A.from(s.table).delete().eq("household_id", hhB).select(s.cols);
    if (!del2.error) expect(rowsOf(del2)).toHaveLength(0);

    // The database confirms B's rows are byte-for-byte unchanged (no insert, edit or delete landed).
    expect(await snapshot(s.table, hhB)).toEqual(before);
  });

  it("A cannot move its own row into B's household", async () => {
    const res = await w.a.client.from("tasks").update({ household_id: w.b.householdId }).eq("id", w.a.seed.taskId).select("id");
    if (!res.error) expect(rowsOf(res)).toHaveLength(0);
    const rows = await db(async (c) => (await c.query("select household_id from public.tasks where id = $1", [w.a.seed.taskId])).rows);
    expect(rows[0].household_id).toBe(w.a.householdId);
  });

  it("B's households row is invisible to A", async () => {
    expect(rowsOf(await w.a.client.from("households").select("id").eq("id", w.b.householdId))).toHaveLength(0);
  });

  it("an unauthenticated client reads nothing and cannot call the household RPCs", async () => {
    const anon = anonClient();
    for (const s of specs) {
      expect(rowsOf(await anon.from(s.table).select(s.cols))).toHaveLength(0);
    }
    expectRpcDenied(await anon.rpc("create_household", { p_name: "x", p_display_name: "x" }));
    expectRpcDenied(await anon.rpc("accept_invite", { p_token: "x", p_display_name: "x" }));
  });
});
