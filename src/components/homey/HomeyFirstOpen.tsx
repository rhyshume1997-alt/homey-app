"use client";

import type { ReactNode } from "react";
import type { Expression, FaceMoment } from "./types";

/** First-ever open content. Pure presentation. */
export function HomeyFirstOpen({
  face,
  onShow,
  onDismiss,
}: {
  face: (expression: Expression, size: number, moment?: FaceMoment) => ReactNode;
  onShow: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-4 text-center" data-testid="homey-first-open">
      {face("excited", 96, { greet: true })}
      <h3 className="text-lg font-semibold">Hello, I&apos;m your Homey, your AI assistant for this app</h3>
      <p className="text-sm">I gather what needs doing across the house and sum it up for you each day.</p>
      <p className="text-sm">I suggest, you decide. Nothing changes until you tap Confirm.</p>
      <button
        type="button"
        onClick={onShow}
        className="mt-2 min-h-[var(--touch-target)] w-full rounded-md bg-accent px-3 font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Show me today
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="min-h-[var(--touch-target)] w-full rounded-md px-3 font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Not now
      </button>
    </div>
  );
}
