"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { logEventAction, quickAddSnagAction, quickAddTaskAction } from "@/app/(house)/quick-add-actions";
import Link from "next/link";
import { GlassIcon, type IconName, type Tint } from "@/components/ui/GlassIcon";
import type { FormAction } from "@/components/tasks/types";

/** Client copy of the event slugs; the server allowlist (src/server/data/events.ts) is authoritative. */
export const EVENT_ACTIONS = [
  { slug: "washing.on", label: "Put a washing on" },
  { slug: "dishwasher.started", label: "Started the dishwasher" },
  { slug: "dishwasher.emptied", label: "Emptied the dishwasher" },
  { slug: "washing.away", label: "Put the washing away" },
  { slug: "supplies.bought", label: "Bought supplies" },
] as const;

export const QUICK_ACTIONS = [...EVENT_ACTIONS.map((e) => e.label), "Add a snag", "Add a task"] as const;

type Mode = "menu" | "task" | "snag";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const BTN =
  "min-h-[var(--touch-target)] w-full rounded-xl border border-border bg-surface-muted px-3 text-left font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";

const TILE =
  "flex min-h-[var(--touch-target)] flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-surface-muted/60 px-2 py-3 text-center text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2";

/** Navigation only: these open the page that owns the feature. No server writes happen here. */
export const LINK_TILES: { label: string; href: string; icon: IconName; tint: Tint }[] = [
  { label: "Shopping", href: "/shopping", icon: "cart", tint: "teal" },
  { label: "Bill or renewal", href: "/money", icon: "money", tint: "amber" },
  { label: "Document", href: "/documents", icon: "document", tint: "slate" },
  { label: "Meter reading", href: "/energy#readings", icon: "meter", tint: "amber" },
  { label: "Event", href: "/calendar#new", icon: "calendar", tint: "lavender" },
  { label: "Thing to get", href: "/things-to-get#new", icon: "star", tint: "lavender" },
];

function EventsForm({ onDone }: { onDone: (msg: string) => void }) {
  const [state, action, pending] = useActionState(logEventAction, null);
  const noteId = useId();
  const slugRef = useRef<string>("");
  useEffect(() => {
    if (state?.ok) {
      const label = EVENT_ACTIONS.find((e) => e.slug === slugRef.current)?.label;
      onDone(label ? `Logged: ${label}` : "Logged");
    }
  }, [state, onDone]);
  return (
    <form action={action} className="mt-3 flex flex-col gap-2">
      <label htmlFor={noteId} className="text-sm font-medium">
        Note (optional)
      </label>
      <input
        id={noteId}
        name="note"
        type="text"
        maxLength={200}
        autoComplete="off"
        className="min-h-[var(--touch-target)] rounded-md border border-border bg-surface px-3"
      />
      {state?.error ? (
        <p role="alert" className="text-sm text-warning-fg">
          {state.error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {EVENT_ACTIONS.map((e) => (
          <li key={e.slug}>
            <button type="submit" name="slug" value={e.slug} disabled={pending} onClick={() => (slugRef.current = e.slug)} className={BTN}>
              {e.label}
            </button>
          </li>
        ))}
      </ul>
    </form>
  );
}

function TitleForm({
  kind,
  action: serverAction,
  onDone,
  onBack,
}: {
  kind: "task" | "snag";
  action: FormAction;
  onDone: (msg: string) => void;
  onBack: () => void;
}) {
  const [state, action, pending] = useActionState(serverAction, null);
  const titleId = useId();
  useEffect(() => {
    if (state?.ok) onDone(kind === "task" ? "Task added" : "Snag added");
  }, [state, onDone, kind]);
  return (
    <form action={action} className="mt-3 flex flex-col gap-2">
      <label htmlFor={titleId} className="text-sm font-medium">
        {kind === "task" ? "Task title" : "Snag title"}
      </label>
      <input
        id={titleId}
        name="title"
        type="text"
        required
        maxLength={200}
        autoFocus
        autoComplete="off"
        className="min-h-[var(--touch-target)] rounded-md border border-border bg-surface px-3"
      />
      {state?.error ? (
        <p role="alert" className="text-sm text-warning-fg">
          {state.error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="min-h-[var(--touch-target)] flex-1 rounded-md bg-accent px-3 font-semibold text-accent-foreground disabled:opacity-60">
          {kind === "task" ? "Add task" : "Add snag"}
        </button>
        <button type="button" onClick={onBack} className="min-h-[var(--touch-target)] rounded-md border border-border px-3 font-medium">
          Back
        </button>
      </div>
    </form>
  );
}

export function QuickAdd() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [confirmation, setConfirmation] = useState("");
  const titleId = useId();
  const noteId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setMode("menu");
    triggerRef.current?.focus();
  }, []);

  const done = useCallback(
    (msg: string) => {
      setConfirmation(msg);
      close();
    },
    [close],
  );

  useEffect(() => {
    if (!confirmation) return;
    const t = setTimeout(() => setConfirmation(""), 5000);
    return () => clearTimeout(t);
  }, [confirmation]);

  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent("homey:avoid", { detail: { open: true } }));
    return () => {
      window.dispatchEvent(new CustomEvent("homey:avoid", { detail: { open: false } }));
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    // Focus trap: cycle among whatever focusable elements currently exist.
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) {
      e.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const activeEl = document.activeElement;
    if (e.shiftKey && (activeEl === first || activeEl === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="fixed bottom-[calc(var(--tabbar-height)+1rem+env(safe-area-inset-bottom))] right-4 z-40 flex min-h-14 min-w-14 items-center justify-center gap-2 rounded-full bg-accent px-5 text-base font-semibold text-accent-foreground shadow-lg lg:bottom-6 lg:right-6"
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />
        </svg>
        <span>Quick Add</span>
      </button>

      <p
        role="status"
        aria-live="polite"
        className={confirmation ? "fixed bottom-[calc(var(--tabbar-height)+5rem+env(safe-area-inset-bottom))] right-4 z-40 rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-lg lg:bottom-24 lg:right-6" : "sr-only"}
      >
        {confirmation}
      </p>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={noteId}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-surface/90 p-4 shadow-xl backdrop-blur-xl sm:rounded-3xl"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id={titleId} className="text-lg font-semibold">
                Quick Add
              </h2>
              <button
                type="button"
                onClick={close}
                className="min-h-[var(--touch-target)] min-w-[var(--touch-target)] rounded-md border border-border px-3 font-medium"
              >
                Close
              </button>
            </div>
            <p id={noteId} className="mt-3 text-sm text-muted">
              Records what happened in the activity log. It does not control any appliance.
            </p>
            {mode === "menu" ? (
              <>
                <EventsForm onDone={done} />
                <ul className="mt-4 grid grid-cols-3 gap-2">
                  <li>
                    <button type="button" aria-label="Add a task" onClick={() => setMode("task")} className={`${TILE} w-full`}>
                      <GlassIcon name="tasks" tint="blue" size="lg" />
                      Task
                    </button>
                  </li>
                  <li>
                    <button type="button" aria-label="Add a snag" onClick={() => setMode("snag")} className={`${TILE} w-full`}>
                      <GlassIcon name="snags" tint="rose" size="lg" />
                      Snag
                    </button>
                  </li>
                  {LINK_TILES.map((t) => (
                    <li key={t.href}>
                      <Link href={t.href} onClick={close} className={`${TILE} h-full`}>
                        <GlassIcon name={t.icon} tint={t.tint} size="lg" />
                        {t.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <TitleForm
                key={mode}
                kind={mode}
                action={mode === "task" ? quickAddTaskAction : quickAddSnagAction}
                onDone={done}
                onBack={() => setMode("menu")}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
