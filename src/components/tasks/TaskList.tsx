import type { Task } from "@/contracts/tasks";
import { groupTasks } from "./group";
import { RowAction } from "./RowAction";
import { TaskForm } from "./TaskForm";
import type { FormAction, MemberOption } from "./types";
import { BTN_SECONDARY } from "./styles";
import { formatDate, type DatePrefs } from "@/components/dates";
import { LazyDetails } from "@/components/LazyDetails";
import { trafficLight } from "@/components/status";
import { LightSummary, StatusPill } from "@/components/ui/StatusPill";
import type { RoomOption } from "@/components/rooms/RoomPicker";

export type TaskActions = {
  create: FormAction;
  update: FormAction;
  complete: FormAction;
  reopen: FormAction;
  remove: FormAction;
};

const RECURRENCE: Record<Task["recurrence"], string> = {
  none: "", daily: "Repeats daily", weekly: "Repeats weekly", monthly: "Repeats monthly",
  yearly: "Repeats yearly",
};

function TaskRow({
  task,
  members,
  actions,
  datePrefs,
  today,
  rooms,
}: {
  task: Task;
  members: readonly MemberOption[];
  actions: TaskActions;
  datePrefs?: DatePrefs;
  today: string;
  rooms?: readonly RoomOption[];
}) {
  const done = task.status === "done";
  const assignee = task.assignee_user_id
    ? (members.find((m) => m.user_id === task.assignee_user_id)?.display_name ?? "Someone else")
    : "Either";
  const meta = [
    assignee,
    task.due_date ? `Due ${formatDate(task.due_date, datePrefs)}` : null,
    RECURRENCE[task.recurrence] || null,
  ].filter(Boolean);
  return (
    <li data-testid="task-row" className="rounded-md bg-surface-muted px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`font-medium ${done ? "line-through" : ""}`}>{task.title}</p>
            {done ? <StatusPill light="green" label="Done" /> : <StatusPill light={trafficLight("task", task.due_date, today)} />}
          </div>
          <p className="text-sm text-muted">{meta.join(" · ")}</p>
          {task.notes && <p className="mt-1 whitespace-pre-line text-sm">{task.notes}</p>}
        </div>
        <RowAction
          action={done ? actions.reopen : actions.complete}
          id={task.id}
          label={done ? "Reopen" : "Mark done"}
        />
      </div>
      <LazyDetails className="mt-2" summaryClassName={`${BTN_SECONDARY} inline-flex cursor-pointer items-center`} summary="Edit or delete">
        <div className="mt-3 flex flex-col gap-3">
          <TaskForm action={actions.update} members={members} rooms={rooms} task={task} submitLabel="Save changes" />
          <details>
            <summary className="min-h-[var(--touch-target)] cursor-pointer py-2 text-sm font-medium">Delete this task</summary>
            <p className="mb-2 text-sm text-muted">This cannot be undone.</p>
            <RowAction action={actions.remove} id={task.id} label="Confirm delete" variant="danger" />
          </details>
        </div>
      </LazyDetails>
    </li>
  );
}

function Group({
  title, tasks, members, actions, datePrefs, today, rooms,
}: { title: string; tasks: Task[]; members: readonly MemberOption[]; actions: TaskActions; datePrefs?: DatePrefs; today: string; rooms?: readonly RoomOption[] }) {
  if (tasks.length === 0) return null;
  return (
    <section aria-label={title} data-testid="task-group" className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">{title} <span className="font-normal text-muted">({tasks.length})</span></h2>
      <ul className="mt-3 flex flex-col gap-2">
        {tasks.map((t) => <TaskRow key={t.id} task={t} members={members} actions={actions} datePrefs={datePrefs} today={today} rooms={rooms} />)}
      </ul>
    </section>
  );
}

export function TaskList({
  tasks, members, today, actions, datePrefs, rooms,
}: {
  tasks: readonly Task[]; members: readonly MemberOption[]; today: string; actions: TaskActions; datePrefs?: DatePrefs;
  /** Rooms for the edit forms' picker. Omit and the existing room link is kept unchanged. */
  rooms?: readonly RoomOption[];
}) {
  const g = groupTasks(tasks, today);
  const open = [...g.overdue, ...g.today, ...g.upcoming, ...g.noDate];
  const openCount = open.length;
  const lights = open.map((t) => trafficLight("task", t.due_date, today));
  return (
    <div className="flex flex-col gap-4">
      {openCount === 0 && (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
          No open tasks. Add one above when something needs doing.
        </p>
      )}
      {openCount > 0 && <LightSummary lights={lights} />}
      <Group title="Overdue" tasks={g.overdue} members={members} actions={actions} datePrefs={datePrefs} today={today} rooms={rooms} />
      <Group title="Today" tasks={g.today} members={members} actions={actions} datePrefs={datePrefs} today={today} rooms={rooms} />
      <Group title="Upcoming" tasks={g.upcoming} members={members} actions={actions} datePrefs={datePrefs} today={today} rooms={rooms} />
      <Group title="No date" tasks={g.noDate} members={members} actions={actions} datePrefs={datePrefs} today={today} rooms={rooms} />
      {g.done.length > 0 && (
        <details data-testid="done-tasks" className="rounded-lg border border-border bg-surface p-4">
          <summary className="min-h-[var(--touch-target)] cursor-pointer text-base font-semibold">
            Done ({g.done.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {g.done.map((t) => <TaskRow key={t.id} task={t} members={members} actions={actions} datePrefs={datePrefs} today={today} rooms={rooms} />)}
          </ul>
        </details>
      )}
    </div>
  );
}
