"use client";

import { useState, useTransition } from "react";
import { describeProposal } from "./describe";
import type { AiProposal } from "@/server/ai/schemas";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/components/tasks/styles";

type Decide = (id: string) => Promise<{ ok: boolean; message: string }>;

export function ProposalList({
  proposals,
  confirm,
  reject,
}: {
  proposals: AiProposal[];
  confirm: Decide;
  reject: Decide;
}) {
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  // No router.refresh(): both actions call revalidatePath("/assistant"), so the action
  // response already carries the refreshed page. A refresh here rendered it a second time.
  const decide = (fn: Decide, id: string) =>
    start(async () => {
      setNote(await fn(id));
    });

  return (
    <section aria-label="Pending suggestions" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">Waiting for you</h2>
      <p className="text-sm text-muted">Nothing below happens until you confirm it.</p>
      {note ? (
        <p role="status" className="text-sm font-medium">
          {note.message}
        </p>
      ) : null}
      {proposals.length === 0 ? (
        <p className="text-sm text-muted">No pending suggestions.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {proposals.map((p) => (
            <li key={p.id} data-testid="proposal-card" className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-3 text-sm">
              <span>{describeProposal(p)}</span>
              <div className="flex gap-2">
                <button type="button" disabled={pending} onClick={() => decide(confirm, p.id)} className={BTN_PRIMARY}>
                  Confirm
                </button>
                <button type="button" disabled={pending} onClick={() => decide(reject, p.id)} className={BTN_SECONDARY}>
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
