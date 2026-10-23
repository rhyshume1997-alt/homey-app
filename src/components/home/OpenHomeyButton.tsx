"use client";

/** Asks the Homey panel (in AppShell) to open. A window event keeps the card free of shell state. */
export function OpenHomeyButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("homey:open"))}
      className="inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      Open what needs doing
    </button>
  );
}
