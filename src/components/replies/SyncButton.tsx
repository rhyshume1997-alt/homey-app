"use client";

import { useActionState } from "react";
import type { FormAction } from "@/components/tasks/types";
import { BTN_SECONDARY } from "@/components/tasks/styles";

/** "Sync from Gmail" for connected users; otherwise a link to connect Google. */
export function SyncButton({ action, connected }: { action: FormAction; connected: boolean }) {
  const [state, formAction, pending] = useActionState(action, null);
  if (!connected) {
    return (
      <a href="/settings/google" className="inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2">
        Connect Google to sync from Gmail
      </a>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <button type="submit" disabled={pending} className={BTN_SECONDARY}>
        {pending ? "Syncing..." : "Sync from Gmail"}
      </button>
      {state?.error && <p role="alert" className="text-sm text-warning-fg">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Synced.</p>}
    </form>
  );
}
