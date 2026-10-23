import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "a9900000-0000-4000-8000-0000000000a1";
const HB = "a9900000-0000-4000-8000-0000000000b1";
const U = "a9900000-0000-4000-8000-0000000000c1"; // HA
const V = "a9900000-0000-4000-8000-0000000000c2"; // HA
const W = "a9900000-0000-4000-8000-0000000000c3"; // HB

const id = (kind: number, n: number) => `a9900000-0000-4000-8000-${String(kind * 1000 + n).padStart(12, "0")}`;
const AA = id(1, 1);
const AB = id(1, 2);
const RA = id(2, 1);
const RB = id(2, 2);
const DA = id(3, 1);
const DB = id(3, 2);

const INS = "insert into public.appliances (id, household_id, name) values ($1,$2,$3)";
const INS_DOC =
  "insert into public.documents (id, household_id, title, category, storage_path, mime_type, size_bytes) values ($1,$2,'d','warranty',$3,'application/pdf',1)";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'APP-A'),($2,'APP-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u@app.example.test',$1,'owner','U'),('v@app.example.test',$1,'member','V'),('w@app.example.test',$2,'owner','W')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1,'u@app.example.test','{"provider":"google"}'),($2,'v@app.example.test','{"provider":"google"}'),($3,'w@app.example.test','{"provider":"google"}')`,
    [U, V, W],
  );
  await db.query("insert into public.rooms (id, household_id, name) values ($1,$2,'Kitchen A'),($3,$4,'Kitchen B')", [RA, HA, RB, HB]);
  await db.query(INS_DOC, [DA, HA, `${HA}/${DA}/a.pdf`]);
  await db.query(INS_DOC, [DB, HB, `${HB}/${DB}/b.pdf`]);
  await db.query(INS, [AA, HA, "Fixture A"]);
  await db.query(INS, [AB, HB, "Fixture B"]);
}, 60000);

afterAll(async () => {
  await db?.end();
});

describe("anon", () => {
  it("cannot touch the table", async () => {
    for (const sql of ["select * from public.appliances", "update public.appliances set notes='x'", "delete from public.appliances"]) {
      const r = await tryQuery(db, { role: "anon" }, sql);
      expect(r.error?.message).toMatch(/permission denied/);
    }
    const r = await tryQuery(db, { role: "anon" }, `insert into public.appliances (household_id, name) values ('${HA}','x')`);
    expect(r.error?.message).toMatch(/permission denied/);
  });
});

describe("isolation", () => {
  it("members see only their own household rows", async () => {
    const a = await tryQuery(db, authed(U), "select id from public.appliances where id in ($1,$2)", [AA, AB]);
    expect(a.rows).toEqual([{ id: AA }]);
    const b = await tryQuery(db, authed(W), "select id from public.appliances where id in ($1,$2)", [AA, AB]);
    expect(b.rows).toEqual([{ id: AB }]);
  });

  it("a member of the same household can update and delete", async () => {
    const out = await as(db, authed(V), async (c) => {
      await c.query("update public.appliances set make='Bosch' where id=$1", [AA]);
      const m = (await c.query("select make from public.appliances where id=$1", [AA])).rows;
      await c.query("delete from public.appliances where id=$1", [AA]);
      const gone = (await c.query("select id from public.appliances where id=$1", [AA])).rows;
      return { m, gone };
    });
    expect(out).toEqual({ m: [{ make: "Bosch" }], gone: [] });
  });

  it("other household cannot update or delete", async () => {
    const out = await as(db, authed(W), async (c) => {
      await c.query("update public.appliances set name='hacked' where id=$1", [AA]);
      await c.query("delete from public.appliances where id=$1", [AA]);
      await c.query("reset role");
      return (await c.query("select name from public.appliances where id=$1", [AA])).rows;
    });
    expect(out).toEqual([{ name: "Fixture A" }]);
  });

  it("cannot insert into another household", async () => {
    const r = await tryQuery(db, authed(W), INS, [id(1, 20), HA, "x"]);
    expect(r.error?.message).toMatch(/row-level security/);
  });

  it("household_id is immutable", async () => {
    await db.query("begin");
    try {
      await expect(db.query("update public.appliances set household_id=$2 where id=$1", [AA, HB])).rejects.toThrow(/immutable/);
    } finally {
      await db.query("rollback");
    }
  });
});

describe("links stay inside the household", () => {
  it("accepts own room and documents", async () => {
    const r = await tryQuery(
      db, authed(U),
      "insert into public.appliances (id, household_id, name, room_id, manual_document_id, receipt_document_id) values ($1,$2,'ok',$3,$4,$4)",
      [id(1, 30), HA, RA, DA],
    );
    expect(r.error).toBeNull();
  });

  it("rejects another household's room or documents", async () => {
    const room = await tryQuery(db, authed(U), "insert into public.appliances (household_id, name, room_id) values ($1,'x',$2)", [HA, RB]);
    expect(room.error?.message).toMatch(/room not in this household/);
    const manual = await tryQuery(db, authed(U), "insert into public.appliances (household_id, name, manual_document_id) values ($1,'x',$2)", [HA, DB]);
    expect(manual.error?.message).toMatch(/document not in this household/);
    const receipt = await tryQuery(db, authed(U), "update public.appliances set receipt_document_id=$2 where id=$1", [AA, DB]);
    expect(receipt.error?.message).toMatch(/document not in this household/);
  });

  it("deleting a room or document keeps the appliance", async () => {
    const out = await as(db, authed(U), async (c) => {
      await c.query(
        "insert into public.appliances (id, household_id, name, room_id, manual_document_id) values ($1,$2,'linked',$3,$4)",
        [id(1, 31), HA, RA, DA],
      );
      await c.query("reset role");
      await c.query("delete from public.rooms where id=$1", [RA]);
      await c.query("delete from public.documents where id=$1", [DA]);
      return (await c.query("select room_id, manual_document_id from public.appliances where id=$1", [id(1, 31)])).rows;
    });
    expect(out).toEqual([{ room_id: null, manual_document_id: null }]);
  });
});

describe("constraints", () => {
  it("rejects bad values", async () => {
    const bad: Array<[string, unknown[]]> = [
      ["insert into public.appliances (household_id, name) values ($1,'')", [HA]],
      ["insert into public.appliances (household_id, name) values ($1,$2)", [HA, "x".repeat(81)]],
      ["insert into public.appliances (household_id, name, make) values ($1,'n',$2)", [HA, "x".repeat(61)]],
      ["insert into public.appliances (household_id, name, model) values ($1,'n',$2)", [HA, "x".repeat(61)]],
      ["insert into public.appliances (household_id, name, serial_last4) values ($1,'n','12345')", [HA]],
      ["insert into public.appliances (household_id, name, serial_last4) values ($1,'n','123')", [HA]],
      ["insert into public.appliances (household_id, name, notes) values ($1,'n',$2)", [HA, "x".repeat(501)]],
      ["insert into public.appliances (household_id, name, source) values ($1,'n','import')", [HA]],
      ["insert into public.appliances (household_id, name, source_message_hash) values ($1,'n','short')", [HA]],
    ];
    for (const [sql, params] of bad) {
      const r = await tryQuery(db, authed(U), sql, params);
      expect(r.error?.message, sql).toMatch(/violates check constraint/);
    }
  });

  it("source_message_hash is unique per household, and only when set", async () => {
    const hash = "a".repeat(64);
    const out = await as(db, authed(U), async (c) => {
      const ins = "insert into public.appliances (id, household_id, name, source, source_message_hash) values ($1,$2,'e','email',$3)";
      await c.query(ins, [id(1, 40), HA, hash]);
      let dup: Error | null = null;
      await c.query("savepoint s");
      try {
        await c.query(ins, [id(1, 41), HA, hash]);
      } catch (e) {
        dup = e as Error;
      }
      await c.query("rollback to savepoint s");
      await c.query(INS, [id(1, 42), HA, "no hash 1"]);
      await c.query(INS, [id(1, 43), HA, "no hash 2"]);
      return dup;
    });
    expect(out?.message).toMatch(/duplicate key/);
    // the same hash in another household is fine
    const other = await tryQuery(
      db, authed(W),
      "insert into public.appliances (household_id, name, source, source_message_hash) values ($1,'e','email',$2)",
      [HB, "a".repeat(64)],
    );
    expect(other.error).toBeNull();
  });
});

describe("audit", () => {
  it("records created, updated and deleted with the name only", async () => {
    const rid = id(1, 60);
    const rows = await as(db, authed(U), async (c) => {
      await c.query("insert into public.appliances (id, household_id, name, serial_last4, notes) values ($1,$2,'Boiler','AB12','secret note')", [rid, HA]);
      await c.query("update public.appliances set make='Worcester' where id=$1", [rid]);
      await c.query("delete from public.appliances where id=$1", [rid]);
      return (
        await c.query(
          "select action, actor_user_id, household_id, entity_type, summary, before, after from public.audit_log where entity_id=$1 order by id",
          [rid],
        )
      ).rows as Array<Record<string, unknown>>;
    });
    expect(rows.map((r) => r.action)).toEqual(["appliance.created", "appliance.updated", "appliance.deleted"]);
    for (const r of rows) {
      expect(r.summary).toBe("Boiler");
      expect(r.entity_type).toBe("appliance");
      expect(r.household_id).toBe(HA);
      expect(r.actor_user_id).toBe(U);
      expect(JSON.stringify(r)).not.toMatch(/AB12|secret note/);
    }
  });

  it("is not visible to another household", async () => {
    const r = await as(db, authed(W), async (c) => {
      await c.query(INS, [id(1, 70), HB, "Private"]);
      return (await c.query("select id from public.audit_log where entity_id=$1 and household_id=$2", [id(1, 70), HA])).rows;
    });
    expect(r).toEqual([]);
  });
});
