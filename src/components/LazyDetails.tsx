"use client";

import { useState, type ReactNode } from "react";

/**
 * A <details> whose body is only rendered once it has been opened (then kept). Used for the
 * per-row "Edit or delete" panels: each holds a full edit form, and rendering and hydrating one
 * for every row (done tasks included) made long lists slow on a phone.
 */
export function LazyDetails({
  summary,
  summaryClassName,
  className,
  children,
}: {
  summary: ReactNode;
  summaryClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details className={className} onToggle={(e) => { if (e.currentTarget.open) setOpened(true); }}>
      <summary className={summaryClassName}>{summary}</summary>
      {opened ? children : null}
    </details>
  );
}
