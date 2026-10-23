"use client";

import { useId, useState } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import type { NeedBucket, NeedItem } from "./types";

export type ProposeResult = { proposalId: string; text: string } | { error: string };
export type DraftResult = { draft: string } | { error: string };
export type ActionResult = { ok: true } | { error: string } | void;

export type NeedListHandlers = {
  onPropose: (key: string) => Promise<ProposeResult>;
  onConfirm: (proposalId: string) => Promise<ActionResult>;
  onReject: (proposalId: string) => Promise<ActionResult>;
  onDraftThanks: (key: string) => Promise<DraftResult>;
  onSendThanks: (key: string, message: string) => Promise<ActionResult>;
};

type RowState =
  | { kind: "busy" }
  | { kind: "proposal"; id: string; text: string }
  | { kind: "draft"; text: string; editing: boolean }
  | { kind: "done"; msg: string }
  | { kind: "error"; msg: string };

const SECTION_ORDER: NeedBucket[] = ["activity", "overdue", "today", "soon", "check"];
const SECTION_TITLE: Record<NeedBucket, string> = {
  activity: "",
  overdue: "Overdue",
  today: "Today",
  soon: "Due soon",
  check: "Worth checking",
};
export const THANKS_MAX = 200;

const BTN =
  "inline-flex min-h-[var(--touch-target)] items-center justify-center rounded-md border border-border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";
const BTN_PRIMARY =
  "inline-flex min-h-[var(--touch-target)] items-center justify-center rounded-md bg-accent px-3 text-sm font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";
const GENERIC = "Something went wrong. Try again.";

function errorText(r: unknown): string | null {
  return r && typeof r === "object" && "error" in r ? String((r as { error: unknown }).error) : null;
}

function Row({ item, handlers }: { item: NeedItem; handlers: NeedListHandlers }) {
  const [state, setState] = useState<RowState | null>(null);
  const areaId = useId();
  const busy = state?.kind === "busy";
  const a = item.action;

  async function propose() {
    setState({ kind: "busy" });
    try {
      const r = await handlers.onPropose(item.key);
      const err = errorText(r);
      if (err || !("proposalId" in r)) setState({ kind: "error", msg: err ?? GENERIC });
      else setState({ kind: "proposal", id: r.proposalId, text: r.text });
    } catch {
      setState({ kind: "error", msg: GENERIC });
    }
  }
  async function resolve(id: string, confirm: boolean) {
    setState({ kind: "busy" });
    try {
      const r = await (confirm ? handlers.onConfirm(id) : handlers.onReject(id));
      const err = errorText(r);
      setState(err ? { kind: "error", msg: err } : { kind: "done", msg: confirm ? "Done." : "Cancelled. Nothing changed." });
    } catch {
      setState({ kind: "error", msg: GENERIC });
    }
  }
  async function draft() {
    setState({ kind: "busy" });
    try {
      const r = await handlers.onDraftThanks(item.key);
      const err = errorText(r);
      if (err || !("draft" in r)) setState({ kind: "error", msg: err ?? GENERIC });
      else setState({ kind: "draft", text: r.draft.slice(0, THANKS_MAX), editing: false });
    } catch {
      setState({ kind: "error", msg: GENERIC });
    }
  }
  async function send(message: string) {
    setState({ kind: "busy" });
    try {
      const r = await handlers.onSendThanks(item.key, message);
      const err = errorText(r);
      setState(err ? { kind: "error", msg: err } : { kind: "done", msg: "Thanks sent in the app." });
    } catch {
      setState({ kind: "error", msg: GENERIC });
    }
  }

  return (
    <li className="rounded-lg border border-border bg-surface/70 p-3" data-key={item.key}>
      <div className="flex items-start gap-2">
        <StatusPill light={item.light} />
        <p className="min-w-0 flex-1 text-sm">{item.text}</p>
      </div>
      {a && state?.kind !== "done" ? (
        <div className="mt-2 flex justify-end">
          {a.type === "open" ? (
            <a href={a.href} className={BTN}>
              {a.label} <span aria-hidden="true">&nbsp;›</span>
            </a>
          ) : (
            <button
              type="button"
              disabled={busy || state?.kind === "proposal" || state?.kind === "draft"}
              onClick={a.type === "draft_thanks" ? draft : propose}
              className={BTN}
            >
              {a.type === "propose_task" ? "+ Add task" : a.type === "propose_shopping" ? "+ Shopping" : "Draft thanks"}
            </button>
          )}
        </div>
      ) : null}
      <div aria-live="polite">
        {busy ? <p className="mt-2 text-sm text-muted">Working on it...</p> : null}
        {state?.kind === "error" ? (
          <p role="alert" className="mt-2 text-sm text-warning-fg">
            {state.msg}
          </p>
        ) : null}
        {state?.kind === "done" ? <p className="mt-2 text-sm text-success-fg">{state.msg}</p> : null}
        {state?.kind === "proposal" ? (
          <div className="mt-2 rounded-md border border-border bg-surface-muted p-2" data-testid="proposal-strip">
            <p className="text-sm font-medium">{state.text}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className={BTN_PRIMARY} onClick={() => resolve(state.id, true)}>
                Confirm
              </button>
              <button type="button" className={BTN} onClick={() => resolve(state.id, false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {state?.kind === "draft" ? (
          <div className="mt-2 rounded-md border border-border bg-surface-muted p-2" data-testid="draft-strip">
            {state.editing ? (
              <>
                <label htmlFor={areaId} className="text-sm font-medium">
                  Your message
                </label>
                <textarea
                  id={areaId}
                  value={state.text}
                  maxLength={THANKS_MAX}
                  rows={3}
                  onChange={(e) => setState({ kind: "draft", text: e.target.value, editing: true })}
                  className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm"
                />
                <p className="text-xs text-muted">
                  {state.text.length}/{THANKS_MAX}
                </p>
              </>
            ) : (
              <p className="text-sm">{state.text}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={BTN_PRIMARY} disabled={!state.text.trim()} onClick={() => send(state.text.trim())}>
                Send in app
              </button>
              {!state.editing ? (
                <button type="button" className={BTN} onClick={() => setState({ kind: "draft", text: state.text, editing: true })}>
                  Edit
                </button>
              ) : null}
              <button type="button" className={BTN} onClick={() => setState(null)}>
                Not now
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function NeedList({ items, otherName, ...handlers }: { items: NeedItem[]; otherName: string } & NeedListHandlers) {
  return (
    <div className="flex flex-col gap-4">
      {SECTION_ORDER.map((b) => {
        const rows = items.filter((i) => i.bucket === b);
        if (rows.length === 0) return null;
        const title = b === "activity" ? `From ${otherName} today` : SECTION_TITLE[b];
        return (
          <section key={b} aria-label={title}>
            <h3 className="mb-2 text-sm font-semibold">{title}</h3>
            <ul className="flex flex-col gap-2">
              {rows.map((i) => (
                <Row key={i.key} item={i} handlers={handlers} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
