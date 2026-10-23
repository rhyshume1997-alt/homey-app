import { requireSession } from "@/server/auth/session";
import { autoSyncIfDue, isGmailConnected, listThreads } from "@/server/data/replies";
import { RepliesList } from "@/components/replies/RepliesList";
import { SyncButton } from "@/components/replies/SyncButton";
import { closeThreadAction, reopenThreadAction, syncGmailAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function RepliesPage() {
  const session = await requireSession();
  await autoSyncIfDue(session);
  const [threads, connected] = await Promise.all([listThreads(), isGmailConnected()]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Awaiting replies</h1>
      <p className="text-sm text-muted">
        Subject, company domain and dates only, synced from each person&apos;s Gmail. Message text and addresses never leave Gmail.
      </p>
      <SyncButton action={syncGmailAction} connected={connected} />
      {threads.ok ? (
        <RepliesList
          threads={threads.data}
          now={new Date()}
          datePrefs={session.datePrefs}
          actions={{ close: closeThreadAction, reopen: reopenThreadAction }}
        />
      ) : (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
          {threads.error}
        </p>
      )}
    </div>
  );
}
