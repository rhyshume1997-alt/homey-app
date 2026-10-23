import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "3a5a0000-0000-4000-8000-0000000000a1";
const HB = "3a5a0000-0000-4000-8000-0000000000b1";
const U = "3a5a0000-0000-4000-8000-0000000000c1"; // HA
const V = "3a5a0000-0000-4000-8000-0000000000c2"; // HA
const W = "3a5a0000-0000-4000-8000-0000000000c3"; // HB

const id = (kind: number, n: number) => `3a5a0000-0000-4000-8000-${String(kind * 1000 + n).padStart(12, "0")}`;
const WA = id(1, 1);
const WB = id(1, 2);
const RA = id(2, 1); // room in HA
const RB = id(2, 2); // room in HB
const DA = id(3, 1); // document in HA
const DB = id(3, 2); // document in HB

const INS = "insert into public.wishlist_items (id, household_id, title) values ($1,$2,$3)";
const INS_DOC =
  "insert into public.documents (id, household_id, title, category, storage_path, mime_type, size_bytes) values ($1,$2,$3,'other',$4,'image/png',1000)";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'WISH-A'),($2,'WISH-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u@wish.example.test',$1,'owner','U'),('v@wish.example.test',$1,'member','V'),('w@wish.example.test',$2,'owner','W')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1,'u@wish.example.test','{"provider":"google"}'),($2,'v@wish.example.test','{"provider":"google"}'),($3,'w@wish.example.test','{"provider":"google"}')`,
    [U, V, W],
  );
  await db.query("insert into public.rooms (id, household_id, name) values ($1,$2,'Wish room A'),($3,$4,'Wish room B')", [RA, HA, RB, HB]);
  await db.query(INS_DOC, [DA, HA, "Photo A", `${HA}/${DA}/p.png`]);
  await db.query(INS_DOC, [DB, HB, "Photo B", `${HB}/${DB}/p.png`]);
  await db.query(INS, [WA, HA, "fixture a"]);
  await db.query(INS, [WB, HB, "fixture b"]);
}, 60000);

afterAll(async () => {
  await db?.end();
});

describe("anon", () => {
  it("cannot touch the table", async () => {
    for (const sql of ["select * from public.wishlist_items", "update public.wishlist_items set notes='x'", "delete from public.wishlist_items"]) {
      const r = await tryQuery(db, { role: "anon" }, sql);
      expect(r.error?.message).toMatch(/permission denied/);
    }
    const r = await tryQuery(db, { role: "anon" }, `insert into public.wishlist_items (household_id, title) values ('${HA}','x')`);
    expect(r.error?.message).toMatch(/permission denied/);
  });
});

describe("isolation", () => {
  it("members see only their own household rows", async () => {
    const a = await tryQuery(db, authed(U), "select id from public.wishlist_items where id in ($1,$2)", [WA, WB]);
    expect(a.rows).toEqual([{ id: WA }]);
    const b = await tryQuery(db, authed(W), "select id from public.wishlist_items where id in ($1,$2)", [WA, WB]);
    expect(b.rows).toEqual([{ id: WB }]);
  });

  it("another member can update and delete; another household cannot", async () => {
    const other = await as(db, authed(W), async (c) => {
      await c.query("update public.wishlist_items set title='hacked' where id=$1", [WA]);
      await c.query("delete from public.wishlist_items where id=$1", [WA]);
      await c.query("reset role");
      return (await c.query("select title from public.wishlist_items where id=$1", [WA])).rows;
    });
    expect(other).toEqual([{ title: "fixture a" }]);
    const own = await as(db, authed(V), async (c) => {
      await c.query("update public.wishlist_items set title='by v' where id=$1", [WA]);
      return (await c.query("select title from public.wishlist_items where id=$1", [WA])).rows;
    });
    expect(own).toEqual([{ title: "by v" }]);
  });

  it("cannot insert into another household, and household_id is immutable", async () => {
    const a = await tryQuery(db, authed(W), INS, [id(1, 20), HA, "x"]);
    expect(a.error?.message).toMatch(/row-level security/);
    await db.query("begin");
    try {
      await expect(db.query("update public.wishlist_items set household_id=$2 where id=$1", [WA, HB])).rejects.toThrow(/immutable/);
    } finally {
      await db.query("rollback");
    }
  });
});

describe("constraints", () => {
  it("rejects bad values", async () => {
    const t = (col: string, val: unknown): [string, unknown[]] => [
      `insert into public.wishlist_items (household_id, title, ${col}) values ($1,'t',$2)`,
      [HA, val],
    ];
    const bad: Array<[string, unknown[]]> = [
      ["insert into public.wishlist_items (household_id, title) values ($1,'')", [HA]],
      ["insert into public.wishlist_items (household_id, title) values ($1,$2)", [HA, "x".repeat(121)]],
      t("notes", "x".repeat(501)),
      t("priority", "urgent"),
      t("status", "owned"),
      t("price_estimate", -1),
      t("url", "http://shop.example.test/a"),
      t("url", "javascript:alert(1)"),
      t("url", "data:text/html,hi"),
      t("url", "blob:https://x.test/1"),
      t("url", "file:///etc/passwd"),
      t("url", "https://user:pw@shop.example.test/"),
      t("url", "https://shop.example.test/a b"),
      t("url", `https://shop.example.test/${"a".repeat(2048)}`),
    ];
    for (const [sql, params] of bad) {
      const r = await tryQuery(db, authed(U), sql, params);
      expect(r.error?.message, `${sql} ${String(params[1]).slice(0, 30)}`).toMatch(/violates check constraint|numeric field overflow/);
    }
  });

  it("accepts an https url and a price", async () => {
    const r = await as(db, authed(U), async (c) => {
      await c.query(
        "insert into public.wishlist_items (id, household_id, title, url, price_estimate) values ($1,$2,'Lamp','https://shop.example.test/lamp?x=1',49.99)",
        [id(1, 30), HA],
      );
      return (await c.query("select url, price_estimate::text as p from public.wishlist_items where id=$1", [id(1, 30)])).rows[0];
    });
    expect(r).toEqual({ url: "https://shop.example.test/lamp?x=1", p: "49.99" });
  });
});

describe("same-household guards", () => {
  it("rejects a room or photo from another household", async () => {
    const room = await tryQuery(db, authed(U), "insert into public.wishlist_items (household_id, title, room_id) values ($1,'t',$2)", [HA, RB]);
    expect(room.error?.message).toMatch(/room not in this household/);
    const doc = await tryQuery(db, authed(U), "insert into public.wishlist_items (household_id, title, photo_document_id) values ($1,'t',$2)", [HA, DB]);
    expect(doc.error?.message).toMatch(/document not in this household/);
    const upd = await tryQuery(db, authed(U), "update public.wishlist_items set room_id=$2 where id=$1", [WA, RB]);
    expect(upd.error?.message).toMatch(/room not in this household/);
    const upd2 = await tryQuery(db, authed(U), "update public.wishlist_items set photo_document_id=$2 where id=$1", [WA, DB]);
    expect(upd2.error?.message).toMatch(/document not in this household/);
  });

  it("accepts a room and photo from the same household", async () => {
    const r = await as(db, authed(U), async (c) => {
      await c.query("insert into public.wishlist_items (id, household_id, title, room_id, photo_document_id) values ($1,$2,'ok',$3,$4)", [id(1, 31), HA, RA, DA]);
      return (await c.query("select room_id, photo_document_id from public.wishlist_items where id=$1", [id(1, 31)])).rows[0];
    });
    expect(r).toEqual({ room_id: RA, photo_document_id: DA });
  });

  it("deleting the room keeps the item", async () => {
    await db.query("insert into public.rooms (id, household_id, name) values ($1,$2,'Temp wish room')", [id(2, 9), HA]);
    await db.query("insert into public.wishlist_items (id, household_id, title, room_id) values ($1,$2,'keep',$3)", [id(1, 32), HA, id(2, 9)]);
    await db.query("delete from public.rooms where id=$1", [id(2, 9)]);
    const r = await db.query("select room_id from public.wishlist_items where id=$1", [id(1, 32)]);
    expect(r.rows).toEqual([{ room_id: null }]);
  });
});

describe("triggers", () => {
  it("sets bought_at only when status becomes bought and clears it otherwise", async () => {
    const out = await as(db, authed(V), async (c) => {
      const q = "select status, bought_at is not null as has_at from public.wishlist_items where id=$1";
      const rid = id(1, 40);
      await c.query(INS, [rid, HA, "Sofa"]);
      const a = (await c.query(q, [rid])).rows[0];
      await c.query("update public.wishlist_items set status='saving' where id=$1", [rid]);
      const b = (await c.query(q, [rid])).rows[0];
      await c.query("update public.wishlist_items set status='bought' where id=$1", [rid]);
      const d = (await c.query(q, [rid])).rows[0];
      await c.query("update public.wishlist_items set status='idea' where id=$1", [rid]);
      const e = (await c.query(q, [rid])).rows[0];
      return { a, b, d, e };
    });
    expect(out.a).toEqual({ status: "idea", has_at: false });
    expect(out.b).toEqual({ status: "saving", has_at: false });
    expect(out.d).toEqual({ status: "bought", has_at: true });
    expect(out.e).toEqual({ status: "idea", has_at: false });
  });

  it("clients cannot spoof bought_at or created_by", async () => {
    const out = await as(db, authed(U), async (c) => {
      const rid = id(1, 41);
      await c.query("insert into public.wishlist_items (id, household_id, title, created_by, bought_at) values ($1,$2,'s',$3,now())", [rid, HA, V]);
      const a = (await c.query("select created_by, bought_at from public.wishlist_items where id=$1", [rid])).rows[0];
      await c.query("update public.wishlist_items set bought_at=now(), created_by=$2, notes='n' where id=$1", [rid, V]);
      const b = (await c.query("select created_by, bought_at from public.wishlist_items where id=$1", [rid])).rows[0];
      return { a, b };
    });
    expect(out.a).toEqual({ created_by: U, bought_at: null });
    expect(out.b).toEqual({ created_by: U, bought_at: null });
  });
});

describe("audit", () => {
  it("records the title only: no price, no url", async () => {
    const rid = id(1, 60);
    const rows = await as(db, authed(U), async (c) => {
      await c.query(
        "insert into public.wishlist_items (id, household_id, title, url, price_estimate, notes) values ($1,$2,'Rug','https://secret.example.test/rug',123.45,'private note')",
        [rid, HA],
      );
      await c.query("update public.wishlist_items set priority='high' where id=$1", [rid]);
      await c.query("update public.wishlist_items set status='bought' where id=$1", [rid]);
      await c.query("delete from public.wishlist_items where id=$1", [rid]);
      return (
        await c.query(
          "select action, actor_user_id, household_id, entity_type, summary, before, after from public.audit_log where entity_id=$1 order by id",
          [rid],
        )
      ).rows;
    });
    expect(rows.map((r) => r.action)).toEqual(["wishlist.added", "wishlist.updated", "wishlist.bought", "wishlist.removed"]);
    for (const r of rows) {
      expect(r).toMatchObject({ actor_user_id: U, household_id: HA, entity_type: "wishlist_item", summary: "Rug", before: null, after: null });
      expect(JSON.stringify(r)).not.toMatch(/secret|123|private/);
    }
  });
});
