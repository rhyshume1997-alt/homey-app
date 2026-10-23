"use client";

import { useActionState } from "react";
import { APPEARANCES, APPEARANCE_LABELS, type Appearance } from "@/components/appearance";
import type { SettingsState } from "@/app/(house)/settings-actions";

export function AppearanceSettings({
  current,
  action,
}: {
  current: Appearance;
  action: (prev: SettingsState, fd: FormData) => Promise<SettingsState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <section aria-labelledby="appearance-heading" className="rounded-lg border border-border bg-surface p-4">
      <h2 id="appearance-heading" className="text-base font-semibold">Appearance</h2>
      <p className="mt-1 text-sm text-muted">Dark is the default. Applies to you only.</p>
      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Theme</legend>
          {APPEARANCES.map((a) => (
            <label
              key={a}
              className="relative flex min-h-[var(--touch-target)] items-center gap-3 rounded-md border border-border bg-surface-muted px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
            >
              {/* The whole row is the tap target: the real radio covers it, the dot is drawn. */}
              <input
                type="radio"
                name="appearance"
                value={a}
                defaultChecked={a === current}
                className="peer absolute -inset-px cursor-pointer opacity-0"
              />
              <span
                aria-hidden="true"
                className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-muted peer-checked:border-accent after:size-2.5 after:rounded-full after:content-[''] peer-checked:after:bg-accent"
              />
              {APPEARANCE_LABELS[a]}
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          disabled={pending}
          className="min-h-[var(--touch-target)] self-start rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-60"
        >
          Save
        </button>
      </form>
      <p role="status" aria-live="polite" className="mt-2 text-sm">
        {state ? state.message : null}
      </p>
    </section>
  );
}
