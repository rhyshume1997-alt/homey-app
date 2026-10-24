"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { HomeyFirstOpen } from "./HomeyFirstOpen";
import { NeedList, type NeedListHandlers } from "./NeedList";
import { worstLight } from "@/components/status";
import { expressionFor, type Expression, type FaceMoment, type HomeyDigest, type NeedItem } from "./types";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type HomeyPanelProps = NeedListHandlers & {
  open: boolean;
  onClose: () => void;
  firstName: string;
  otherName: string;
  items: NeedItem[];
  digest: HomeyDigest | null;
  /** True when some data sources failed to load. */
  partial?: boolean;
  /** Spend this month and the cap, in pounds. */
  spend: { used: number; cap: number };
  face: (expression: Expression, size: number, moment?: FaceMoment) => ReactNode;
  /** The AI summary is being worked out: Homey looks like he is talking. */
  thinking?: boolean;
  onRefresh: () => void;
  /** When true, show first-ever-open content instead of the list. */
  firstOpen?: boolean;
  onFirstOpenShow?: () => void;
  onFirstOpenDismiss?: () => void;
  /** Injectable clock for tests. */
  now?: Date;
};

export function greetingFor(now: Date, firstName: string): string {
  const hour =
    Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/London" }).format(now)) % 24;
  const part = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
  return `${part} ${firstName}!`;
}

function londonTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/London" }).format(
    new Date(iso),
  );
}

const gbp = (n: number) => `£${n.toFixed(2)}`;

export function HomeyPanel(props: HomeyPanelProps) {
  const { open, onClose, firstName, otherName, items, digest, partial, spend, face, onRefresh, firstOpen } = props;
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      returnTo?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) {
      e.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const expression: Expression = items.length === 0 ? "happy" : expressionFor(worstLight(items.map((i) => i.light)));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 lg:justify-end" data-testid="homey-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="frosted flex h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface/90 shadow-xl backdrop-blur-md lg:h-full lg:w-[400px] lg:rounded-none lg:rounded-l-2xl"
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border lg:hidden" data-testid="drag-handle" />
        <div className="flex items-start gap-3 p-4 pb-2">
          <div className="shrink-0">{face(firstOpen ? "smiley" : expression, 56, { greet: !firstOpen, talking: props.thinking })}</div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold">
              What needs doing today
            </h2>
            <p className="text-sm text-muted">{greetingFor(props.now ?? new Date(), firstName)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-[var(--touch-target)] min-w-[var(--touch-target)] rounded-md border border-border font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {firstOpen ? (
            <HomeyFirstOpen face={face} onShow={props.onFirstOpenShow ?? (() => {})} onDismiss={props.onFirstOpenDismiss ?? onClose} />
          ) : (
            <>
              {digest ? (
                <div className="mb-4 rounded-2xl rounded-tl-sm border border-border bg-surface-muted p-3" data-testid="digest">
                  <p className="text-sm">{digest.summary}</p>
                  <p className="mt-2 flex flex-wrap items-center gap-x-1 text-xs text-muted">
                    <span>AI summary · {londonTime(digest.createdAt)} ·</span>
                    <button
                      type="button"
                      onClick={onRefresh}
                      className="min-h-[var(--touch-target)] font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {digest.stale ? "List changed: refresh" : "Refresh"}
                    </button>
                  </p>
                </div>
              ) : null}
              {partial ? (
                <p role="status" className="mb-4 rounded-md border border-warning-border bg-warning-bg p-2 text-sm text-warning-fg">
                  Some information could not be loaded, so this list may be incomplete.
                </p>
              ) : null}
              {items.length === 0 ? (
                <p className="py-6 text-center text-sm font-medium">Nothing pressing today. Nice one!</p>
              ) : (
                <NeedList
                  items={items}
                  otherName={otherName}
                  onPropose={props.onPropose}
                  onConfirm={props.onConfirm}
                  onReject={props.onReject}
                  onDraftThanks={props.onDraftThanks}
                  onSendThanks={props.onSendThanks}
                />
              )}
            </>
          )}
        </div>

        <p className="shrink-0 border-t border-border px-4 py-2 text-sm text-muted">
          {gbp(spend.used)} of {gbp(spend.cap)} used ·{" "}
          <a href="/assistant" className="inline-flex min-h-[var(--touch-target)] items-center font-medium underline">
            Open chat ›
          </a>
        </p>
      </div>
    </div>
  );
}
