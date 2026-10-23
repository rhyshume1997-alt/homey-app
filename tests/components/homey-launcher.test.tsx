// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ saveHomeyPrefsAction: vi.fn() }));
vi.mock("@/app/(house)/homey-actions", () => mocks);

import { HomeyLauncher, type HomeyLauncherProps } from "@/components/homey/HomeyLauncher";
import { HomeySettings } from "@/components/homey/HomeySettings";
import { BUBBLES_PER_DAY, readBubbleLog } from "@/components/homey/HomeyBubble";
import { DEFAULT_HOMEY_PREFS } from "@/components/homey/types";

const face = vi.fn((expression: string, size: number, glance: string | null) => (
  <span data-testid="face" data-expression={expression} data-size={size} data-glance={glance ?? "none"} />
));

function renderLauncher(over: Partial<HomeyLauncherProps> = {}) {
  const onOpen = vi.fn();
  const props: HomeyLauncherProps = {
    count: 4,
    expression: "concerned",
    suggestions: [],
    prefs: DEFAULT_HOMEY_PREFS,
    onOpen,
    face,
    ...over,
  };
  const utils = render(<HomeyLauncher {...props} />);
  return { ...utils, onOpen: props.onOpen as ReturnType<typeof vi.fn> };
}

const homey = () => screen.getByRole("button", { name: /^Homey,/ });
const tap = () => fireEvent.click(homey(), { detail: 1 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0));
  mocks.saveHomeyPrefsAction.mockReset();
  mocks.saveHomeyPrefsAction.mockResolvedValue({ ok: true, prefs: DEFAULT_HOMEY_PREFS });
  face.mockClear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("HomeyLauncher", () => {
  it("is a labelled button with a capped badge", () => {
    const { rerender } = renderLauncher({ count: 4 });
    expect(homey().getAttribute("aria-label")).toBe("Homey, 4 things need doing");
    expect(screen.getByTestId("homey-badge").textContent).toBe("4");
    rerender(<HomeyLauncher count={12} expression="happy" suggestions={[]} prefs={DEFAULT_HOMEY_PREFS} onOpen={() => {}} face={face} />);
    expect(homey().getAttribute("aria-label")).toBe("Homey, 12 things need doing");
    expect(screen.getByTestId("homey-badge").textContent).toBe("9+");
    rerender(<HomeyLauncher count={0} expression="happy" suggestions={[]} prefs={DEFAULT_HOMEY_PREFS} onOpen={() => {}} face={face} />);
    expect(screen.queryByTestId("homey-badge")).toBeNull();
  });

  it("docks to the saved side", () => {
    renderLauncher({ prefs: { ...DEFAULT_HOMEY_PREFS, side: "right" } });
    expect(screen.getByTestId("homey-launcher").dataset.side).toBe("right");
  });

  it("tap 1 hints with an excited face, tap 2 opens", () => {
    const { onOpen } = renderLauncher();
    tap();
    expect(screen.getByText("Want my help? Tap me again")).toBeTruthy();
    expect(screen.getByText("Tap 3 times to hide me")).toBeTruthy();
    expect(screen.getByTestId("face").dataset.expression).toBe("excited");
    expect(screen.getByTestId("face").dataset.glance).toBe("right");
    act(() => vi.advanceTimersByTime(1000));
    tap();
    act(() => vi.advanceTimersByTime(300));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Want my help? Tap me again")).toBeNull();
    expect(screen.getByTestId("face").dataset.expression).toBe("concerned");
  });

  it("Enter/Space (detail 0 click) opens straight away", () => {
    const { onOpen } = renderLauncher();
    fireEvent.click(homey());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("'Don't show me this again' saves tipsOff and later taps open directly", () => {
    const { onOpen } = renderLauncher();
    tap();
    fireEvent.click(screen.getByRole("button", { name: "Don't show me this again" }));
    expect(mocks.saveHomeyPrefsAction).toHaveBeenCalledWith({ tipsOff: true });
    act(() => vi.advanceTimersByTime(1000));
    tap();
    expect(screen.queryByText("Want my help? Tap me again")).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("triple-tap hides, saves, shows the toast, and Undo brings him back", () => {
    const { onOpen } = renderLauncher();
    tap();
    act(() => vi.advanceTimersByTime(100));
    tap();
    act(() => vi.advanceTimersByTime(100));
    tap();
    // jsdom has no Element.animate, so the wave is skipped and he hides at once.
    expect(screen.queryByRole("button", { name: /^Homey,/ })).toBeNull();
    expect(mocks.saveHomeyPrefsAction).toHaveBeenCalledWith({ hidden: true });
    expect(screen.getByText("Homey's hidden.")).toBeTruthy();
    expect(screen.getByText("Bring him back in More > Homey")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(mocks.saveHomeyPrefsAction).toHaveBeenLastCalledWith({ hidden: false });
    expect(homey()).toBeTruthy();
    act(() => vi.advanceTimersByTime(5000));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("the hidden toast goes after 5s", () => {
    renderLauncher({ prefs: { ...DEFAULT_HOMEY_PREFS, tipsOff: true } });
    tap();
    tap();
    tap();
    expect(screen.getByText("Homey's hidden.")).toBeTruthy();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText("Homey's hidden.")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Homey,/ })).toBeNull();
  });

  it("renders nothing visible when hidden in prefs, but homey:open still opens the panel", () => {
    const { onOpen } = renderLauncher({ prefs: { ...DEFAULT_HOMEY_PREFS, hidden: true } });
    expect(screen.queryByRole("button", { name: /^Homey,/ })).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("homey:open"));
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("shrinks while the page scrolls and restores after 1.2s idle", () => {
    renderLauncher();
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByTestId("homey-launcher").dataset.shrunk).toBe("true");
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByTestId("homey-launcher").dataset.shrunk).toBe("false");
  });

  it("moves up while a dialog announces itself", () => {
    renderLauncher();
    act(() => {
      window.dispatchEvent(new CustomEvent("homey:avoid", { detail: { open: true } }));
    });
    expect(screen.getByTestId("homey-launcher").style.transform).toBe("translate(0px, -96px)");
    act(() => {
      window.dispatchEvent(new CustomEvent("homey:avoid", { detail: { open: false } }));
    });
    expect(screen.getByTestId("homey-launcher").style.transform).toBe("translate(0px, 0px)");
  });

  it("drags across the screen to switch side and saves it", () => {
    Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
    renderLauncher();
    const btn = homey();
    btn.getBoundingClientRect = () => ({ left: 300, right: 364, top: 0, bottom: 64, width: 64, height: 64, x: 300, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(btn, { clientX: 40, button: 0, pointerId: 1 });
    fireEvent.pointerMove(btn, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(btn, { clientX: 330, pointerId: 1 });
    fireEvent.click(btn, { detail: 1 });
    expect(screen.getByTestId("homey-launcher").dataset.side).toBe("right");
    expect(mocks.saveHomeyPrefsAction).toHaveBeenCalledWith({ side: "right" });
    // The click that ends a drag is not a tap.
    expect(screen.queryByText("Want my help? Tap me again")).toBeNull();
  });
});

describe("suggestion bubbles", () => {
  const suggestions = [
    { key: "bins", text: "Bins out tonight", href: "/bins" },
    { key: "figures", text: "Check this month's figures", href: "/money/check" },
    { key: "evil", text: "Elsewhere", href: "//evil.example" },
  ];

  it("shows one at a time, auto-dismisses after 6s and counts it", () => {
    renderLauncher({ suggestions });
    act(() => vi.advanceTimersByTime(2000));
    const link = screen.getByRole("link", { name: /Bins out tonight/ });
    expect(link.getAttribute("href")).toBe("/bins");
    expect(screen.queryByText("Check this month's figures")).toBeNull();
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.queryByText("Bins out tonight")).toBeNull();
    expect(readBubbleLog().count).toBe(1);
  });

  it("the x dismisses it", () => {
    renderLauncher({ suggestions });
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Bins out tonight")).toBeNull();
  });

  it("stops at the daily cap and never links off-site", () => {
    window.localStorage.setItem("ourhome.homey.bubbles", JSON.stringify({ date: "2026-10-22", count: BUBBLES_PER_DAY, seen: [] }));
    renderLauncher({ suggestions });
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    window.localStorage.setItem("ourhome.homey.bubbles", JSON.stringify({ date: "2026-10-22", count: 2, seen: ["bins", "figures"] }));
    renderLauncher({ suggestions });
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("survives broken storage", () => {
    window.localStorage.setItem("ourhome.homey.bubbles", "{not json");
    renderLauncher({ suggestions });
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText("Bins out tonight")).toBeTruthy();
  });

  it("is off when bubbles are off or a dialog is open", () => {
    renderLauncher({ suggestions, prefs: { ...DEFAULT_HOMEY_PREFS, bubbles: false } });
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.queryByText("Bins out tonight")).toBeNull();
    cleanup();
    renderLauncher({ suggestions });
    act(() => {
      window.dispatchEvent(new CustomEvent("homey:avoid", { detail: { open: true } }));
    });
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.queryByText("Bins out tonight")).toBeNull();
  });
});

describe("HomeySettings", () => {
  it("toggles Show Homey and bubbles, and resets tips", async () => {
    render(<HomeySettings prefs={{ ...DEFAULT_HOMEY_PREFS, hidden: true, tipsOff: true }} />);
    const show = screen.getByRole("switch", { name: "Show Homey" });
    expect(show.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      fireEvent.click(show);
    });
    expect(mocks.saveHomeyPrefsAction).toHaveBeenCalledWith({ hidden: false });
    expect(screen.getByRole("switch", { name: "Show Homey" }).getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Suggestion bubbles" }));
    });
    expect(mocks.saveHomeyPrefsAction).toHaveBeenLastCalledWith({ bubbles: false });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset tips" }));
    });
    expect(mocks.saveHomeyPrefsAction).toHaveBeenLastCalledWith({ tipsOff: false });
    expect(screen.getByText("Tips reset.")).toBeTruthy();
  });

  it("rolls back and explains when saving fails", async () => {
    mocks.saveHomeyPrefsAction.mockResolvedValue({ ok: false, message: "Could not save right now." });
    render(<HomeySettings prefs={DEFAULT_HOMEY_PREFS} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Suggestion bubbles" }));
    });
    expect(screen.getByRole("switch", { name: "Suggestion bubbles" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Could not save right now.")).toBeTruthy();
  });
});
