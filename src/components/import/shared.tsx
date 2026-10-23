import type { EmailSource, ImportActionState } from "@/contracts/email-import";
import { formatDate, type DatePrefs } from "@/components/dates";

export type ImportAction = (prev: ImportActionState, fd: FormData) => Promise<ImportActionState>;

export const NOT_CONNECTED_TEXT = "Connect Google in More to import from email";

/** Shown when Google is not connected or the connection lacks gmail.readonly. */
export function ConnectGoogleNotice() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 text-sm">
      <p>{NOT_CONNECTED_TEXT}</p>
      <a href="/settings/google" className="mt-2 inline-flex min-h-11 items-center font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2">
        Open Google settings
      </a>
    </div>
  );
}

export function ImportError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
      {message}
    </p>
  );
}

/** Email header card: sender, subject, received date, position. Never shows the body. */
export function SourceCard({ source, index, total, prefs }: { source: EmailSource; index: number; total: number; prefs?: DatePrefs }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="font-semibold">
        {source.sender}
        {source.subject ? ` · ${source.subject}` : ""}
      </p>
      <p className="text-sm text-muted">
        Received {formatDate(source.receivedAt, prefs)} · {index} of {total} {total === 1 ? "candidate" : "candidates"}
      </p>
    </div>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-normal text-muted">{children}</span>;
}
