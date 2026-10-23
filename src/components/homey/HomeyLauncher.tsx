"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { saveHomeyPrefsAction } from "@/app/(house)/homey-actions";
import type { HomeyPrefsPatch } from "./prefs";
import { BUBBLE_MS, HomeyBubble, SuggestionBody, takeNextSuggestion, type HomeySuggestion } from "./HomeyBubble";
import type { Expression, HomeyPrefs } from "./types";
import { DRAG_SLOP_PX, snapSide, useHomeyAvoid, useIsLargeScreen, useReducedMotion, useTapSequence } from "./useHomeyGestures";

export type HomeyGlance = "left" | "right" | null;
export type HomeyFace = (expression: Expression, size: number, glance: HomeyGlance) => ReactNode;

export type HomeyLauncherProps = {
  count: number;
  expression: Expression;
  suggestions: readonly HomeySuggestion[];
  prefs: HomeyPrefs;
  onOpen: () => void;
  face: HomeyFace;
  /** Optional per-member scope for the local bubble counter (e.g. the member's user id). */
  storageScope?: string;
};

export const FACE_SIZE = 52;
const WAVE_MS = 600;
const TOAST_MS = 5000;
const FIRST_BUBBLE_DELAY_MS = 2000;
const NEXT_BUBBLE_GAP_MS = 60_000;
/** How far he rises while a dialog is open, so he is never under its buttons. */
const DIALOG_LIFT_PX = 96;

export function homeyLabel(count: number): string {
  if (count <= 0) return "Homey, nothing needs doing";
  return count === 1 ? "Homey, 1 thing needs doing" : `Homey, ${count} things need doing`;
}

export function badgeText(count: number): string {
  return count > 9 ? "9+" : String(count);
}

function save(patch: HomeyPrefsPatch) {
  // Display preference only; a failed save just means it resets on the next load.
  void saveHomeyPrefsAction(patch).catch(() => undefined);
}

export function HomeyLauncher({ count, expression, suggestions, prefs, onOpen, face, storageScope }: HomeyLauncherProps) {
  const prefsKey = `${prefs.hidden}|${prefs.tipsOff}|${prefs.side}`;
  const [syncedKey, setSyncedKey] = useState(prefsKey);
  const [side, setSide] = useState(prefs.side);
  const [hidden, setHidden] = useState(prefs.hidden);
  const [tipsOff, setTipsOff] = useState(prefs.tipsOff);
  if (prefsKey !== syncedKey) {
    // Server copy changed (e.g. saved from the More page): adopt it.
    setSyncedKey(prefsKey);
    setSide(prefs.side);
    setHidden(prefs.hidden);
    setTipsOff(prefs.tipsOff);
  }

  const [hint, setHint] = useState(false);
  const [waving, setWaving] = useState(false);
  const [toast, setToast] = useState(false);
  const [dragDx, setDragDx] = useState(0);
  const [suggestion, setSuggestion] = useState<HomeySuggestion | null>(null);
  const [shownBubble, setShownBubble] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ startX: number; moved: boolean; pointerId: number } | null>(null);
  const suppressClickRef = useRef(false);
  const waveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  const reduced = useReducedMotion();
  const isLg = useIsLargeScreen();
  const { shrunk, keyboard, dialogOpen } = useHomeyAvoid(wrapRef);
  const effSide = isLg ? "right" : side;

  const open = useCallback(() => {
    setHint(false);
    setSuggestion(null);
    onOpenRef.current();
  }, []);

  const finishHide = useCallback(() => {
    setWaving(false);
    setHidden(true);
    setToast(true);
    save({ hidden: true });
  }, []);

  const hide = useCallback(() => {
    setHint(false);
    setSuggestion(null);
    const btn = btnRef.current;
    if (reduced || !btn || typeof btn.animate !== "function") {
      finishHide();
      return;
    }
    setWaving(true);
    btn.animate(
      [
        { transform: "rotate(0deg)" },
        { transform: "rotate(-14deg)" },
        { transform: "rotate(12deg)" },
        { transform: "rotate(-8deg)" },
        { transform: "rotate(0deg)" },
      ],
      { duration: WAVE_MS, easing: "ease-in-out" },
    );
    waveTimerRef.current = setTimeout(finishHide, WAVE_MS);
  }, [reduced, finishHide]);

  const seq = useTapSequence(
    {
      onHint: () => {
        setSuggestion(null);
        setHint(true);
      },
      onHintEnd: () => setHint(false),
      onOpen: open,
      onHide: hide,
    },
    tipsOff,
  );

  useEffect(() => () => clearTimeout(waveTimerRef.current), []);

  // The Home card (and anything else) can open the panel with window "homey:open".
  useEffect(() => {
    const onEvent = () => open();
    window.addEventListener("homey:open", onEvent);
    return () => window.removeEventListener("homey:open", onEvent);
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(false), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const bubblesAllowed = prefs.bubbles && !hidden && !dialogOpen && !hint && !waving;
  useEffect(() => {
    if (!bubblesAllowed || suggestion || suggestions.length === 0) return;
    const t = setTimeout(
      () => {
        const next = takeNextSuggestion(suggestions, storageScope);
        if (next) {
          setShownBubble(true);
          setSuggestion(next);
        }
      },
      shownBubble ? NEXT_BUBBLE_GAP_MS : FIRST_BUBBLE_DELAY_MS,
    );
    return () => clearTimeout(t);
  }, [bubblesAllowed, suggestion, suggestions, storageScope, shownBubble]);

  useEffect(() => {
    if (!suggestion) return;
    const t = setTimeout(() => setSuggestion(null), BUBBLE_MS);
    return () => clearTimeout(t);
  }, [suggestion]);

  const tipsOffForever = () => {
    setTipsOff(true);
    setHint(false);
    seq.reset();
    save({ tipsOff: true });
  };

  const undoHide = () => {
    setToast(false);
    setHidden(false);
    save({ hidden: false });
  };

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (isLg || e.button !== 0) return;
    dragRef.current = { startX: e.clientX, moved: false, pointerId: e.pointerId };
  }
  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > DRAG_SLOP_PX) {
      d.moved = true;
      setHint(false);
      setSuggestion(null);
      seq.reset();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Capture is a nicety; dragging still works without it.
      }
    }
    if (d.moved) setDragDx(dx);
  }
  function onPointerEnd(e: React.PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) return;
    suppressClickRef.current = e.type === "pointerup";
    const r = e.currentTarget.getBoundingClientRect();
    const next = snapSide(r.left + r.width / 2, window.innerWidth);
    setDragDx(0);
    if (e.type === "pointerup" && next !== side) {
      setSide(next);
      save({ side: next });
    }
  }

  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    // Keyboard (Enter/Space) and assistive tech activate with detail 0: open straight away.
    if (e.detail === 0) {
      seq.reset();
      open();
      return;
    }
    seq.tap();
  }

  const toastEl = (
    <div
      role="status"
      aria-live="polite"
      className={
        toast
          ? "fixed bottom-[calc(var(--tabbar-height)+1rem+env(safe-area-inset-bottom))] left-4 z-40 flex max-w-[calc(100vw-7rem)] items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2 text-sm shadow-lg lg:bottom-24 lg:left-auto lg:right-6"
          : "sr-only"
      }
    >
      {toast ? (
        <>
          <p className="min-w-0">
            <span className="block font-semibold">Homey&apos;s hidden.</span>
            <span className="block text-muted">Bring him back in More &gt; Homey</span>
          </p>
          <button
            type="button"
            onClick={undoHide}
            className="min-h-[var(--touch-target)] shrink-0 rounded-md border border-border bg-surface-muted px-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Undo
          </button>
        </>
      ) : null}
    </div>
  );

  if (hidden) return toastEl;

  const showSuggestion = suggestion !== null && bubblesAllowed;
  const bubbleShown = hint || showSuggestion;
  const glance: HomeyGlance = bubbleShown ? (effSide === "left" ? "right" : "left") : null;
  const shown: Expression = waving ? "happy" : hint ? "excited" : expression;
  const lift = keyboard > 0 ? keyboard : dialogOpen ? DIALOG_LIFT_PX : 0;
  const dragging = dragDx !== 0;
  const small = shrunk && !hint && !dragging;

  const position =
    effSide === "left"
      ? "left-4 bottom-[calc(var(--tabbar-height)+1rem+env(safe-area-inset-bottom))] flex-row"
      : "right-4 bottom-[calc(var(--tabbar-height)+5.5rem+env(safe-area-inset-bottom))] flex-row-reverse";

  return (
    <>
      <div
        ref={wrapRef}
        data-testid="homey-launcher"
        data-side={effSide}
        data-shrunk={small ? "true" : "false"}
        className={`pointer-events-none fixed z-40 flex items-end gap-2 ${position} lg:bottom-24 lg:left-auto lg:right-6 lg:flex-row-reverse ${dragging ? "" : "motion-safe:transition-transform motion-safe:duration-200"}`}
        style={{ transform: `translate(${dragDx}px, ${-lift}px)` }}
      >
        <button
          ref={btnRef}
          type="button"
          aria-label={homeyLabel(count)}
          aria-haspopup="dialog"
          onClick={onClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          className={`relative flex h-16 w-16 shrink-0 touch-pan-y select-none items-center justify-center rounded-full border border-border bg-surface shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] motion-safe:transition-[transform,opacity] motion-safe:duration-200 ${dialogOpen ? "" : "pointer-events-auto"}`}
          style={{ transform: small ? "scale(0.7)" : undefined, opacity: small ? 0.6 : undefined }}
        >
          <span aria-hidden="true" className="pointer-events-none">
            {face(shown, FACE_SIZE, glance)}
          </span>
          {count > 0 ? (
            <span
              aria-hidden="true"
              data-testid="homey-badge"
              className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-surface bg-accent px-1 text-xs font-bold text-accent-foreground"
            >
              {badgeText(count)}
            </span>
          ) : null}
        </button>

        <div role="status" aria-live="polite" className={bubbleShown ? "" : "sr-only"}>
          {hint ? (
            <HomeyBubble towards={effSide}>
              <p className="font-semibold">Want my help? Tap me again</p>
              <p className="text-muted">Tap 3 times to hide me</p>
              <button
                type="button"
                onClick={tipsOffForever}
                className="pointer-events-auto -mx-1 mt-1 min-h-[var(--touch-target)] rounded-md px-1 text-left font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Don&apos;t show me this again
              </button>
            </HomeyBubble>
          ) : showSuggestion && suggestion ? (
            <HomeyBubble towards={effSide} onClose={() => setSuggestion(null)}>
              <SuggestionBody suggestion={suggestion} onFollow={() => setSuggestion(null)} />
            </HomeyBubble>
          ) : null}
        </div>
      </div>
      {toastEl}
    </>
  );
}
