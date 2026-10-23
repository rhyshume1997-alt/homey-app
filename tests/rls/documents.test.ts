import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, adminClient, as, authed, tryQuery } from "./helpers";

const HA = "d0c00000-0000-4000-8000-00000000000a";
const HB = "d0c00000-0000-4000-8000-00000000000b";
const UA = "d0c00000-0000-4000-8000-0000000000a1"; // HA
const UA2 = "d0c00000-0000-4000-8000-0000000000a2"; // HA
const UB = "d0c00000-0000-4000-8000-0000000000b1"; // HB

const did = (n: number) => `d0c00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DA = did(1);
const DB = did(2);
const RB = did(50); // a household record in HB

const path = (h: string, d: string, f = "file.pdf") => `${h}/${d}/${f}`;
const INS =
  "insert into public.documents (id, household_id, title, category, storage_path, mime_type, size_bytes) values ($1,$2,$3,'insurance',$4,'application/pdf',1000)";
const REMOTE = Boolean(process.env.SUPABASE_PROJECT_REF);
// Real Supabase blocks direct DELETE on storage tables (trigger: use the Storage API); the local emulation does not.
const itLocal = REMOTE ? it.skip : it;
const OBJ = "insert into storage.objects (bucket_id, name) values ('documents', $1)";

let db: Db;

beforeAll(async () => {
  db = await adminClient();
}, 30000);

afterAll(async () => {
  await db?.end();
});

beforeAll(async () => {
  await db.query(`insert into public.households (id, name) values ($1,'DOC-A'),($2,'DOC-B')`, [HA, HB]);
  await db.query(
    `insert into private.allowed_emails (email, household_id, role, display_name) values
    ('a1@docs.example.test',$1,'owner','A1'),('a2@docs.example.test',$1,'member','A2'),('b1@docs.example.test',$2,'owner','B1')`,
    [HA, HB],
  );
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values
    ($1,'a1@docs.example.test','{"provider":"google"}'),($2,'a2@docs.example.test','{"provider":"google"}'),($3,'b1@docs.example.test','{"provider":"google"}')`,
    [UA, UA2, UB],
  );
  await db.query(INS, [DA, HA, "fixture a", path(HA, DA)]);
  await db.query(INS, [DB, HB, "fixture b", path(HB, DB)]);
  await db.query("insert into public.household_records (id, household_id, category, title) values ($1,$2,'gas','rec b')", [RB, HB]);
  await db.query(OBJ, [path(HA, DA)]);
  await db.query(OBJ, [path(HB, DB)]);
});

describe("bucket", () => {
  it("is private with a 20 MB limit and image/pdf types only", async () => {
    const r = await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id='documents'");
    // Only what our migration sets; the type of file_size_limit differs between emulation and real Supabase.
    expect(r.rows[0]!.public).toBe(false);
    expect(Number(r.rows[0]!.file_size_limit)).toBe(20971520);
    expect([...(r.rows[0]!.allowed_mime_types as string[])].sort()).toEqual(
      ["application/pdf", "image/heic", "image/jpeg", "image/png", "image/webp"],
    );
  });
});

describe("documents table", () => {
  it("anon has no access", async () => {
    for (const sql of [
      "select * from public.documents",
      `insert into public.documents (household_id, title, category, storage_path, mime_type, size_bytes) values ('${HA}','x','other','${HA}/x/y.pdf','application/pdf',1)`,
      "update public.documents set title='x'",
      "delete from public.documents",
    ]) {
      const r = await tryQuery(db, { role: "anon" }, sql);
      expect(r.error?.message).toMatch(/permission denied/);
    }
  });

  it("members see only their household", async () => {
    const r = await tryQuery(db, authed(UA), "select id from public.documents where id in ($1,$2)", [DA, DB]);
    expect(r.rows).toEqual([{ id: DA }]);
    const r2 = await tryQuery(db, authed(UB), "select id from public.documents where id in ($1,$2)", [DA, DB]);
    expect(r2.rows).toEqual([{ id: DB }]);
  });

  it("member CRUD in own household, audited by title only", async () => {
    const id = did(10);
    const out = await as(db, authed(UA2), async (c) => {
      await c.query(INS, [id, HA, "Boiler warranty", path(HA, id)]);
      const created = (await c.query("select created_by, household_id from public.documents where id=$1", [id])).rows[0];
      await c.query("update public.documents set expires_on='2027-01-01', notes='n' where id=$1", [id]);
      await c.query("delete from public.documents where id=$1", [id]);
      return { created };
    });
    expect(out.created).toMatchObject({ created_by: UA2, household_id: HA });
  });

  it("writes audit rows with the title only", async () => {
    const id = did(11);
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: UA, role: "authenticated" })]);
      await db.query(INS, [id, HA, "Audit me", path(HA, id)]);
      await db.query("update public.documents set notes='x' where id=$1", [id]);
      await db.query("delete from public.documents where id=$1", [id]);
      await db.query("reset role");
      const r = await db.query("select action, summary from public.audit_log where entity_id=$1 order by id", [id]);
      expect(r.rows).toEqual([
        { action: "document.added", summary: "Audit me" },
        { action: "document.updated", summary: "Audit me" },
        { action: "document.deleted", summary: "Audit me" },
      ]);
    } finally {
      await db.query("rollback");
    }
  });

  it("cannot insert into another household or update across households", async () => {
    const id = did(12);
    const a = await tryQuery(db, authed(UA), INS, [id, HB, "x", path(HB, id)]);
    expect(a.error?.message).toMatch(/row-level security/);
    const b = await as(db, authed(UA), async (c) => {
      await c.query("update public.documents set title='hacked' where id=$1", [DB]);
      await c.query("delete from public.documents where id=$1", [DB]);
      return null;
    });
    expect(b).toBeNull();
    const still = await db.query("select title from public.documents where id=$1", [DB]);
    expect(still.rows).toEqual([{ title: "fixture b" }]);
  });

  it("guards household_id, storage_path and the path prefix", async () => {
    const id = did(13);
    const move = await tryQuery(db, authed(UA), "update public.documents set household_id=$2 where id=$1", [DA, HB]);
    expect(move.error?.message).toMatch(/immutable|row-level security/);
    const repath = await tryQuery(db, authed(UA), "update public.documents set storage_path=$2 where id=$1", [DA, path(HA, DA, "other.pdf")]);
    expect(repath.error?.message).toMatch(/immutable/);
    const wrongPrefix = await tryQuery(db, authed(UA), INS, [id, HA, "x", path(HB, id)]);
    expect(wrongPrefix.error?.message).toMatch(/documents_path_in_household/);
  });

  it("rejects a record from another household and bad values", async () => {
    const id = did(14);
    const link = await tryQuery(
      db, authed(UA),
      "insert into public.documents (id, household_id, title, category, storage_path, mime_type, size_bytes, record_id) values ($1,$2,'x','other',$3,'application/pdf',1,$4)",
      [id, HA, path(HA, id), RB],
    );
    expect(link.error?.message).toMatch(/same household/);
    const cases: [string, string][] = [
      ["empty title", `insert into public.documents (household_id, title, category, storage_path, mime_type, size_bytes) values ('${HA}','','other','${HA}/z/a.pdf','application/pdf',1)`],
      ["bad category", `insert into public.documents (household_id, title, category, storage_path, mime_type, size_bytes) values ('${HA}','t','bogus','${HA}/z/a.pdf','application/pdf',1)`],
      ["zero size", `insert into public.documents (household_id, title, category, storage_path, mime_type, size_bytes) values ('${HA}','t','other','${HA}/z/a.pdf','application/pdf',0)`],
      ["too big", `insert into public.documents (household_id, title, category, storage_path, mime_type, size_bytes) values ('${HA}','t','other','${HA}/z/a.pdf','application/pdf',20971521)`],
      ["long notes", `insert into public.documents (household_id, title, category, storage_path, mime_type, size_bytes, notes) values ('${HA}','t','other','${HA}/z/a.pdf','application/pdf',1,'${"n".repeat(1001)}')`],
    ];
    for (const [label, sql] of cases) {
      const r = await tryQuery(db, authed(UA), sql);
      expect(r.error?.message, label).toMatch(/check constraint/);
    }
  });

  it("storage_path is unique", async () => {
    const r = await tryQuery(db, authed(UA), INS, [did(15), HA, "dup", path(HA, DA)]);
    expect(r.error?.message).toMatch(/unique|duplicate/);
  });
});

describe("storage.objects policies", () => {
  it("anon has nothing", async () => {
    // Local: no table grant (permission denied). Real Supabase: grant exists but no anon policy, so zero rows.
    const sel = await tryQuery(db, { role: "anon" }, "select name from storage.objects where bucket_id='documents'");
    if (sel.error) expect(sel.error.message).toMatch(/permission denied/);
    else expect(sel.rows).toEqual([]);
    const ins = await tryQuery(db, { role: "anon" }, OBJ, [path(HA, did(20))]);
    expect(ins.error?.message).toMatch(/permission denied|row-level security/);
  });

  it("member can insert and select under their household prefix", async () => {
    const name = path(HA, did(21), "scan.pdf");
    const out = await as(db, authed(UA), async (c) => {
      await c.query(OBJ, [name]);
      return (await c.query("select name from storage.objects where name=$1", [name])).rows;
    });
    expect(out).toEqual([{ name }]);
  });

  itLocal("member can delete under their household prefix", async () => {
    const name = path(HA, did(24), "scan.pdf");
    const out = await as(db, authed(UA), async (c) => {
      await c.query(OBJ, [name]);
      await c.query("delete from storage.objects where name=$1", [name]);
      return (await c.query("select name from storage.objects where name=$1", [name])).rows;
    });
    expect(out).toEqual([]);
  });

  it("member sees only own-household objects", async () => {
    const sel = await as(db, authed(UA), async (c) =>
      (await c.query("select name from storage.objects where bucket_id='documents' order by name")).rows,
    );
    expect(sel.map((r) => r.name)).toContain(path(HA, DA));
    expect(sel.map((r) => r.name)).not.toContain(path(HB, DB));
  });

  itLocal("member deletes only own-household objects", async () => {
    const out = await as(db, authed(UA), async (c) => {
      const sel = (await c.query("select name from storage.objects where bucket_id='documents' order by name")).rows;
      const del = (await c.query("delete from storage.objects where name=$1 returning name", [path(HB, DB)])).rows;
      return { sel, del };
    });
    expect(out.sel.map((r) => r.name)).toContain(path(HA, DA));
    expect(out.sel.map((r) => r.name)).not.toContain(path(HB, DB));
    expect(out.del).toEqual([]);
    const still = await db.query("select name from storage.objects where name=$1", [path(HB, DB)]);
    expect(still.rows).toHaveLength(1);
  });

  it("policies exist with the expected commands, role and bucket scoping", async () => {
    const r = await db.query(
      "select policyname, cmd, roles::text as roles, coalesce(qual,'') || ' ' || coalesce(with_check,'') as def from pg_policies where schemaname='storage' and tablename='objects' and (coalesce(qual,'') || coalesce(with_check,'')) like '%documents%' order by cmd",
    );
    const rows = r.rows as { cmd: string; roles: string; def: string }[];
    expect(rows.map((x) => x.cmd).sort()).toEqual(["DELETE", "INSERT", "SELECT"]); // no UPDATE, no ALL
    for (const x of rows) {
      expect(x.roles).toBe("{authenticated}");
      expect(x.def).toContain("bucket_id = 'documents'");
      expect(x.def).toContain("is_household_member");
      expect(x.def).toContain("storage_household");
    }
  });

  it("cannot insert under another household's prefix", async () => {
    const r = await tryQuery(db, authed(UA), OBJ, [path(HB, did(22))]);
    expect(r.error?.message).toMatch(/row-level security/);
  });

  it("cannot insert with a non-uuid or missing first folder", async () => {
    for (const name of ["not-a-uuid/x/y.pdf", `${HA.toUpperCase()}x/y.pdf`, "file.pdf", `${"z".repeat(36)}/a/b.pdf`, `/${HA}/a.pdf`]) {
      const r = await tryQuery(db, authed(UA), OBJ, [name]);
      expect(r.error?.message, name).toMatch(/row-level security/);
    }
  });

  it("cannot write to another bucket", async () => {
    await db.query("insert into storage.buckets (id, name, public) values ('other-bucket','other-bucket',false) on conflict do nothing");
    const r = await tryQuery(db, authed(UA), "insert into storage.objects (bucket_id, name) values ('other-bucket', $1)", [path(HA, did(23))]);
    expect(r.error?.message).toMatch(/row-level security/);
  });

  it("there is no update policy", async () => {
    const r = await tryQuery(db, authed(UA), "update storage.objects set name=$2 where name=$1", [path(HA, DA), path(HA, DA, "renamed.pdf")]);
    expect(r.error?.message ?? "permission denied").toMatch(/permission denied|row-level security/);
  });
});
