"use client";

import { useActionState } from "react";
import type { SettingsState } from "@/app/(house)/settings-actions";

/** Show or hide the snag list for this person. Hiding keeps every snag; the Snags page still opens. */
export function SnagsSetting({
  shown,
  action,
}: {
  shown: boolean;
  action: (prev: SettingsState, fd: FormData) => Promise<SettingsState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <section aria-labelledby="snags-setting-heading" className="rounded-lg border border-border bg-surface p-4">
      <h2 id="snags-setting-heading" className="text-base font-semibold">Snag list</h2>
      <p className="mt-1 text-sm text-muted">
        For new builds. Hide it once your snags are done, or if you never had any. Your snags are kept and the list can come back at any time.
      </p>
      <form action={formAction} className="mt-3">
        <input type="hidden" name="snags" value={shown ? "hide" : "show"} />
        <button
          type="submit"
          disabled={pending}
          className="min-h-[var(--touch-target)] rounded-md border border-border px-4 text-sm font-medium disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {shown ? "Hide the snag list" : "Show the snag list"}
        </button>
      </form>
      <p role="status" aria-live="polite" className="mt-2 text-sm">
        {state ? state.message : null}
      </p>
    </section>
  );
}
