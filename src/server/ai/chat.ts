import "server-only";
import type { HouseholdSession } from "@/server/auth/session";
import { callClaude, MAX_TOKENS, MODELS, type AiDeps } from "./client";
import { loadContext, SYSTEM_PROMPT } from "./context";
import { TOOLS, storeProposals, toolUseToProposal } from "./proposals";
import type { ChatMessage } from "./schemas";

export type ChatResult = { ok: true; reply: string; proposed: number } | { ok: false; error: string };

/**
 * One chat turn. The model may call propose_* tools; each valid call is stored as a pending
 * proposal. Nothing is executed here and no tool result is sent back (single round trip).
 */
export async function chatTurn(
  s: HouseholdSession,
  deps: AiDeps,
  messages: ChatMessage[],
  today: string,
  loadCtx: (today: string) => Promise<string> = loadContext,
): Promise<ChatResult> {
  if (!deps.apiKey) return { ok: false, error: "The assistant is off. No API key is set." };
  const summary = await loadCtx(today);
  const r = await callClaude(deps, {
    model: MODELS.chat,
    system: `${SYSTEM_PROMPT}\n\nHousehold summary:\n${summary}`,
    messages,
    tools: TOOLS,
    maxTokens: MAX_TOKENS.chat,
  });
  if (!r.ok) return r;

  const items = r.data.toolUses.flatMap((t) => {
    const p = toolUseToProposal(t);
    return p ? [p] : [];
  });
  const { count: stored } = await storeProposals(s, items.slice(0, 5));
  const reply =
    r.data.text ||
    (stored > 0 ? "I have made a suggestion below. Nothing changes until you confirm it." : "I do not have anything to add.");
  return { ok: true, reply, proposed: stored };
}
