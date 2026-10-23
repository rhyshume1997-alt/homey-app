import { requireSession } from "@/server/auth/session";
import { listMembers, listTasks } from "@/server/data/tasks";
import { listRooms } from "@/server/data/rooms";
import { TaskList } from "@/components/tasks/TaskList";
import { TaskForm } from "@/components/tasks/TaskForm";
import { todayInLondon } from "@/components/tasks/group";
import {
  completeTaskAction, createTaskAction, deleteTaskAction, reopenTaskAction, updateTaskAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const session = await requireSession();
  const [tasks, members, roomList] = await Promise.all([listTasks(), listMembers(), listRooms()]);
  // A failed rooms load leaves the picker out; edit forms then keep the existing room unchanged.
  const rooms = roomList.ok ? roomList.data.map(({ id, name }) => ({ id, name })) : undefined;
  const actions = {
    create: createTaskAction,
    update: updateTaskAction,
    complete: completeTaskAction,
    reopen: reopenTaskAction,
    remove: deleteTaskAction,
  };
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Tasks</h1>
      <section aria-label="Add a task" className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-base font-semibold">Add a task</h2>
        <TaskForm action={createTaskAction} members={members} rooms={rooms} submitLabel="Add task" />
      </section>
      {tasks.ok ? (
        <TaskList tasks={tasks.data} members={members} today={todayInLondon()} actions={actions} datePrefs={session.datePrefs} rooms={rooms} />
      ) : (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
          {tasks.error}
        </p>
      )}
    </div>
  );
}
