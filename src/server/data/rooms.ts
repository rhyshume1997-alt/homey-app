import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import { scopedDb } from "@/server/db/scoped";
import type { HouseholdSession } from "@/server/auth/session";
import { RoomNameInputSchema, RoomNotesInputSchema, RoomSchema, type Room } from "@/contracts/rooms";
import { TaskSchema, type Task } from "@/contracts/tasks";
import { SnagSchema, type Snag } from "@/contracts/snags";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load rooms right now.",
  duplicate: "A room with that name already exists.",
} as const;

export function parseRoomName(fd: FormData): string | null {
  const r = RoomNameInputSchema.safeParse({ name: fd.get("name") ?? "" });
  return r.success ? r.data.name : null;
}

/** Blank notes become null. Null result means invalid (too long). */
export function parseRoomNotes(fd: FormData): { notes: string | null } | null {
  const raw = fd.get("notes");
  const v = typeof raw === "string" && raw.trim() !== "" ? raw : null;
  const r = RoomNotesInputSchema.safeParse({ notes: v });
  return r.success ? r.data : null;
}

export function parseRoomId(fd: FormData, key = "id"): string | null {
  const r = z.uuid().safeParse(fd.get(key));
  return r.success ? r.data : null;
}

export function parseDirection(fd: FormData): "up" | "down" | null {
  const v = fd.get("direction");
  return v === "up" || v === "down" ? v : null;
}

type Db = NonNullable<Awaited<ReturnType<typeof createUserClient>>>;

export async function listRooms(): Promise<Result<Room[]>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: MSG.load };
  const { db, householdId } = sc;
  const { data, error } = await db.from("rooms").select("*").eq("household_id", householdId).order("sort_order").order("name");
  if (error || !data) return { ok: false, error: MSG.load };
  const parsed = z.array(RoomSchema).safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: MSG.load };
}

export async function getRoom(id: string): Promise<Result<Room | null>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: MSG.load };
  const { db, householdId } = sc;
  const { data, error } = await db.from("rooms").select("*").eq("household_id", householdId).eq("id", id).maybeSingle();
  if (error) return { ok: false, error: MSG.load };
  if (!data) return { ok: true, data: null };
  const parsed = RoomSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: MSG.load };
}

/** Open tasks and unfixed snags that have a room. `roomId` limits them to one room. */
export async function listRoomItems(roomId?: string): Promise<Result<{ tasks: Task[]; snags: Snag[] }>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: MSG.load };
  const { db, householdId } = sc;
  let tq = db.from("tasks").select("*").eq("household_id", householdId).eq("status", "open");
  let sq = db.from("snags").select("*").eq("household_id", householdId).neq("status", "fixed");
  tq = roomId ? tq.eq("room_id", roomId) : tq.not("room_id", "is", null);
  sq = roomId ? sq.eq("room_id", roomId) : sq.not("room_id", "is", null);
  const [t, s] = await Promise.all([tq, sq]);
  if (t.error || s.error) return { ok: false, error: MSG.load };
  const tp = z.array(TaskSchema).safeParse(t.data ?? []);
  const sp = z.array(SnagSchema).safeParse(s.data ?? []);
  return tp.success && sp.success ? { ok: true, data: { tasks: tp.data, snags: sp.data } } : { ok: false, error: MSG.load };
}

async function run(fn: (db: Db) => PromiseLike<{ error: { code?: string } | null }>): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await fn(db);
  if (!error) return { ok: true, data: undefined };
  return { ok: false, error: error.code === "23505" ? MSG.duplicate : MSG.failed };
}

export const createRoom = async (s: HouseholdSession, name: string): Promise<Result> => {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { data } = await db
    .from("rooms")
    .select("sort_order")
    .eq("household_id", s.householdId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const top = (data?.[0] as { sort_order?: number } | undefined)?.sort_order ?? 0;
  const next = Math.min(1000, top + 10);
  return run((d) => d.from("rooms").insert({ name, sort_order: next, household_id: s.householdId, created_by: s.userId }));
};

export const renameRoom = (s: HouseholdSession, id: string, name: string) =>
  run((db) =>
    db.from("rooms").update({ name, updated_at: new Date().toISOString() }).eq("id", id).eq("household_id", s.householdId),
  );

export const setRoomNotes = (s: HouseholdSession, id: string, notes: string | null) =>
  run((db) =>
    db.from("rooms").update({ notes, updated_at: new Date().toISOString() }).eq("id", id).eq("household_id", s.householdId),
  );

/** Deleting a room sets room_id to null on its tasks and snags (FK on delete set null). */
export const deleteRoom = (s: HouseholdSession, id: string) =>
  run((db) => db.from("rooms").delete().eq("id", id).eq("household_id", s.householdId));

/** Moves one room up or down, then renumbers the list 10, 20, 30... so order stays stable. */
export async function moveRoom(s: HouseholdSession, id: string, dir: "up" | "down"): Promise<Result> {
  const list = await listRooms();
  if (!list.ok) return { ok: false, error: MSG.failed };
  const rooms = list.data;
  const i = rooms.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rooms.length) return { ok: true, data: undefined };
  const order = [...rooms];
  [order[i], order[j]] = [order[j], order[i]];
  for (const [idx, r] of order.entries()) {
    const want = Math.min(1000, (idx + 1) * 10);
    if (r.sort_order === want) continue;
    const res = await run((db) => db.from("rooms").update({ sort_order: want }).eq("id", r.id).eq("household_id", s.householdId));
    if (!res.ok) return res;
  }
  return { ok: true, data: undefined };
}
