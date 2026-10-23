import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import type { HouseholdSession } from "@/server/auth/session";
import {
  WISHLIST_STATUSES, WishlistInputSchema, parseShopUrl,
  type WishlistInput, type WishlistItem, type WishlistRoom, type WishlistStatus,
} from "@/contracts/wishlist";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again. Links must start with https://.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load this right now.",
} as const;

const COLUMNS = "id,room_id,title,price_estimate,url,priority,status,photo_document_id,notes,bought_at";

const RowSchema = z.object({
  id: z.uuid(),
  room_id: z.uuid().nullable(),
  title: z.string(),
  price_estimate: z.union([z.number(), z.string()]).nullable().transform((v) => (v === null ? null : Number(v))),
  // Re-checked on read: a stored value that is not a safe https URL is never handed to the UI.
  url: z.string().nullable().transform((v) => (v === null ? null : parseShopUrl(v))),
  priority: z.enum(["low", "medium", "high"]),
  status: z.enum(WISHLIST_STATUSES),
  photo_document_id: z.uuid().nullable(),
  notes: z.string().nullable(),
  bought_at: z.string().nullable(),
});
const RoomRowSchema = z.object({ id: z.uuid(), name: z.string() });

export function parseWishlistForm(fd: FormData): WishlistInput | null {
  const r = WishlistInputSchema.safeParse({
    title: fd.get("title") ?? "",
    room_id: fd.get("room_id"),
    price_estimate: fd.get("price_estimate"),
    url: fd.get("url"),
    priority: fd.get("priority") || undefined,
    notes: fd.get("notes"),
  });
  return r.success ? r.data : null;
}
export function parseId(fd: FormData): string | null {
  const r = z.uuid().safeParse(fd.get("id"));
  return r.success ? r.data : null;
}
export function parseStatus(fd: FormData): WishlistStatus | null {
  const r = z.enum(WISHLIST_STATUSES).safeParse(fd.get("status"));
  return r.success ? r.data : null;
}

type Db = NonNullable<Awaited<ReturnType<typeof createUserClient>>>;

async function run(fn: (db: Db) => PromiseLike<{ error: { code?: string } | null }>): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await fn(db);
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

export async function listWishlist(): Promise<Result<WishlistItem[]>> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.load };
  const { data, error } = await db.from("wishlist_items").select(COLUMNS).order("created_at", { ascending: true });
  const parsed = z.array(RowSchema).safeParse(data);
  return error || !parsed.success ? { ok: false, error: MSG.load } : { ok: true, data: parsed.data };
}

/** Items for one room, for the room detail page. Bought items last. */
export async function listWishlistForRoom(roomId: string): Promise<Result<WishlistItem[]>> {
  if (!z.uuid().safeParse(roomId).success) return { ok: false, error: MSG.load };
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.load };
  const { data, error } = await db
    .from("wishlist_items")
    .select(COLUMNS)
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });
  const parsed = z.array(RowSchema).safeParse(data);
  if (error || !parsed.success) return { ok: false, error: MSG.load };
  const order = { saving: 0, idea: 1, bought: 2 } as const;
  return { ok: true, data: [...parsed.data].sort((a, b) => order[a.status] - order[b.status]) };
}

export async function listWishlistRooms(): Promise<Result<WishlistRoom[]>> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.load };
  const { data, error } = await db.from("rooms").select("id,name").order("sort_order", { ascending: true });
  const parsed = z.array(RoomRowSchema).safeParse(data);
  return error || !parsed.success ? { ok: false, error: MSG.load } : { ok: true, data: parsed.data };
}

export const addWishlistItem = (s: HouseholdSession, i: WishlistInput) =>
  run((db) => db.from("wishlist_items").insert({ ...i, household_id: s.householdId, created_by: s.userId }));

export const updateWishlistItem = (s: HouseholdSession, id: string, i: WishlistInput) =>
  run((db) => db.from("wishlist_items").update(i).eq("id", id).eq("household_id", s.householdId));

export const setWishlistStatus = (s: HouseholdSession, id: string, status: WishlistStatus) =>
  run((db) => db.from("wishlist_items").update({ status }).eq("id", id).eq("household_id", s.householdId));

export const removeWishlistItem = (s: HouseholdSession, id: string) =>
  run((db) => db.from("wishlist_items").delete().eq("id", id).eq("household_id", s.householdId));
