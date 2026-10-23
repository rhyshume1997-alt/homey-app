"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type HomeySuggestion = { key: string; text: string; href: string };

/** Most suggestion bubbles shown per member per day (per device, localStorage). */
export const BUBBLES_PER_DAY = 3;
/** A suggestion bubble hides itself after this long. */
export const BUBBLE_MS = 6000;

const STORAGE_PREFIX = "ourhome.homey.bubbles";

type BubbleLog = { date: string; count: number; seen: string[] };

/** Suggestions only ever link inside the app. */
export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\");
}

/** Local calendar date, YYYY-MM-DD. */
export function localDay(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function storageKey(scope?: string) {
  return scope ? `${STORAGE_PREFIX}.${scope}` : STORAGE_PREFIX;
}

/** Today's bubble log. Storage can be missing, full, blocked or tampered with; every access is guarded. */
export function readBubbleLog(scope?: string, day: string = localDay()): BubbleLog {
  const empty: BubbleLog = { date: day, count: 0, seen: [] };
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return empty;
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return empty;
    const o = v as Record<string, unknown>;
    if (o.date !== day) return empty;
    const count = typeof o.count === "number" && Number.isFinite(o.count) ? Math.max(0, Math.floor(o.count)) : 0;
    const seen = Array.isArray(o.seen) ? o.seen.filter((s): s is string => typeof s === "string").slice(0, 50) : [];
    return { date: day, count, seen };
  } catch {
    return empty;
  }
}

/** Picks the next suggestion to show today and records it, or null when none or the daily cap is reached. */
export function takeNextSuggestion(suggestions: readonly HomeySuggestion[], scope?: string, day: string = localDay()): HomeySuggestion | null {
  const log = readBubbleLog(scope, day);
  if (log.count >= BUBBLES_PER_DAY) return null;
  const next = suggestions.find((s) => isInternalHref(s.href) && !log.seen.includes(s.key));
  if (!next) return null;
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify({ date: day, count: log.count + 1, seen: [...log.seen, next.key] }));
  } catch {
    // Without storage we cannot count, so do not show anything rather than risk nagging.
    return null;
  }
  return next;
}

/** Clears today's bubble log (used by "Reset tips"). */
export function clearBubbleLog(scope?: string) {
  try {
    window.localStorage.removeItem(storageKey(scope));
  } catch {
    // Ignore: nothing to clear.
  }
}

/** Speech bubble beside Homey. The tail points back towards him. */
export function HomeyBubble({
  towards,
  children,
  onClose,
  id,
}: {
  /** Which side Homey is on, relative to the bubble. */
  towards: "left" | "right";
  children: ReactNode;
  onClose?: () => void;
  id?: string;
}) {
  return (
    <div
      id={id}
      className="pointer-events-auto relative flex max-w-[min(20rem,calc(100vw-11rem))] items-start gap-1 rounded-lg border border-border bg-surface p-3 text-sm text-foreground shadow-lg lg:max-w-xs"
    >
      <span
        aria-hidden="true"
        className={`absolute bottom-6 h-3 w-3 rotate-45 border-border bg-surface ${towards === "left" ? "-left-1.5 border-b border-l" : "-right-1.5 border-r border-t"}`}
      />
      <div className="min-w-0 flex-1">{children}</div>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="-m-2 flex min-h-[var(--touch-target)] min-w-[var(--touch-target)] shrink-0 items-center justify-center rounded-md text-muted focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/** The suggestion content: tap goes to its page. */
export function SuggestionBody({ suggestion, onFollow }: { suggestion: HomeySuggestion; onFollow: () => void }) {
  return (
    <Link
      href={suggestion.href}
      onClick={onFollow}
      className="-m-1 flex min-h-[var(--touch-target)] flex-col justify-center rounded-md p-1 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <span className="font-semibold">{suggestion.text}</span>
      <span className="text-xs text-muted">Tap to open</span>
    </Link>
  );
}
