"use client";

import { useState, useTransition } from "react";
import { btnCls } from "./styles";

export type SwitcherItem = { householdId: string; name: string; role: "owner" | "member" };

/** Lists the households the person belongs to. Only rendered when there is more than one. */
export function HouseholdSwitcher({
  memberships,
  currentId,
  action,
}: {
  memberships: readonly SwitcherItem[];
  currentId: string;
  action: (householdId: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (memberships.length < 2) return null;
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="Your households" className="flex flex-col gap-2">
        {memberships.map((m) => {
          const current = m.householdId === currentId;
          return (
            <li key={m.householdId} className="flex items-center justify-between gap-3 rounded-md bg-surface-muted px-3 py-2 text-sm">
              <span className="font-medium">
                {m.name} <span className="text-xs text-muted">({m.role})</span>
              </span>
              {current ? (
                <span className="text-xs text-muted">Current</span>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Switch to ${m.name}`}
                  className={btnCls}
                  onClick={() =>
                    start(async () => {
                      const r = await action(m.householdId);
                      if (r.ok) window.location.assign("/");
                      else setError(r.message);
                    })
                  }
                >
                  Switch
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p role="alert" className="min-h-5 text-sm">{error ?? ""}</p>
    </div>
  );
}
