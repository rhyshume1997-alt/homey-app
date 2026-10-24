import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A removed member keeps a valid Supabase login and maybe a cookie naming the household, but
 * getSession() then finds no active membership and returns null. Every server action must stop
 * there: no write and no RPC may reach the database.
 */
const m = vi.hoisted(() => ({ writes: [] as string[] }));

/** Root client is not thenable (it is returned from an async function); query builders are. */
function builder(): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, count: 0 }).then(res);
      if (typeof prop === "symbol") return undefined;
      if (WRITES.includes(prop)) return () => (m.writes.push(prop), builder());
      return builder();
    },
    apply: () => builder(),
  };
  return new Proxy(function () {}, handler);
}
const WRITES = ["insert", "update", "delete", "upsert", "rpc", "upload", "remove", "createSignedUrl", "createSignedUrls"];
function recorder(): unknown {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then" || typeof prop === "symbol") return undefined;
        if (WRITES.includes(prop)) return () => (m.writes.push(prop), builder());
        return builder();
      },
    },
  );
}

vi.mock("@/server/db/supabase", () => ({
  supabaseEnv: () => null,
  createUserClient: async () => recorder(),
}));
vi.mock("@/server/auth/session", () => ({
  getSession: async () => null,
  getAuthUser: async () => null,
  getAuthOnly: async () => null,
  requireSession: async () => {
    throw new Error("REDIRECT");
  },
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("REDIRECT");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const ROOT = path.resolve(__dirname, "../../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/(^|-)actions\.ts$/.test(e) || e === "actions.ts") out.push(p);
  }
  return out;
}
const FILES = walk(ROOT).filter((f) => readFileSync(f, "utf8").trimStart().startsWith('"use server"'));

const UUID = "11111111-1111-4111-8111-111111111111";
function formData() {
  const f = new FormData();
  for (const k of ["id", "household", "user", "invite", "title", "name", "email", "displayName", "text", "status"]) f.set(k, k === "id" || k === "household" || k === "user" || k === "invite" ? UUID : "x");
  return f;
}

beforeEach(() => {
  m.writes.length = 0;
});

describe("server actions reject a request with no active membership", () => {
  it("finds the action files (guards against the glob silently matching nothing)", () => {
    const rel = FILES.map((f) => path.relative(ROOT, f));
    expect(rel).toEqual(
      expect.arrayContaining([
        "app/(house)/household-actions.ts",
        "app/(house)/settings-actions.ts",
        "app/(house)/tasks/actions.ts",
        "app/(house)/snags/actions.ts",
        "app/(house)/documents/actions.ts",
        "app/(house)/settings/google/actions.ts",
      ]),
    );
    expect(FILES.length).toBeGreaterThanOrEqual(25);
  });

  it("the recorder really detects writes and RPCs (so a pass is not vacuous)", async () => {
    const { createUserClient } = await import("@/server/db/supabase");
    const db = (await createUserClient()) as { from: (t: string) => { insert: (r: unknown) => unknown }; rpc: (f: string) => unknown };
    await db.from("tasks").insert({});
    await db.rpc("anything");
    expect(m.writes).toEqual(["insert", "rpc"]);
  });

  for (const file of FILES) {
    const rel = path.relative(ROOT, file);
    it(`${rel}: no DB write or RPC for a removed member`, async () => {
      const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
      const fns = Object.entries(mod).filter(([, v]) => typeof v === "function") as [string, (...a: unknown[]) => unknown][];
      expect(fns.length).toBeGreaterThan(0);
      for (const [name, fn] of fns) {
        m.writes.length = 0;
        // Cover (prev, formData), (formData), (id) and (id, value) call shapes; rejection is fine.
        for (const args of [[null, formData()], [formData()], [UUID], [UUID, "x"], [{}], []]) {
          try {
            await fn(...args);
          } catch {
            // redirect or validation failure: that is a rejection
          }
        }
        expect(m.writes, `${rel} ${name}`).toEqual([]);
      }
    });
  }
});
