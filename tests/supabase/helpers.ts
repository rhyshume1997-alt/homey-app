// Helpers for the real-Supabase suite (supabase start, loopback only).
// Users are created through the GoTrue admin API and then act ONLY with their own JWT through
// PostgREST / Storage / RPC. The postgres connection is used for operator seeding and to verify
// that attacks changed nothing; it is never used to act as a user.
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Sb = SupabaseClient;

export const PASSWORD = "Test-only-Passw0rd!";
export const BUCKET = "documents";
/** The contract: every RPC failure is 42501 (not allowed) or 22023 (invalid input). */
export const RPC_DENIED_CODES = ["42501", "22023"];

type Cfg = { apiUrl: string; dbUrl: string; anonKey: string; serviceKey: string };
let cached: Cfg | null = null;

export function cfg(): Cfg {
  if (cached) return cached;
  const get = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`${k} is not set (run via npm run test:supabase)`);
    return v;
  };
  const c = {
    apiUrl: get("SUPABASE_TEST_API_URL"),
    dbUrl: get("SUPABASE_TEST_DB_URL"),
    anonKey: get("SUPABASE_TEST_ANON_KEY"),
    serviceKey: get("SUPABASE_TEST_SERVICE_ROLE_KEY"),
  };
  // Loopback guard: this suite writes users and data and must never reach a hosted project.
  for (const [name, u] of [["API", c.apiUrl], ["DB", c.dbUrl]] as const) {
    if (new URL(u).hostname !== "127.0.0.1") throw new Error(`refusing non-loopback ${name} URL`);
  }
  cached = c;
  return c;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export function anonClient(): Sb {
  return createClient(cfg().apiUrl, cfg().anonKey, noSession);
}

/** Service-role client: operator-only (seeding storage, creating users). Never used to assert on RLS. */
export function serviceClient(): Sb {
  return createClient(cfg().apiUrl, cfg().serviceKey, noSession);
}

export async function db<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: cfg().dbUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export const sha256hex = (s: string): string => createHash("sha256").update(s).digest("hex");
export const rand = (): string => randomUUID().slice(0, 8);

// Users ------------------------------------------------------------------------------------
export type TestUser = { email: string; id: string; client: Sb };

/**
 * private.on_auth_user_created requires raw_app_meta_data->>'provider' = 'google' and an
 * allowlisted / creator / invited email. The admin API accepts app_metadata at creation. If a
 * GoTrue version overrides the provider, fall back to inserting the auth.users row directly
 * (the same trigger still fires).
 */
export async function tryCreateAuthUser(email: string): Promise<{ id?: string; error?: string }> {
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { provider: "google", providers: ["google"] },
  });
  if (!error && data.user) return { id: data.user.id };
  const id = randomUUID();
  try {
    await db((c) =>
      c.query(
        `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
           confirmation_token, recovery_token, email_change_token_new, email_change)
         values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
           extensions.crypt($3, extensions.gen_salt('bf')), now(),
           '{"provider":"google","providers":["google"]}', '{}', now(), now(), '', '', '', '')`,
        [id, email, PASSWORD],
      ),
    );
    return { id };
  } catch (e) {
    return { error: `admin API: ${error?.message}; sql: ${(e as Error).message}` };
  }
}

export async function signIn(email: string): Promise<Sb> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

/** Sign-up is open to any Google-provider user; household creation is open too (max 3 owned households). */
export async function makeUser(tag: string): Promise<TestUser> {
  const email = `${tag}-${rand()}@example.test`;
  const made = await tryCreateAuthUser(email);
  if (!made.id) throw new Error(`could not create ${email}: ${made.error}`);
  return { email, id: made.id, client: await signIn(email) };
}

// RPC wrappers -----------------------------------------------------------------------------
export async function createHousehold(u: TestUser, name: string, display: string): Promise<string> {
  const { data, error } = await u.client.rpc("create_household", { p_name: name, p_display_name: display });
  if (error || typeof data !== "string") throw new Error(`create_household failed: ${error?.message}`);
  return data;
}

export async function createInvite(owner: TestUser, household: string, email: string): Promise<string> {
  const { data, error } = await owner.client.rpc("create_invite", { p_household: household, p_email: email });
  if (error || typeof data !== "string") throw new Error(`create_invite failed: ${error?.message}`);
  return data;
}

export async function acceptInvite(u: TestUser | { client: Sb }, token: string, display = "Invitee") {
  return u.client.rpc("accept_invite", { p_token: token, p_display_name: display });
}

export async function inviteAndJoin(owner: TestUser, household: string, tag: string, display = "Member"): Promise<TestUser> {
  const user = await makeUser(tag);
  const token = await createInvite(owner, household, user.email);
  const { error } = await acceptInvite(user, token, display);
  if (error) throw new Error(`accept_invite failed: ${error.message}`);
  return user;
}

export async function membership(household: string, userId: string): Promise<{ role: string; status: string } | null> {
  return db(async (c) => {
    const r = await c.query("select role, status from public.household_members where household_id = $1 and user_id = $2", [household, userId]);
    return (r.rows[0] as { role: string; status: string } | undefined) ?? null;
  });
}

// Seeding ----------------------------------------------------------------------------------
export type Seed = {
  taskId: string;
  snagId: string;
  recordId: string;
  wifiId: string;
  notificationId: string;
  documentId: string;
  storagePath: string;
  inviteId: string;
  auditId: string;
};

/** Operator seeding through the postgres connection (bypasses RLS, as the migrations and imports do). */
export async function seedHousehold(household: string, owner: TestUser): Promise<Seed> {
  const documentId = randomUUID();
  const storagePath = `${household}/${documentId}/seed.pdf`;
  const ids = await db(async (c) => {
    const one = async (sql: string, p: unknown[]): Promise<string> => (await c.query(sql, p)).rows[0].id as string;
    return {
      taskId: await one("insert into public.tasks (household_id, title) values ($1, 'seed task') returning id", [household]),
      snagId: await one("insert into public.snags (household_id, title) values ($1, 'seed snag') returning id", [household]),
      recordId: await one("insert into public.household_records (household_id, category, title) values ($1, 'contact', 'seed record') returning id", [household]),
      wifiId: await one("insert into public.wifi_networks (household_id, ssid, security) values ($1, 'seed-ssid', 'nopass') returning id", [household]),
      notificationId: await one(
        "insert into public.notifications (household_id, kind, title, dedupe_key) values ($1, 'system', 'seed notification', 'seed') returning id",
        [household],
      ),
      documentId: await one(
        `insert into public.documents (id, household_id, title, category, storage_path, mime_type, size_bytes)
         values ($1, $2, 'seed document', 'other', $3, 'application/pdf', 20) returning id`,
        [documentId, household, storagePath],
      ),
    };
  });
  const up = await serviceClient().storage.from(BUCKET).upload(storagePath, Buffer.from(`%PDF-1.4 seed ${household}`), {
    contentType: "application/pdf",
  });
  if (up.error) throw new Error(`seed upload failed: ${up.error.message}`);
  await createInvite(owner, household, `pending-${rand()}@example.test`);
  const extra = await db(async (c) => ({
    inviteId: (await c.query("select id from public.household_invites where household_id = $1 limit 1", [household])).rows[0].id as string,
    auditId: String((await c.query("select id from public.audit_log where household_id = $1 limit 1", [household])).rows[0].id),
  }));
  return { ...ids, storagePath, ...extra };
}

export type Tenant = TestUser & { householdId: string; seed: Seed };

export type World = { a: Tenant; b: Tenant };

/** Two creators, each owning their own household with a few rows and one storage object. */
export async function buildWorld(): Promise<World> {
  const out: Tenant[] = [];
  for (const [tag, name] of [["owner-a", "Household A"], ["owner-b", "Household B"]] as const) {
    const u = await makeUser(tag);
    const householdId = await createHousehold(u, name, `Owner ${tag}`);
    out.push({ ...u, householdId, seed: await seedHousehold(householdId, u) });
  }
  return { a: out[0], b: out[1] };
}

/** A household with an owner, one active member, and a seeded task/document/object. */
export async function buildHouseholdWithMember() {
  const owner = await makeUser("owner");
  const householdId = await createHousehold(owner, "Household", "Owner");
  const seed = await seedHousehold(householdId, owner);
  const member = await inviteAndJoin(owner, householdId, "member");
  return { owner, member, householdId, seed };
}

// Assertions ---------------------------------------------------------------------------------
type Res = { data?: unknown; error: { code?: string; message: string } | null };

export function expectRpcDenied(res: Res): string {
  if (!res.error) throw new Error(`expected the RPC to be denied, got data ${JSON.stringify(res.data)}`);
  if (!RPC_DENIED_CODES.includes(res.error.code ?? "")) {
    throw new Error(`expected error code 42501 or 22023, got ${res.error.code}: ${res.error.message}`);
  }
  return res.error.code ?? "";
}

/** A read that is denied (error) or filtered (no rows) both leak nothing. */
export function rowsOf(res: Res): unknown[] {
  return Array.isArray(res.data) ? res.data : [];
}
