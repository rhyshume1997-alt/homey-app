import Link from "next/link";
import type { Task } from "@/contracts/tasks";
import type { Snag } from "@/contracts/snags";
import { StatusPill } from "@/components/ui/StatusPill";
import { GlassIcon } from "@/components/ui/GlassIcon";
import { PRIORITY_LABEL, STATUS_LABEL as SNAG_STATUS, snagLight } from "@/components/snags/group";
import { taskLight } from "./summary";

/** Open tasks and snags for one room, each with a traffic-light pill. */
export function RoomItems({ tasks, snags, today }: { tasks: readonly Task[]; snags: readonly Snag[]; today: string }) {
  if (tasks.length === 0 && snags.length === 0) return <p className="text-sm text-muted">No open tasks or snags.</p>;
  const sortedTasks = [...tasks].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  return (
    <ul className="flex flex-col divide-y divide-border" aria-label="Open tasks and snags">
      {sortedTasks.map((t) => (
        <li key={t.id} className="flex items-center gap-3 py-2">
          <GlassIcon name="tasks" tint="blue" size="sm" />
          <Link href="/tasks" className="flex min-h-[var(--touch-target)] min-w-0 flex-1 flex-col justify-center">
            <span className="truncate font-medium">{t.title}</span>
            <span className="text-sm text-muted">Task{t.due_date ? ` · due ${t.due_date}` : " · no date"}</span>
          </Link>
          <StatusPill light={taskLight(t, today)} />
        </li>
      ))}
      {snags.map((s) => {
        const pill = snagLight(s, today);
        return (
          <li key={s.id} className="flex items-center gap-3 py-2">
            <GlassIcon name="snags" tint="rose" size="sm" />
            <Link href="/snags" className="flex min-h-[var(--touch-target)] min-w-0 flex-1 flex-col justify-center">
              <span className="truncate font-medium">{s.title}</span>
              <span className="text-sm text-muted">Snag · {SNAG_STATUS[s.status]} · {PRIORITY_LABEL[s.priority]}</span>
            </Link>
            <StatusPill light={pill.light} label={pill.label} />
          </li>
        );
      })}
    </ul>
  );
}
