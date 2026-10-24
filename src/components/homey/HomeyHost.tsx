"use client";

import { useCallback, useEffect, useState } from "react";
import { HomeyLauncher } from "./HomeyLauncher";
import { HomeyPanel } from "./HomeyPanel";
import { HomeyFace } from "./HomeyFace";
import type { HomeySuggestion } from "./HomeyBubble";
import type { Expression, FaceMoment, HomeyDigest, HomeyPrefs, NeedItem } from "./types";
import type { NeedListHandlers } from "./NeedList";
import { loadHomeyDigestAction, loadHomeyPanelAction, proposeFromItemAction } from "@/app/(house)/homey-panel-actions";
import { confirmProposalAction, rejectProposalAction } from "@/app/(house)/assistant/actions";
import { draftThanksAction, sendThanksAction } from "@/app/(house)/kudos-actions";

export type HomeyExtras = {
  /** AI summary loader; null result means show the deterministic list only. */
  loadDigest?: (opts: { force: boolean }) => Promise<HomeyDigest | null>;
  draftThanks?: NeedListHandlers["onDraftThanks"];
  sendThanks?: NeedListHandlers["onSendThanks"];
};

type Props = HomeyExtras & {
  userId: string;
  firstName: string;
  otherName: string;
  count: number;
  expression: Expression;
  suggestions: HomeySuggestion[];
  prefs: HomeyPrefs;
};

const SEEN_KEY = (userId: string) => `homey:seen:${userId}`;

function readSeen(userId: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY(userId)) === "1";
  } catch {
    return true; // storage blocked: never nag with the first-open screen
  }
}

function markSeen(userId: string) {
  try {
    window.localStorage.setItem(SEEN_KEY(userId), "1");
  } catch {
    /* storage blocked */
  }
}

const face = (expression: Expression, size: number, glance?: "left" | "right" | null, moment?: FaceMoment) => (
  <HomeyFace expression={expression} size={size} glance={glance ?? undefined} talking={moment?.talking} greet={moment?.greet} />
);

/** Client host: floating Homey on every house page, and his panel when tapped. */
export function HomeyHost(props: Props) {
  const { userId, draftThanks, sendThanks } = props;
  const loadDigest = props.loadDigest ?? ((o: { force: boolean }) => loadHomeyDigestAction(o.force));
  const [open, setOpen] = useState(false);
  const [firstOpen, setFirstOpen] = useState(false);
  const [items, setItems] = useState<NeedItem[]>([]);
  const [partial, setPartial] = useState(false);
  const [spend, setSpend] = useState({ used: 0, cap: 5 });
  const [digest, setDigest] = useState<HomeyDigest | null>(null);
  const [thinking, setThinking] = useState(false);

  const refreshDigest = useCallback(
    async (force: boolean) => {
      if (!loadDigest) return;
      setThinking(true);
      try {
        setDigest(await loadDigest({ force }));
      } catch {
        setDigest(null);
      } finally {
        setThinking(false);
      }
    },
    [loadDigest],
  );

  const load = useCallback(async () => {
    try {
      const data = await loadHomeyPanelAction();
      setItems(data.items);
      setPartial(data.partial);
      setSpend({ used: (data.spend.spentPence ?? 0) / 100, cap: data.spend.capGbp });
    } catch {
      setPartial(true);
    }
    void refreshDigest(false);
  }, [refreshDigest]);

  const openPanel = useCallback(() => {
    setFirstOpen(!readSeen(userId));
    setOpen(true);
    void load();
  }, [load, userId]);

  // The Home card's "Open what needs doing" works even when Homey is hidden.
  useEffect(() => {
    const onOpen = () => openPanel();
    window.addEventListener("homey:open", onOpen);
    return () => window.removeEventListener("homey:open", onOpen);
  }, [openPanel]);

  // Tell the launcher (and anything else) a dialog is open.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("homey:avoid", { detail: { open } }));
  }, [open]);

  const handlers: NeedListHandlers = {
    onPropose: async (key) => {
      const r = await proposeFromItemAction(key);
      return r.ok ? { proposalId: r.proposalId, text: r.text } : { error: r.error };
    },
    onConfirm: async (id) => {
      const r = await confirmProposalAction(id);
      if (r.ok) void load();
      return r.ok ? { ok: true } : { error: r.message };
    },
    onReject: async (id) => {
      const r = await rejectProposalAction(id);
      return r.ok ? { ok: true } : { error: r.message };
    },
    onDraftThanks:
      draftThanks ??
      (async (key) => {
        const r = await draftThanksAction(key);
        return r.ok && r.draft ? { draft: r.draft } : { error: r.ok ? "Couldn't draft that." : r.message };
      }),
    onSendThanks:
      sendThanks ??
      (async (key, message) => {
        const r = await sendThanksAction(key, message);
        if (r.ok) void load();
        return r.ok ? { ok: true } : { error: r.message };
      }),
  };

  return (
    <>
      <HomeyLauncher
        count={props.count}
        expression={props.expression}
        suggestions={props.suggestions}
        prefs={props.prefs}
        onOpen={openPanel}
        face={face}
        storageScope={userId}
      />
      <HomeyPanel
        {...handlers}
        open={open}
        onClose={() => setOpen(false)}
        firstName={props.firstName}
        otherName={props.otherName}
        items={items}
        digest={digest}
        partial={partial}
        spend={spend}
        face={(e, s, m) => face(e, s, null, m)}
        thinking={thinking}
        onRefresh={() => void refreshDigest(true)}
        firstOpen={firstOpen}
        onFirstOpenShow={() => {
          markSeen(userId);
          setFirstOpen(false);
        }}
        onFirstOpenDismiss={() => {
          markSeen(userId);
          setFirstOpen(false);
          setOpen(false);
        }}
      />
    </>
  );
}
