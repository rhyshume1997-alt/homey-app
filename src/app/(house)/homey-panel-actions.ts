"use server";

import { requireSession } from "@/server/auth/session";
import { getServerEnv } from "@/server/env";
import { todayInLondon } from "@/server/data/dashboard";
import { getNeedsDoing, getNeedsEntries } from "@/server/homey/needs-doing";
import { importCheckItem } from "@/server/homey/import-check";
import { otherMember, otherMemberActivity } from "@/server/homey/activity";
import { getOrCreateDigest } from "@/server/ai/digest";
import { getMonthSpendPence } from "@/server/ai/usage";
import { listPendingProposals, storeProposals } from "@/server/ai/proposals";
import { PAYLOAD_SCHEMAS, describeProposal, type AiProposal } from "@/server/ai/schemas";
import type { HomeyDigest, NeedItem } from "@/components/homey/types";

export type HomeyPanelData = {
  items: NeedItem[];
  partial: boolean;
  proposals: AiProposal[];
  spend: { spentPence: number | null; capGbp: number };
};

export type ProposeFromItemResult =
  | { ok: true; proposalId: string; text: string }
  | { ok: false; error: string };

const KEY_RE = /^[a-z]{3,10}(:[0-9A-Za-z-]{1,40})?$/;
const FAIL = "Something went wrong. Please try again.";

/**
 * Everything the Homey panel shows. Read-only: nothing is written. The email-import check is
 * optional: it is capped at a short timeout and any failure simply leaves it out.
 */
export async function loadHomeyPanelAction(): Promise<HomeyPanelData> {
  const s = await requireSession();
  const [needs, proposals, spent, activity, importItem] = await Promise.all([
    getNeedsEntries(s, todayInLondon()),
    listPendingProposals(s),
    getMonthSpendPence(s),
    otherMemberActivity(s, new Date()).then(
      (items) => ({ items, ok: true }),
      () => ({ items: [] as NeedItem[], ok: false }),
    ),
    importCheckItem(s).catch(() => null),
  ]);
  return {
    items: [...activity.items, ...needs.entries.map((e) => e.item), ...(importItem ? [importItem] : [])],
    partial: needs.partial || !activity.ok,
    proposals,
    spend: { spentPence: spent, capGbp: getServerEnv().AI_MONTHLY_CAP_GBP },
  };
}

/**
 * Turns one "what needs doing" item into a PENDING proposal. The browser sends only the key: the
 * items are recomputed here and the payload is built from server data, so nothing else the client
 * sends can reach it. Household data is untouched until confirmProposalAction runs.
 */
export async function proposeFromItemAction(key: unknown): Promise<ProposeFromItemResult> {
  const s = await requireSession();
  if (typeof key !== "string" || !KEY_RE.test(key)) return { ok: false, error: "That item is no longer available." };
  const { entries } = await getNeedsEntries(s, todayInLondon());
  const entry = entries.find((e) => e.item.key === key);
  if (!entry || !entry.proposal) return { ok: false, error: "That item is no longer available." };

  const { kind, payload } = entry.proposal;
  const valid = PAYLOAD_SCHEMAS[kind].safeParse(payload);
  if (!valid.success) return { ok: false, error: FAIL };
  const clean = valid.data as Record<string, unknown>;
  const same = (p: AiProposal) => p.kind === kind && JSON.stringify(p.payload) === JSON.stringify(clean);

  // Pressing the button twice must not queue duplicates: reuse a matching pending proposal.
  const existing = (await listPendingProposals(s)).find(same);
  if (existing) return { ok: true, proposalId: existing.id, text: describeProposal(existing) };
  const stored = await storeProposals(s, [{ kind, payload: clean }]);
  const proposalId = stored.count === 1 ? stored.ids[0] : undefined;
  if (!proposalId) return { ok: false, error: FAIL };
  return { ok: true, proposalId, text: describeProposal({ kind, payload: clean }) };
}

/**
 * Homey's AI summary for the signed-in member. Built server-side from the recomputed list; the
 * browser chooses only whether to force a refresh. Null when the assistant is off, capped or failed.
 */
export async function loadHomeyDigestAction(force: unknown): Promise<HomeyDigest | null> {
  const s = await requireSession();
  const today = todayInLondon();
  const [{ items }, other] = await Promise.all([getNeedsDoing(s, today), otherMember(s).catch(() => null)]);
  return getOrCreateDigest(s, items, today, {
    firstName: s.displayName.trim().split(/\s+/)[0] ?? s.displayName,
    otherFirstName: other ? (other.name.trim().split(/\s+/)[0] ?? null) : null,
    trigger: force === true ? "refresh" : "first_open",
    force: force === true,
  }).catch(() => null);
}
