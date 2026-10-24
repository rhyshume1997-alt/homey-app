import Link from "next/link";
import { CardTitle } from "@/components/home/CardTitle";
import { ChoreAddForm } from "@/components/home/ChoreAddForm";
import { RowAction } from "@/components/tasks/RowAction";
import type { FormAction, MemberOption } from "@/components/tasks/types";
import { formatDate, type DatePrefs } from "@/components/dates";

export interface ChoreItem { id: string; title: string; dueDate: string; overdue: boolean; assigneeId: string | null }

export interface ChoreActions { create: FormAction; complete: FormAction; nudge: FormAction }

export interface ChoreGroup { key: string; name: string; chores: ChoreItem[] }

/** Groups by assignee display name ("Anyone" when unassigned); the viewer first, Anyone last. */
export function groupChores(chores: readonly ChoreItem[], members: readonly MemberOption[], viewerId?: string): ChoreGroup[] {
  const map = new Map<string, ChoreGroup>();
  for (const c of chores) {
    const key = c.assigneeId ?? "anyone";
    const name = c.assigneeId ? (members.find((m) => m.user_id === c.assigneeId)?.display_name ?? "Someone else") : "Anyone";
    const g = map.get(key) ?? { key, name, chores: [] };
    g.chores.push(c);
    map.set(key, g);
  }
  const rank = (g: ChoreGroup) => (g.key === viewerId ? 0 : g.key === "anyone" ? 2 : 1);
  return [...map.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Null chores means they could not be loaded. Without actions the card is read only. */
export function ChoresCard({
  chores, members, viewerId, today, datePrefs, actions,
}: {
  chores: readonly ChoreItem[] | null;
  members: readonly MemberOption[] | null;
  viewerId?: string;
  today: string;
  datePrefs?: DatePrefs;
  actions?: ChoreActions;
}) {
  const people = members ?? [];
  return (
    <section aria-label="Chores" data-testid="dashboard-card" className="rounded-lg border border-border bg-surface p-4">
      <CardTitle icon="tasks" tint="teal">Chores</CardTitle>
      <div className="mt-3 flex flex-col gap-3">
        {chores === null ? (
          <p className="text-sm text-muted">Could not load this right now.</p>
        ) : chores.length === 0 ? (
          <p className="text-sm text-muted">No chores due today or overdue.</p>
        ) : (
          groupChores(chores, people, viewerId).map((g) => (
            <div key={g.key} role="group" aria-label={`Chores for ${g.name}`}>
              <h3 className="text-sm font-semibold">{g.name}</h3>
              <ul className="mt-1 flex flex-col gap-2 text-sm">
                {g.chores.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-2">
                    <span className="min-w-0">
                      <strong>{c.title}</strong>
                      <span className="block text-muted">{c.overdue ? `Overdue, due ${formatDate(c.dueDate, datePrefs)}` : "Due today"}</span>
                    </span>
                    {actions ? (
                      <span className="flex flex-wrap gap-2">
                        {c.assigneeId && c.assigneeId !== viewerId && people.some((m) => m.user_id === c.assigneeId) ? (
                          <RowAction action={actions.nudge} id={c.id} label="Nudge" />
                        ) : null}
                        <RowAction action={actions.complete} id={c.id} label="Done" />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        {actions && members !== null ? <ChoreAddForm action={actions.create} members={people} today={today} /> : null}
      </div>
      <Link href="/tasks" className="inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2">All chores and tasks</Link>
    </section>
  );
}
