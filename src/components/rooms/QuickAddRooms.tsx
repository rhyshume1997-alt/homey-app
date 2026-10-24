"use client";

import { useActionState, useMemo } from "react";
import type { FormAction } from "@/components/tasks/types";
import { quickAddChips } from "./quickAdd";

const CHIP =
  "min-h-[var(--touch-target)] rounded-full border border-border bg-surface px-4 py-2 text-base font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";

/** One chip = one small form posting the existing create-room action with its name. */
function QuickChip({ name, action }: { name: string; action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="name" value={name} />
      <button type="submit" disabled={pending} className={CHIP}>
        <span aria-hidden="true">+ </span>
        {name}
      </button>
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
    </form>
  );
}

/** Tap-to-add chips for common rooms. Leads the page when the household has no rooms. */
export function QuickAddRooms({ names, action }: { names: readonly string[]; action: FormAction }) {
  const chips = useMemo(() => quickAddChips(names), [names]);
  const empty = names.length === 0;
  const headingId = "quick-add-rooms-heading";
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-base font-semibold">
          {empty ? "Which rooms do you have?" : "Quick add"}
        </h2>
        <p className="text-sm text-muted">
          {empty
            ? "Tap to add, you can rename or remove them later."
            : "Tap a room to add it. Rooms you already have are not shown."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <QuickChip key={c.key} name={c.name} action={action} />
        ))}
      </div>
    </section>
  );
}
