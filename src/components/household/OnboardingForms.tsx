"use client";

import { useActionState, useEffect } from "react";
import { btnCls, inputCls } from "./styles";

type State = { ok: boolean; message: string } | null;
type Action = (prev: State, fd: FormData) => Promise<State>;

/** After success, a full navigation so the new household is read fresh (no router cache). */
function useGoHomeOnSuccess(state: State) {
  useEffect(() => {
    if (state?.ok) window.location.assign("/");
  }, [state]);
}

function Message({ state }: { state: State }) {
  return (
    <p role={state && !state.ok ? "alert" : "status"} aria-live="polite" className="min-h-5 text-sm">
      {state?.message ?? ""}
    </p>
  );
}

/** Create a household. Fields start empty: no names are pre-filled. */
export function CreateHouseholdForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, null);
  useGoHomeOnSuccess(state);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Household name
        <input name="name" required maxLength={100} autoComplete="off" className={inputCls} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Your name in this household
        <input name="displayName" required maxLength={50} autoComplete="given-name" className={inputCls} />
      </label>
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? "Creating..." : "Create household"}
      </button>
      <Message state={state} />
    </form>
  );
}

/** Accept an invite. Reveals nothing about the household beforehand. */
export function JoinHouseholdForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, null);
  useGoHomeOnSuccess(state);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Your name in this household
        <input name="displayName" required maxLength={50} autoComplete="given-name" className={inputCls} />
      </label>
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? "Joining..." : "Join the household"}
      </button>
      <Message state={state} />
    </form>
  );
}
