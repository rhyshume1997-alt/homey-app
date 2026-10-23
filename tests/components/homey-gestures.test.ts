import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HINT_WINDOW_MS,
  OPEN_DELAY_MS,
  createTapSequence,
  distanceToRect,
  keyboardInset,
  snapSide,
} from "@/components/homey/useHomeyGestures";
import { homeyPrefsPatchSchema, mergeHomeyPrefs, parseHomeyPrefs, toHomeyMetadata } from "@/components/homey/prefs";
import { DEFAULT_HOMEY_PREFS } from "@/components/homey/types";

function setup(tipsOff = false) {
  const cb = { onHint: vi.fn(), onHintEnd: vi.fn(), onOpen: vi.fn(), onHide: vi.fn() };
  const seq = createTapSequence(cb, { tipsOff: () => tipsOff });
  return { cb, seq };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T09:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("tap sequence (tips on)", () => {
  it("first tap hints, second tap within the window opens after the triple-tap wait", () => {
    const { cb, seq } = setup();
    seq.tap();
    expect(cb.onHint).toHaveBeenCalledTimes(1);
    expect(cb.onOpen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    seq.tap();
    expect(cb.onOpen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    expect(cb.onOpen).toHaveBeenCalledTimes(1);
    expect(cb.onHide).not.toHaveBeenCalled();
    // The hint timer is cancelled by opening.
    vi.advanceTimersByTime(HINT_WINDOW_MS);
    expect(cb.onHintEnd).not.toHaveBeenCalled();
  });

  it("the hint expires after the window and the next tap hints again", () => {
    const { cb, seq } = setup();
    seq.tap();
    vi.advanceTimersByTime(HINT_WINDOW_MS);
    expect(cb.onHintEnd).toHaveBeenCalledTimes(1);
    seq.tap();
    expect(cb.onHint).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    expect(cb.onOpen).not.toHaveBeenCalled();
  });

  it("three taps within 600ms hide and never open", () => {
    const { cb, seq } = setup();
    seq.tap();
    vi.advanceTimersByTime(150);
    seq.tap();
    vi.advanceTimersByTime(150);
    seq.tap();
    expect(cb.onHide).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HINT_WINDOW_MS);
    expect(cb.onOpen).not.toHaveBeenCalled();
    expect(cb.onHintEnd).not.toHaveBeenCalled();
  });

  it("three slow taps are not a triple-tap", () => {
    const { cb, seq } = setup();
    seq.tap();
    vi.advanceTimersByTime(400);
    seq.tap();
    vi.advanceTimersByTime(250);
    seq.tap();
    expect(cb.onHide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    expect(cb.onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("tap sequence (tips off)", () => {
  it("one tap opens after 300ms with no hint", () => {
    const { cb, seq } = setup(true);
    seq.tap();
    vi.advanceTimersByTime(OPEN_DELAY_MS - 1);
    expect(cb.onOpen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb.onOpen).toHaveBeenCalledTimes(1);
    expect(cb.onHint).not.toHaveBeenCalled();
  });

  it("triple-tap still hides", () => {
    const { cb, seq } = setup(true);
    seq.tap();
    vi.advanceTimersByTime(200);
    seq.tap();
    vi.advanceTimersByTime(200);
    seq.tap();
    vi.advanceTimersByTime(1000);
    expect(cb.onHide).toHaveBeenCalledTimes(1);
    expect(cb.onOpen).not.toHaveBeenCalled();
  });

  it("reset cancels a pending open", () => {
    const { cb, seq } = setup(true);
    seq.tap();
    seq.reset();
    vi.advanceTimersByTime(1000);
    expect(cb.onOpen).not.toHaveBeenCalled();
  });
});

describe("geometry helpers", () => {
  it("snaps to the nearest edge", () => {
    expect(snapSide(100, 400)).toBe("left");
    expect(snapSide(300, 400)).toBe("right");
  });
  it("measures distance to a rect", () => {
    const r = { left: 10, top: 10, right: 50, bottom: 50 };
    expect(distanceToRect(30, 30, r)).toBe(0);
    expect(distanceToRect(130, 30, r)).toBe(80);
  });
  it("only treats a real inset as a keyboard", () => {
    expect(keyboardInset(800, null)).toBe(0);
    expect(keyboardInset(800, { height: 760, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(800, { height: 450, offsetTop: 0 })).toBe(350);
  });
});

describe("Homey prefs from untrusted metadata", () => {
  it("falls back to defaults for missing or bad values", () => {
    expect(parseHomeyPrefs(null)).toEqual(DEFAULT_HOMEY_PREFS);
    expect(parseHomeyPrefs(["x"])).toEqual(DEFAULT_HOMEY_PREFS);
    expect(parseHomeyPrefs({ homey_hidden: "true", homey_side: "top", homey_bubbles: 1 })).toEqual(DEFAULT_HOMEY_PREFS);
  });
  it("reads valid values and round-trips through metadata", () => {
    const p = { hidden: true, tipsOff: true, bubbles: false, side: "right" as const };
    expect(parseHomeyPrefs(toHomeyMetadata(p))).toEqual(p);
  });
  it("validates partial patches strictly", () => {
    expect(homeyPrefsPatchSchema.safeParse({ side: "right" }).success).toBe(true);
    expect(homeyPrefsPatchSchema.safeParse({}).success).toBe(false);
    expect(homeyPrefsPatchSchema.safeParse({ hidden: "yes" }).success).toBe(false);
    expect(homeyPrefsPatchSchema.safeParse({ hidden: true, role: "owner" }).success).toBe(false);
    expect(mergeHomeyPrefs(DEFAULT_HOMEY_PREFS, { tipsOff: true })).toEqual({ ...DEFAULT_HOMEY_PREFS, tipsOff: true });
  });
});
