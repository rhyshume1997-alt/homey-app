"use client";

import { useActionState, useEffect, useState } from "react";
import { ROLE_LABELS } from "@/components/more/MembersList";
import { btnCls, dangerBtnCls, inputCls } from "./styles";

export type ManagedMemberView = { userId: string; displayName: string; role: "owner" | "member" };
export type PendingInviteView = { id: string; email: string; expiresLabel: string };
type State = { ok: boolean; message: string; token?: string } | null;
type Action = (prev: State, fd: FormData) => Promise<State>;

export type MembersManagerActions = { invite: Action; revoke: Action; remove: Action; leave: Action };

function Status({ state }: { state: State }) {
  return (
    <p role={state && !state.ok ? "alert" : "status"} aria-live="polite" className="min-h-5 text-sm">
      {state?.message ?? ""}
    </p>
  );
}

/** Two-step destructive button: the first press asks, the second does it. */
function ConfirmForm({
  action,
  hidden,
  label,
  question,
  confirmLabel,
  onDone,
}: {
  action: Action;
  hidden?: Record<string, string>;
  label: string;
  question: string;
  confirmLabel: string;
  onDone?: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [state, formAction, pending] = useActionState(action, null);
  useEffect(() => {
    if (state?.ok) onDone?.();
  }, [state, onDone]);
  if (!asking) {
    return (
      <div>
        <button type="button" className={dangerBtnCls} onClick={() => setAsking(true)}>
          {label}
        </button>
        <Status state={state} />
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border border-border p-3">
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <p className="text-sm">{question}</p>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={dangerBtnCls}>
          {pending ? "Working..." : confirmLabel}
        </button>
        <button type="button" className={btnCls} onClick={() => setAsking(false)}>
          Cancel
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

function InviteForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, null);
  const [copied, setCopied] = useState(false);
  const link = state?.token ? `${window.location.origin}/invite/${state.token}` : null;
  return (
    <div className="flex flex-col gap-2">
      <form action={formAction} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Invite by email
          <input name="email" type="email" required maxLength={254} autoComplete="off" className={inputCls} />
        </label>
        <button type="submit" disabled={pending} className={btnCls}>
          {pending ? "Creating..." : "Create invite link"}
        </button>
      </form>
      <Status state={state} />
      {link ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium">Invite link (shown once, expires in 7 days)</p>
          <input readOnly aria-label="Invite link" value={link} onFocus={(e) => e.currentTarget.select()} className={inputCls} />
          <button
            type="button"
            className={btnCls}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <p className="text-sm text-muted">Only the invited email can use it. Nothing is emailed for you.</p>
        </div>
      ) : null}
    </div>
  );
}

function RevokeForm({ id, action }: { id: string; action: Action }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="invite" value={id} />
      <button type="submit" disabled={pending} className={btnCls}>
        Revoke
      </button>
      <Status state={state} />
    </form>
  );
}

/** Settings > Members. Owners get invite, revoke and remove; everyone gets Leave. All writes are server actions. */
export function MembersManager({
  members,
  invites,
  selfUserId,
  isOwner,
  actions,
}: {
  members: readonly ManagedMemberView[];
  invites: readonly PendingInviteView[];
  selfUserId: string;
  isOwner: boolean;
  actions: MembersManagerActions;
}) {
  const goHome = () => window.location.assign("/");
  return (
    <div className="flex flex-col gap-4">
      <ul aria-label="Household members" className="flex flex-col gap-2">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-col gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">
                {m.displayName}
                {m.userId === selfUserId ? " (you)" : ""}
              </span>
              <span className="text-xs text-muted">{ROLE_LABELS[m.role]}</span>
            </div>
            {isOwner && m.userId !== selfUserId ? (
              <ConfirmForm
                action={actions.remove}
                hidden={{ user: m.userId }}
                label={`Remove ${m.displayName}`}
                question={`Remove ${m.displayName}? They lose access to this household straight away.`}
                confirmLabel="Yes, remove"
              />
            ) : null}
          </li>
        ))}
      </ul>

      {isOwner ? (
        <>
          <InviteForm action={actions.invite} />
          <section aria-labelledby="pending-invites-heading" className="flex flex-col gap-2">
            <h3 id="pending-invites-heading" className="text-base font-semibold">
              Pending invites
            </h3>
            {invites.length === 0 ? (
              <p className="text-sm text-muted">No pending invites.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 rounded-md bg-surface-muted px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{i.email}</span>
                      <span className="text-xs text-muted">Expires {i.expiresLabel}</span>
                    </span>
                    <RevokeForm id={i.id} action={actions.revoke} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      <ConfirmForm
        action={actions.leave}
        label="Leave household"
        question="Leave this household? You lose access to its data until an owner invites you again."
        confirmLabel="Yes, leave"
        onDone={goHome}
      />
    </div>
  );
}
