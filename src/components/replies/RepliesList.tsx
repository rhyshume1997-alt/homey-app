import { formatDate, type DatePrefs } from "@/components/dates";
import { RowAction } from "@/components/tasks/RowAction";
import type { FormAction } from "@/components/tasks/types";
import { daysWaiting, waitingLabel, type EmailThread } from "./types";

export type ReplyActions = { close: FormAction; reopen: FormAction };

type Common = { now: Date; prefs?: DatePrefs; actions: ReplyActions };

function ThreadRow({ t, now, prefs, actions }: { t: EmailThread } & Common) {
  const days = daysWaiting(t.last_message_at, now);
  return (
    <li data-testid="reply-row" className="rounded-md bg-surface-muted px-3 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <strong>{t.counterpart_domain}</strong>
        {t.status === "awaiting" && <span className="text-sm text-muted">waiting {waitingLabel(days)}</span>}
      </div>
      <p className="break-words text-sm">{t.subject || "(no subject)"}</p>
      <p className="text-sm text-muted">
        {t.member}, last message {formatDate(t.last_message_at, prefs)}
        {t.last_from === "them" ? " (they replied)" : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {t.status === "closed" ? (
          <RowAction action={actions.reopen} id={t.id} label="Reopen" />
        ) : (
          <RowAction action={actions.close} id={t.id} label="Mark closed" />
        )}
      </div>
    </li>
  );
}

function Group({ title, rows, ...rest }: { title: string; rows: EmailThread[] } & Common) {
  return (
    <ul aria-label={title} className="flex flex-col gap-2 text-sm">
      {rows.map((t) => <ThreadRow key={t.id} t={t} {...rest} />)}
    </ul>
  );
}

export function RepliesList({
  threads, now, datePrefs, actions,
}: { threads: readonly EmailThread[]; now: Date; datePrefs?: DatePrefs; actions: ReplyActions }) {
  if (threads.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
        Not connected yet. Nothing has been synced from Gmail.
      </p>
    );
  }
  const awaiting = threads.filter((t) => t.status === "awaiting");
  const replied = threads.filter((t) => t.status === "replied");
  const closed = threads.filter((t) => t.status === "closed");
  const common = { now, prefs: datePrefs, actions };
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Awaiting a reply" className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-base font-semibold">Awaiting a reply ({awaiting.length})</h2>
        {awaiting.length === 0 ? (
          <p className="text-sm text-muted">Nothing is waiting on a reply.</p>
        ) : (
          <Group title="Awaiting" rows={awaiting} {...common} />
        )}
      </section>
      {replied.length > 0 && (
        <details className="rounded-lg border border-border bg-surface p-4">
          <summary className="min-h-[var(--touch-target)] cursor-pointer text-base font-semibold">Replied ({replied.length})</summary>
          <div className="mt-3"><Group title="Replied" rows={replied} {...common} /></div>
        </details>
      )}
      {closed.length > 0 && (
        <details className="rounded-lg border border-border bg-surface p-4">
          <summary className="min-h-[var(--touch-target)] cursor-pointer text-base font-semibold">Closed ({closed.length})</summary>
          <div className="mt-3"><Group title="Closed" rows={closed} {...common} /></div>
        </details>
      )}
    </div>
  );
}
