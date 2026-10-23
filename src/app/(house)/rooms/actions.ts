"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import {
  MSG, createRoom, deleteRoom, moveRoom, parseDirection, parseRoomId, parseRoomName, parseRoomNotes,
  renameRoom, setRoomNotes, type Result,
} from "@/server/data/rooms";
import type { FormState } from "@/components/tasks/types";

function finish(r: Result, extra: string[] = []): FormState {
  if (!r.ok) return { error: r.error };
  revalidatePath("/rooms");
  for (const p of extra) revalidatePath(p);
  return { ok: true };
}

export async function createRoomAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const name = parseRoomName(fd);
  if (!name) return { error: MSG.invalid };
  return finish(await createRoom(s, name));
}

export async function renameRoomAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseRoomId(fd);
  const name = parseRoomName(fd);
  if (!id || !name) return { error: MSG.invalid };
  return finish(await renameRoom(s, id, name), [`/rooms/${id}`]);
}

export async function moveRoomAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseRoomId(fd);
  const dir = parseDirection(fd);
  if (!id || !dir) return { error: MSG.invalid };
  return finish(await moveRoom(s, id, dir));
}

export async function deleteRoomAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseRoomId(fd);
  if (!id) return { error: MSG.invalid };
  return finish(await deleteRoom(s, id), ["/tasks", "/snags", "/"]);
}

export async function saveRoomNotesAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseRoomId(fd);
  const n = parseRoomNotes(fd);
  if (!id || !n) return { error: MSG.invalid };
  return finish(await setRoomNotes(s, id, n.notes), [`/rooms/${id}`]);
}
