import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { type Db, connectionString } from "./helpers";

export type Who = { sub: string; email: string };
export type Res = { error: Error | null; rows: Record<string, unknown>[] };

export async function mkUser(db: Db, label: string, _opts: { creator?: boolean } = {}): Promise<Who> {
  const sub = randomUUID();
  const email = `${label}-${sub.slice(0, 8)}@mh.example.test`;
  await db.query(
    "insert into auth.users (id, email, raw_app_meta_data) values ($1,$2,'{\"provider\":\"google\"}')",
    [sub, email],
  );
  return { sub, email };
}

async function begin(c: Db, who: Who) {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: who.sub, email: who.email, role: "authenticated" }),
  ]);
}

/** Runs one statement as an authenticated user with an email claim. commit=true persists the effect. */
export async function run(db: Db, who: Who, sql: string, params: unknown[] = [], commit = false): Promise<Res> {
  await begin(db, who);
  try {
    const r = await db.query(sql, params);
    await db.query(commit ? "commit" : "rollback");
    return { error: null, rows: r.rows as Record<string, unknown>[] };
  } catch (e) {
    await db.query("rollback");
    return { error: e as Error, rows: [] };
  }
}

export async function runOk(db: Db, who: Who, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const r = await run(db, who, sql, params, true);
  if (r.error) throw r.error;
  return r.rows;
}

export async function createHousehold(db: Db, who: Who, name = "Test house"): Promise<string> {
  const rows = await runOk(db, who, "select public.create_household($1,'Owner') as id", [name]);
  return rows[0].id as string;
}

export async function invite(db: Db, owner: Who, hh: string, email: string): Promise<string> {
  const rows = await runOk(db, owner, "select public.create_invite($1,$2) as t", [hh, email]);
  return rows[0].t as string;
}

export async function accept(db: Db, who: Who, token: string, name = "Joiner"): Promise<Res> {
  return run(db, who, "select public.accept_invite($1,$2) as id", [token, name], true);
}

/** A second independent connection, for real concurrency tests. */
export async function extraClient(): Promise<Client> {
  const c = new Client({ connectionString: connectionString() });
  await c.connect();
  return c;
}

export async function openTx(c: Client, who: Who) {
  await begin(c, who);
}

// Seed for household B, per table. $1 = B household, $2 = B owner, $3 = B member. Order matters (FKs).
// A table with a household_id column and no entry here FAILS the test, so new tables cannot be skipped.
export const SEEDS: Record<string, [cols: string, vals: string]> = {
  rooms: ["household_id,name", "$1,'Seed room'"],
  documents: ["household_id,title,category,storage_path,mime_type,size_bytes", "$1,'Seed doc','other',$1::text||'/seed-'||gen_random_uuid()||'.pdf','application/pdf',10"],
  household_records: ["household_id,category,title", "$1,'contact','Seed record'"],
  maintenance_items: ["household_id,title", "$1,'Seed item'"],
  maintenance_log: ["household_id,item_id,done_on", "$1,(select id from public.maintenance_items where household_id=$1 limit 1),current_date"],
  meals: ["household_id,planned_on,title", "$1,current_date,'Seed meal'"],
  supplies: ["household_id,name", "$1,'Seed supply'"],
  meal_ingredients: ["household_id,meal_id,name", "$1,(select id from public.meals where household_id=$1 limit 1),'Seed ingredient'"],
  appliances: ["household_id,name", "$1,'Seed appliance'"],
  ai_digests: ["household_id,user_id,day,input_hash,trigger,model,body", "$1,$2,current_date,repeat('a',64),'refresh','claude-test','{}'::jsonb"],
  ai_proposals: ["household_id,kind,payload", "$1,'note','{}'::jsonb"],
  ai_usage: ["household_id,month,model,input_tokens,output_tokens,cost_pence", "$1,date_trunc('month',now())::date,'claude-test',1,1,1"],
  audit_log: ["household_id,action,entity_type", "$1,'seed','fixture'"],
  bin_collections: ["household_id,collection_date,bin_name", "$1,current_date,'Seed bin'"],
  bin_settings: ["household_id,council_url", "$1,'https://seed.example.test/bins'"],
  bin_schedules: ["household_id,bin_name,colour,first_date,every_weeks", "$1,'Seed bin','green',current_date,2"],
  budget_snapshots: ["household_id,data", "$1,'{}'::jsonb"],
  checklist_items: ["household_id,title,frequency", "$1,'Seed check','monthly'"],
  email_threads: ["household_id,thread_hash,member,subject,counterpart_domain,last_message_at,last_from", "$1,repeat('b',64),'Seed','Subject','example.com',now(),'me'"],
  emergency_items: ["household_id,section,label,detail", "$1,'location','Seed','Seed detail'"],
  household_events: ["household_id,title,starts_on", "$1,'Seed event',current_date"],
  household_invites: ["household_id,email,token_hash", "$1,'seed@mh.example.test',repeat('c',64)"],
  household_members: ["household_id,user_id,role,display_name", "$1,$3,'owner','Seed'"],
  kudos: ["household_id,from_user,to_user,message", "$1,$2,$3,'Seed thanks'"],
  meter_readings: ["household_id,fuel,read_on,value,unit", "$1,'gas',current_date,1,'m3'"],
  notifications: ["household_id,kind,title,dedupe_key", "$1,'system','Seed','seed-key'"],
  notification_reads: ["notification_id,household_id,user_id", "(select id from public.notifications where household_id=$1 limit 1),$1,$2"],
  push_subscriptions: ["household_id,user_id,endpoint,p256dh,auth", "$1,$2,'https://seed.test/'||gen_random_uuid(),'k','a'"],
  shopping_items: ["household_id,title", "$1,'Seed shopping'"],
  snags: ["household_id,title", "$1,'Seed snag'"],
  tasks: ["household_id,title", "$1,'B-task'"],
  wifi_networks: ["household_id,ssid,security", "$1,'SeedNet','nopass'"],
  wishlist_items: ["household_id,title", "$1,'Seed wish'"],
};
