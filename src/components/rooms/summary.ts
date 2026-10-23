import type { Task } from "@/contracts/tasks";
import type { Snag } from "@/contracts/snags";
import { trafficLight, worstLight, type Light } from "@/components/status";
import { snagLight } from "@/components/snags/group";

/** Same rule as the snag list: unfixed and open more than 30 days is amber "Stale", otherwise green. */
export const snagRoomLight = (s: Pick<Snag, "status" | "created_at">, today: string): Light => snagLight(s, today).light;

export const taskLight = (t: Pick<Task, "due_date" | "status">, today: string): Light =>
  trafficLight("task", t.due_date, today, t.status === "done");

export type RoomSummary = {
  roomId: string;
  tasks: number;
  snags: number;
  lights: Light[];
  worst: Light;
};

/** Open tasks and unfixed snags only. Rooms with nothing open are green with zero counts. */
export function summariseRoom(
  roomId: string,
  tasks: readonly Pick<Task, "room_id" | "due_date" | "status">[],
  snags: readonly Pick<Snag, "room_id" | "status" | "created_at">[],
  today: string,
): RoomSummary {
  const ts = tasks.filter((t) => t.room_id === roomId && t.status === "open");
  const ss = snags.filter((s) => s.room_id === roomId && s.status !== "fixed");
  const lights = [...ts.map((t) => taskLight(t, today)), ...ss.map((s) => snagRoomLight(s, today))];
  return { roomId, tasks: ts.length, snags: ss.length, lights, worst: worstLight(lights) };
}

export function countLabel(s: Pick<RoomSummary, "tasks" | "snags">): string {
  const parts: string[] = [];
  if (s.tasks) parts.push(`${s.tasks} ${s.tasks === 1 ? "task" : "tasks"}`);
  if (s.snags) parts.push(`${s.snags} ${s.snags === 1 ? "snag" : "snags"}`);
  return parts.length ? parts.join(" · ") : "No open items";
}
