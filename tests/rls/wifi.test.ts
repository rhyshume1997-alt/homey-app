import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "3ff10000-0000-4000-8000-0000000000a1";
const HB = "3ff10000-0000-4000-8000-0000000000b1";
const U = "3ff10000-0000-4000-8000-0000000000c1"; // HA
const V = "3ff10000-0000-4000-8000-0000000000c2"; // HA
const W = "3ff10000-0000-4000-8000-0000000000c3"; // HB
const NA = "3ff10000-0000-4000-8000-000000001001";
const NB = "3ff10000-0000-4000-8000-000000001002";
const CIPHER = "v1:aaaaaaaaaaaaaaaa:bbbbbbbb:cccccccccccccccccccccc";
const SECRET_MARKER = "never-in-audit";

const INS = "insert into public.wifi_networks (id, household_id, ssid, security, password_ciphertext) values ($1,$2,$3,'WPA',$4)";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
  await db.query(`insert into public.households (id, name) values ($1,'WIFI-A'),($2,'WIFI-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('u@wifi.example.test',$1,'owner','U'),('v@wifi.example.test',$1,'member','V'),('w@wifi.example.test',$2,'owner','W')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1,'u@wifi.example.test','{"provider":"google"}'),($2,'v@wifi.example.test','{"provider":"google"}'),($3,'w@wifi.example.test','{"provider":"google"}')`,
    [U, V, W],
  );
  await db.query(INS, [NA, HA, "Fixture-A", CIPHER]);
  await db.query(INS, [NB, HB, "Fixture-B", CIPHER]);
}, 60000);

afterAll(async () => {
  await db?.end();
});

describe("wifi_networks", () => {
  it("anon has no access", async () => {
    for (const sql of ["select * from public.wifi_networks", "delete from public.wifi_networks"]) {
      const r = await tryQuery(db, { role: "anon" }, sql);
      expect(r.error?.message).toMatch(/permission denied/);
    }
  });

  it("members see only their own household", async () => {
    const a = await tryQuery(db, authed(U), "select id from public.wifi_networks where id in ($1,$2)", [NA, NB]);
    expect(a.rows).toEqual([{ id: NA }]);
    const b = await tryQuery(db, authed(W), "select id from public.wifi_networks where id in ($1,$2)", [NA, NB]);
    expect(b.rows).toEqual([{ id: NB }]);
  });

  it("a household member can write; another household cannot", async () => {
    const ins = await tryQuery(db, authed(W), INS, [NA.replace(/1001$/, "1003"), HA, "x", CIPHER]);
    expect(ins.error?.message).toMatch(/row-level security/);
    const out = await as(db, authed(W), async (c) => {
      await c.query("update public.wifi_networks set ssid='hacked' where id=$1", [NA]);
      await c.query("delete from public.wifi_networks where id=$1", [NA]);
      await c.query("reset role");
      return (await c.query("select ssid from public.wifi_networks where id=$1", [NA])).rows;
    });
    expect(out).toEqual([{ ssid: "Fixture-A" }]);
    const mine = await as(db, authed(V), async (c) => {
      await c.query("update public.wifi_networks set ssid='by v' where id=$1", [NA]);
      return (await c.query("select ssid from public.wifi_networks where id=$1", [NA])).rows;
    });
    expect(mine).toEqual([{ ssid: "by v" }]);
  });

  it("household_id is immutable", async () => {
    await db.query("begin");
    try {
      await expect(db.query("update public.wifi_networks set household_id=$2 where id=$1", [NA, HB])).rejects.toThrow(/immutable/);
    } finally {
      await db.query("rollback");
    }
  });

  it("rejects bad values", async () => {
    const bad: Array<[string, unknown[]]> = [
      ["insert into public.wifi_networks (household_id, ssid, password_ciphertext) values ($1,'',$2)", [HA, CIPHER]],
      ["insert into public.wifi_networks (household_id, ssid, password_ciphertext) values ($1,$2,'c')", [HA, "x".repeat(33)]],
      ["insert into public.wifi_networks (household_id, ssid, security, password_ciphertext) values ($1,'s','WPA3','c')", [HA]],
      // a secured network must carry ciphertext; an open one must not
      ["insert into public.wifi_networks (household_id, ssid, security) values ($1,'s','WPA')", [HA]],
      ["insert into public.wifi_networks (household_id, ssid, security, password_ciphertext) values ($1,'s','nopass','c')", [HA]],
    ];
    for (const [sql, params] of bad) {
      const r = await tryQuery(db, authed(U), sql, params);
      expect(r.error?.message, sql).toMatch(/violates check constraint/);
    }
  });

  it("audits the network name only, never the password or ciphertext", async () => {
    await as(db, authed(U), async (c) => {
      await c.query(INS, [NA.replace(/1001$/, "1010"), HA, "Audit-Net", `${CIPHER}${SECRET_MARKER}`]);
      const rows = (
        await c.query("select action, summary, before, after from public.audit_log where entity_id=$1", [NA.replace(/1001$/, "1010")])
      ).rows as Array<{ action: string; summary: string; before: unknown; after: unknown }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "wifi.added", summary: "Audit-Net", before: null, after: null });
      expect(JSON.stringify(rows)).not.toContain(SECRET_MARKER);
    });
  });
});
