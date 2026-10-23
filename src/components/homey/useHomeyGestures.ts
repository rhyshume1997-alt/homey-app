"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

/** Three taps inside this window hide Homey. */
export const TRIPLE_TAP_MS = 600;
/** An opening tap waits this long to rule out a triple-tap. */
export const OPEN_DELAY_MS = 300;
/** After the first tap, a second tap within this window opens the panel. */
export const HINT_WINDOW_MS = 4000;
/** Touches or scrolls within this many pixels of Homey make him shrink out of the way. */
export const NEAR_PX = 80;
/** How long after the last scroll or nearby touch he restores. */
export const IDLE_RESTORE_MS = 1200;
/** Pointer travel (px) before a press counts as a drag rather than a tap. */
export const DRAG_SLOP_PX = 8;

export type TapCallbacks = {
  /** First tap with tips on: show "Want my help? Tap me again". */
  onHint: () => void;
  /** The hint window ran out without a second tap. */
  onHintEnd: () => void;
  onOpen: () => void;
  /** Three taps within TRIPLE_TAP_MS. */
  onHide: () => void;
};

export type TapSequence = { tap: () => void; reset: () => void };

/**
 * Pure tap-sequence state machine (timers only, no DOM).
 * - tips on: tap 1 -> hint; tap 2 within HINT_WINDOW_MS -> open (after OPEN_DELAY_MS).
 * - tips off: tap -> open after OPEN_DELAY_MS.
 * - three taps within TRIPLE_TAP_MS -> hide, cancelling any pending open.
 */
export function createTapSequence(cb: TapCallbacks, opts: { tipsOff: () => boolean }): TapSequence {
  let taps: number[] = [];
  let hinted = false;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    if (openTimer !== undefined) clearTimeout(openTimer);
    if (hintTimer !== undefined) clearTimeout(hintTimer);
    openTimer = undefined;
    hintTimer = undefined;
  };

  const reset = () => {
    clearTimers();
    taps = [];
    hinted = false;
  };

  const tap = () => {
    const now = Date.now();
    taps = [...taps.filter((t) => now - t < TRIPLE_TAP_MS), now];
    if (taps.length >= 3) {
      reset();
      cb.onHide();
      return;
    }
    if (hinted || opts.tipsOff()) {
      if (openTimer !== undefined) clearTimeout(openTimer);
      openTimer = setTimeout(() => {
        reset();
        cb.onOpen();
      }, OPEN_DELAY_MS);
      return;
    }
    hinted = true;
    cb.onHint();
    hintTimer = setTimeout(() => {
      hintTimer = undefined;
      // A second tap already landed; the pending open will finish the sequence.
      if (openTimer !== undefined) return;
      hinted = false;
      taps = [];
      cb.onHintEnd();
    }, HINT_WINDOW_MS);
  };

  return { tap, reset };
}

/** React wrapper: a stable tap() that always calls the latest callbacks. */
export function useTapSequence(cb: TapCallbacks, tipsOff: boolean): TapSequence {
  const cbRef = useRef(cb);
  const tipsRef = useRef(tipsOff);
  const seqRef = useRef<TapSequence | null>(null);
  useEffect(() => {
    cbRef.current = cb;
    tipsRef.current = tipsOff;
  });
  useEffect(() => {
    const seq = createTapSequence(
      {
        onHint: () => cbRef.current.onHint(),
        onHintEnd: () => cbRef.current.onHintEnd(),
        onOpen: () => cbRef.current.onOpen(),
        onHide: () => cbRef.current.onHide(),
      },
      { tipsOff: () => tipsRef.current },
    );
    seqRef.current = seq;
    return () => {
      seq.reset();
      seqRef.current = null;
    };
  }, []);
  const tap = useCallback(() => seqRef.current?.tap(), []);
  const reset = useCallback(() => seqRef.current?.reset(), []);
  return { tap, reset };
}

/** Which edge a dragged Homey snaps to, from his centre x. */
export function snapSide(centerX: number, viewportWidth: number): "left" | "right" {
  return centerX < viewportWidth / 2 ? "left" : "right";
}

/** Shortest distance from a point to a rectangle (0 when inside). */
export function distanceToRect(x: number, y: number, r: { left: number; top: number; right: number; bottom: number }): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

/** Height of the on-screen keyboard (or other bottom inset) from visualViewport, 0 when none. */
export function keyboardInset(innerHeight: number, vv: { height: number; offsetTop: number } | null | undefined): number {
  if (!vv) return 0;
  const inset = Math.round(innerHeight - vv.height - vv.offsetTop);
  // Small differences are browser chrome, not a keyboard.
  return inset > 80 ? inset : 0;
}

function mediaQueryStore(query: string) {
  const get = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false);
  const subscribe = (onChange: () => void) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
    const mq = window.matchMedia(query);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  };
  return { get, subscribe };
}

const reducedStore = mediaQueryStore("(prefers-reduced-motion: reduce)");
const lgStore = mediaQueryStore("(min-width: 1024px)");

export function useReducedMotion(): boolean {
  return useSyncExternalStore(reducedStore.subscribe, reducedStore.get, () => false);
}

export function useIsLargeScreen(): boolean {
  return useSyncExternalStore(lgStore.subscribe, lgStore.get, () => false);
}

/**
 * Keeps Homey out of the way:
 * - shrunk while the page scrolls or the user touches within NEAR_PX of him, restoring after IDLE_RESTORE_MS;
 * - lift (px) above the on-screen keyboard (visualViewport);
 * - dialogOpen while any dialog announces itself with window CustomEvent "homey:avoid" {open}.
 */
export function useHomeyAvoid(elRef: RefObject<HTMLElement | null>) {
  const [shrunk, setShrunk] = useState(false);
  const [keyboard, setKeyboard] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let idle: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      setShrunk(true);
      if (idle !== undefined) clearTimeout(idle);
      idle = setTimeout(() => setShrunk(false), IDLE_RESTORE_MS);
    };
    const onScroll = () => bump();
    const onPointer = (e: PointerEvent) => {
      const el = elRef.current;
      if (!el) return;
      if (e.type === "pointermove" && e.pointerType === "mouse") return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      if (distanceToRect(e.clientX, e.clientY, el.getBoundingClientRect()) <= NEAR_PX) bump();
    };
    const onAvoid = (e: Event) => {
      const open = (e as CustomEvent<{ open?: unknown }>).detail?.open;
      setDialogOpen(open === true);
    };
    const vv = window.visualViewport;
    const onViewport = () => setKeyboard(keyboardInset(window.innerHeight, window.visualViewport));

    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("pointerdown", onPointer, { passive: true, capture: true });
    document.addEventListener("pointermove", onPointer, { passive: true, capture: true });
    window.addEventListener("homey:avoid", onAvoid);
    vv?.addEventListener("resize", onViewport);
    vv?.addEventListener("scroll", onViewport);
    return () => {
      if (idle !== undefined) clearTimeout(idle);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("pointerdown", onPointer, { capture: true });
      document.removeEventListener("pointermove", onPointer, { capture: true });
      window.removeEventListener("homey:avoid", onAvoid);
      vv?.removeEventListener("resize", onViewport);
      vv?.removeEventListener("scroll", onViewport);
    };
  }, [elRef]);

  return { shrunk, keyboard, dialogOpen };
}
