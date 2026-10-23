import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import type { HouseholdSession } from "@/server/auth/session";
import type { SuppliesCardData } from "@/components/home/SuppliesCard";
import { SHOPPING_LIMITS, SUPPLY_LIMITS, SUPPLY_STATUSES, type ShoppingItem, type Supply } from "@/components/shopping/types";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load this right now.",
  duplicate: "That supply is already on the list.",
} as const;

const optText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : (v ?? null)),
    z.string().trim().max(max).nullable(),
  );

export const ShoppingInputSchema = z.object({
  title: z.string().trim().min(1).max(SHOPPING_LIMITS.title),
  quantity: optText(SHOPPING_LIMITS.quantity),
  shop: optText(SHOPPING_LIMITS.shop),
});
export const SupplyInputSchema = z.object({
  name: z.string().trim().min(1).max(SUPPLY_LIMITS.name),
  location: optText(SUPPLY_LIMITS.location),
});
const StatusSchema = z.enum(SUPPLY_STATUSES);

const ShoppingRowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  quantity: z.string().nullable(),
  shop: z.string().nullable(),
  done: z.boolean(),
  done_at: z.string().nullable(),
});
const SupplyRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  location: z.string().nullable(),
  status: StatusSchema,
  notes: z.string().nullable(),
  last_checked_at: z.string().nullable(),
});

export function parseShoppingForm(fd: FormData) {
  const r = ShoppingInputSchema.safeParse({ title: fd.get("title") ?? "", quantity: fd.get("quantity"), shop: fd.get("shop") });
  return r.success ? r.data : null;
}
export function parseSupplyForm(fd: FormData) {
  const r = SupplyInputSchema.safeParse({ name: fd.get("name") ?? "", location: fd.get("location") });
  return r.success ? r.data : null;
}
export function parseId(fd: FormData): string | null {
  const r = z.uuid().safeParse(fd.get("id"));
  return r.success ? r.data : null;
}
export function parseDone(fd: FormData): boolean | null {
  const v = fd.get("done");
  return v === "true" ? true : v === "false" ? false : null;
}
export function parseSupplyStatus(fd: FormData) {
  const r = StatusSchema.safeParse(fd.get("status"));
  return r.success ? r.data : null;
}

type Db = NonNullable<Awaited<ReturnType<typeof createUserClient>>>;

async function run(fn: (db: Db) => PromiseLike<{ error: { code?: string } | null }>, dupMsg?: string): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await fn(db);
  if (error) return { ok: false, error: error.code === "23505" && dupMsg ? dupMsg : MSG.failed };
  return { ok: true, data: undefined };
}

export async function listShopping(): Promise<Result<ShoppingItem[]>> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.load };
  const { data, error } = await db
    .from("shopping_items")
    .select("id,title,quantity,shop,done,done_at")
    .order("created_at", { ascending: true });
  const parsed = z.array(ShoppingRowSchema).safeParse(data);
  return error || !parsed.success ? { ok: false, error: MSG.load } : { ok: true, data: parsed.data };
}

export async function listSupplies(): Promise<Result<Supply[]>> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.load };
  const { data, error } = await db.from("supplies").select("id,name,location,status,notes,last_checked_at");
  const parsed = z.array(SupplyRowSchema).safeParse(data);
  return error || !parsed.success ? { ok: false, error: MSG.load } : { ok: true, data: parsed.data };
}

/** Dashboard card data: only what people entered. Null when it could not be loaded. */
export async function getSuppliesCardData(): Promise<SuppliesCardData | null> {
  const [s, i] = await Promise.all([listSupplies(), listShopping()]);
  if (!s.ok || !i.ok) return null;
  return {
    lowSupplies: s.data.filter((x) => x.status !== "ok").map((x) => ({ id: x.id, name: x.name, status: x.status })),
    totalSupplies: s.data.length,
    openShoppingCount: i.data.filter((x) => !x.done).length,
  };
}

export const addShoppingItem = (s: HouseholdSession, i: z.infer<typeof ShoppingInputSchema>) =>
  run((db) => db.from("shopping_items").insert({ ...i, household_id: s.householdId, created_by: s.userId }));

export const setShoppingDone = (s: HouseholdSession, id: string, done: boolean) =>
  run((db) => db.from("shopping_items").update({ done }).eq("id", id).eq("household_id", s.householdId));

export const removeShoppingItem = (s: HouseholdSession, id: string) =>
  run((db) => db.from("shopping_items").delete().eq("id", id).eq("household_id", s.householdId));

export const clearBought = (s: HouseholdSession) =>
  run((db) => db.from("shopping_items").delete().eq("household_id", s.householdId).eq("done", true));

export const addSupply = (s: HouseholdSession, i: z.infer<typeof SupplyInputSchema>) =>
  run((db) => db.from("supplies").insert({ ...i, household_id: s.householdId, created_by: s.userId }), MSG.duplicate);

export const setSupplyStatus = (s: HouseholdSession, id: string, status: z.infer<typeof StatusSchema>) =>
  run((db) => db.from("supplies").update({ status }).eq("id", id).eq("household_id", s.householdId));

export const removeSupply = (s: HouseholdSession, id: string) =>
  run((db) => db.from("supplies").delete().eq("id", id).eq("household_id", s.householdId));

/** Inserts a shopping item for each low/out supply whose name is not already an open item. */
export async function addLowSuppliesToShopping(s: HouseholdSession): Promise<Result> {
  const [sup, items] = await Promise.all([listSupplies(), listShopping()]);
  if (!sup.ok || !items.ok) return { ok: false, error: MSG.failed };
  const have = new Set(items.data.filter((i) => !i.done).map((i) => i.title.trim().toLowerCase()));
  const missing = sup.data.filter((x) => x.status !== "ok" && !have.has(x.name.trim().toLowerCase()));
  if (missing.length === 0) return { ok: true, data: undefined };
  return run((db) =>
    db.from("shopping_items").insert(missing.map((x) => ({ title: x.name, household_id: s.householdId, created_by: s.userId }))),
  );
}
