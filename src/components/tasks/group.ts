import type { Task } from "@/contracts/tasks";

export type TaskGroups = {
  overdue: Task[];
  today: Task[];
  upcoming: Task[];
  noDate: Task[];
  done: Task[];
};

const byDue = (a: Task, b: Task) =>
  (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.created_at.localeCompare(b.created_at);

/** Splits tasks by due date relative to `today` (YYYY-MM-DD). Done tasks are newest-completed first. */
export function groupTasks(tasks: readonly Task[], today: string): TaskGroups {
  const g: TaskGroups = { overdue: [], today: [], upcoming: [], noDate: [], done: [] };
  for (const t of tasks) {
    if (t.status === "done") g.done.push(t);
    else if (!t.due_date) g.noDate.push(t);
    else if (t.due_date < today) g.overdue.push(t);
    else if (t.due_date === today) g.today.push(t);
    else g.upcoming.push(t);
  }
  g.overdue.sort(byDue);
  g.today.sort(byDue);
  g.upcoming.sort(byDue);
  g.noDate.sort((a, b) => a.created_at.localeCompare(b.created_at));
  g.done.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  return g;
}

/** Today's date in the household's timezone as YYYY-MM-DD. */
export function todayInLondon(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
}
