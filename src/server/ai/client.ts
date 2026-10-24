import "server-only";
import { z } from "zod";
import { getServerEnv } from "@/server/env";

/** Models (D18): Claude Haiku 5.5 for Homey, recommendations and the chat, to keep costs low. */
export const MODELS = { recommendations: "claude-haiku-5-5", chat: "claude-haiku-5-5" } as const;
/** Every model the spend ledger can price. Sonnet stays priced so older usage rows still make sense. */
export type ModelId = (typeof MODELS)[keyof typeof MODELS] | "claude-sonnet-5-5";

/**
 * Prices in PENCE per MILLION tokens (input, output). Deliberately rounded UP so the
 * cap errs on the safe side: at the time of writing Haiku 5.5 lists at about $0.10 / $0.50
 * per MTok up to 100K-token prompts ($0.50 / $2.50 above) and Sonnet 5.5 at $2 / $10,
 * so these figures sit well above both, even with an unfavourable exchange rate.
 * TODO(household owner): confirm against https://www.anthropic.com/pricing and lower if wanted.
 */
export const PRICES_PENCE_PER_MTOK: Record<ModelId, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 100, output: 500 },
  "claude-sonnet-5-5": { input: 300, output: 1500 },
};

export const MAX_TOKENS_CAP = 2048;
/** Haiku 5.5 thinks by default and thinking counts toward max_tokens, so chat gets the full cap. */
export const MAX_TOKENS = { recommendations: 512, chat: 2048, digest: 512 } as const;
export const REQUEST_TIMEOUT_MS = 30_000;
export const API_URL = "https://api.anthropic.com/v1/messages";
export const API_VERSION = "2023-06-01";

export const MSG = {
  off: "The assistant is off. No API key is set.",
  cap: "The assistant has reached this month's spend limit, so it is paused until next month.",
  unavailable: "The assistant is not available right now. Please try again later.",
} as const;

export function costPence(model: ModelId, inputTokens: number, outputTokens: number): number {
  const p = PRICES_PENCE_PER_MTOK[model];
  const raw = (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
  return inputTokens + outputTokens > 0 ? Math.max(1, Math.ceil(raw)) : 0;
}

/** Worst-case cost of a call: ~1 token per 3 characters in, the full max_tokens out. */
export function estimateCallPence(model: ModelId, promptChars: number, maxTokens: number): number {
  return costPence(model, Math.ceil(promptChars / 3), maxTokens);
}

export const capPence = (capGbp: number) => Math.round(capGbp * 100);

export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };
export type ApiMessage = { role: "user" | "assistant"; content: string };
/** Passed through as tool_choice. A forced tool ("tool"/"any") is accepted by Haiku 5.5 but not by Sonnet/Opus 5.5. */
export type ToolChoice = { type: "auto" } | { type: "any" } | { type: "tool"; name: string };

export type ClaudeRequest = {
  model: ModelId;
  system: string;
  messages: ApiMessage[];
  tools?: ToolDef[];
  toolChoice?: ToolChoice;
  maxTokens: number;
};

export type ToolUse = { id: string; name: string; input: unknown };
export type ClaudeReply = { text: string; toolUses: ToolUse[]; inputTokens: number; outputTokens: number; costPence: number };
export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type AiDeps = {
  fetch: typeof fetch;
  apiKey: string | undefined;
  capGbp: number;
  /** Household spend this month in pence, or null if it cannot be read (then we refuse). */
  getSpentPence: () => Promise<number | null>;
  recordUsage: (u: { model: ModelId; inputTokens: number; outputTokens: number; costPence: number }) => Promise<boolean>;
};

const ResponseSchema = z.object({
  content: z.array(
    z.union([
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() }),
      z.object({ type: z.string() }).passthrough(),
    ]),
  ),
  usage: z.object({ input_tokens: z.number().int().min(0), output_tokens: z.number().int().min(0) }),
});

/**
 * The only place that talks to Anthropic. Checks the monthly cap BEFORE the call
 * (spent + worst-case cost of this call must fit) and records usage after.
 */
export async function callClaude(deps: AiDeps, req: ClaudeRequest): Promise<AiResult<ClaudeReply>> {
  if (!deps.apiKey) return { ok: false, error: MSG.off };
  const maxTokens = Math.min(Math.max(1, Math.floor(req.maxTokens)), MAX_TOKENS_CAP);

  const spent = await deps.getSpentPence();
  if (spent === null) return { ok: false, error: MSG.unavailable };
  const promptChars =
    req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0) + JSON.stringify(req.tools ?? []).length;
  if (spent + estimateCallPence(req.model, promptChars, maxTokens) > capPence(deps.capGbp)) {
    return { ok: false, error: MSG.cap };
  }

  let res: Response;
  try {
    res = await deps.fetch(API_URL, {
      method: "POST",
      headers: { "x-api-key": deps.apiKey, "anthropic-version": API_VERSION, "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        max_tokens: maxTokens,
        system: req.system,
        messages: req.messages,
        ...(req.tools?.length ? { tools: req.tools } : {}),
        ...(req.tools?.length && req.toolChoice ? { tool_choice: req.toolChoice } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: MSG.unavailable };
  }
  if (!res.ok) return { ok: false, error: MSG.unavailable };
  const parsed = ResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { ok: false, error: MSG.unavailable };

  const { input_tokens, output_tokens } = parsed.data.usage;
  const cost = costPence(req.model, input_tokens, output_tokens);
  await deps.recordUsage({ model: req.model, inputTokens: input_tokens, outputTokens: output_tokens, costPence: cost });

  let text = "";
  const toolUses: ToolUse[] = [];
  for (const b of parsed.data.content) {
    if (b.type === "text" && "text" in b && typeof b.text === "string") text += b.text;
    else if (b.type === "tool_use" && "name" in b && "id" in b)
      toolUses.push({ id: String(b.id), name: String(b.name), input: "input" in b ? b.input : {} });
  }
  return { ok: true, data: { text: text.trim(), toolUses, inputTokens: input_tokens, outputTokens: output_tokens, costPence: cost } };
}

export function aiEnabled(): boolean {
  return Boolean(getServerEnv().ANTHROPIC_API_KEY);
}
