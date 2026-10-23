import type { FormAction } from "@/components/tasks/types";
import { RowAction } from "@/components/tasks/RowAction";
import { SUGGESTIONS, SEASON_LABEL, describeInterval } from "./model";

/** Static starter list. Nothing is added until someone taps Add, and no due dates are set. */
export function Suggestions({ action, existingTitles }: { action: FormAction; existingTitles: readonly string[] }) {
  const have = new Set(existingTitles.map((t) => t.toLowerCase()));
  return (
    <details data-testid="suggestions" className="rounded-lg border border-border bg-surface p-4">
      <summary className="min-h-[var(--touch-target)] cursor-pointer text-base font-semibold">Suggested checklist</summary>
      <p className="mt-2 text-sm text-muted">
        Suggestions only, based on common upkeep for a UK new-build home. Check them against your own warranty and
        manufacturer guidance. Nothing is added until you tap Add, and no dates are set for you.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {SUGGESTIONS.map((s, idx) => {
          const added = have.has(s.title.toLowerCase());
          const meta = [s.area, describeInterval(s.interval_months), s.season ? SEASON_LABEL[s.season] : null].filter(Boolean);
          return (
            <li key={s.title} data-testid="suggestion" className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-surface-muted px-3 py-3">
              <div className="min-w-0">
                <p className="font-medium">{s.title}</p>
                <p className="text-sm text-muted">{meta.join(" · ")}</p>
              </div>
              {added ? (
                <span className="text-sm text-muted">Already added</span>
              ) : (
                <RowAction action={action} id={String(idx)} label="Add" extra={{ suggestion: String(idx) }} />
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
