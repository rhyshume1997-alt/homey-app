"use client";

import { useId, useState, useTransition } from "react";
import { saveHomeyPrefsAction } from "@/app/(house)/homey-actions";
import { clearBubbleLog } from "./HomeyBubble";
import type { HomeyPrefsPatch } from "./prefs";
import type { HomeyPrefs } from "./types";

const ROW = "flex min-h-[var(--touch-target)] items-center justify-between gap-3 rounded-md border border-border px-4 py-2";

function Switch({ checked, onChange, labelId, describedBy, disabled }: { checked: boolean; onChange: (v: boolean) => void; labelId: string; describedBy: string; disabled: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-[var(--touch-target)] min-w-[var(--touch-target)] shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
    >
      <span aria-hidden="true" className={`flex h-7 w-12 items-center rounded-full border border-border p-0.5 ${checked ? "justify-end bg-accent" : "justify-start bg-surface-muted"}`}>
        <span className={`h-6 w-6 rounded-full shadow ${checked ? "bg-accent-foreground" : "bg-surface"}`} />
      </span>
    </button>
  );
}

/** More page rows for Homey: Show Homey, Suggestion bubbles, Reset tips. */
export function HomeySettings({ prefs, storageScope }: { prefs: HomeyPrefs; storageScope?: string }) {
  const base = useId();
  const [local, setLocal] = useState(prefs);
  const [synced, setSynced] = useState(prefs);
  if (prefs.hidden !== synced.hidden || prefs.bubbles !== synced.bubbles || prefs.tipsOff !== synced.tipsOff || prefs.side !== synced.side) {
    setSynced(prefs);
    setLocal(prefs);
  }
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function apply(patch: HomeyPrefsPatch, done: string, after?: () => void) {
    const before = local;
    setLocal({ ...local, ...patch });
    startTransition(async () => {
      try {
        const res = await saveHomeyPrefsAction(patch);
        if (res.ok) {
          after?.();
          setMessage(done);
        } else {
          setLocal(before);
          setMessage(res.message);
        }
      } catch {
        setLocal(before);
        setMessage("Could not save right now.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className={ROW}>
        <div className="min-w-0">
          <p id={`${base}-show`} className="font-medium">
            Show Homey
          </p>
          <p id={`${base}-show-d`} className="text-sm text-muted">
            The floating helper on every page.
          </p>
        </div>
        <Switch
          checked={!local.hidden}
          labelId={`${base}-show`}
          describedBy={`${base}-show-d`}
          disabled={pending}
          onChange={(on) => apply({ hidden: !on }, on ? "Homey is back." : "Homey is hidden.")}
        />
      </div>
      <div className={ROW}>
        <div className="min-w-0">
          <p id={`${base}-bub`} className="font-medium">
            Suggestion bubbles
          </p>
          <p id={`${base}-bub-d`} className="text-sm text-muted">
            Short tips beside Homey, at most 3 a day.
          </p>
        </div>
        <Switch
          checked={local.bubbles}
          labelId={`${base}-bub`}
          describedBy={`${base}-bub-d`}
          disabled={pending}
          onChange={(on) => apply({ bubbles: on }, on ? "Suggestion bubbles on." : "Suggestion bubbles off.")}
        />
      </div>
      <div className={ROW}>
        <div className="min-w-0">
          <p className="font-medium">Reset tips</p>
          <p id={`${base}-tips-d`} className="text-sm text-muted">
            Show the &quot;Tap me again&quot; hint and today&apos;s suggestions again.
          </p>
        </div>
        <button
          type="button"
          aria-describedby={`${base}-tips-d`}
          disabled={pending}
          onClick={() => apply({ tipsOff: false }, "Tips reset.", () => clearBubbleLog(storageScope))}
          className="min-h-[var(--touch-target)] shrink-0 rounded-md border border-border bg-surface-muted px-4 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
        >
          Reset tips
        </button>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted">
        {message}
      </p>
    </div>
  );
}
