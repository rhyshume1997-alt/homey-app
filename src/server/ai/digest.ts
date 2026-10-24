import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { HomeyDigest, NeedBucket, NeedItem } from "@/components/homey/types";
import type { HouseholdSession } from "@/server/auth/session";
import { isPrimaryHousehold } from "@/server/env";
import { createUserClient } from "@/server/db/supabase";
import { callClaude, MAX_TOKENS, MODELS, type AiDeps, type ToolDef } from "./client";
import { clean, DIGEST_PROMPT } from "./context";
import { defaultDeps } from "./usage";

/**
 * Homey's AI summary (D18). Cached per member per day and per input: the same list on the same
 * day never calls the API twice. Only refs, kinds, buckets, short cleaned titles, dates and day
 * counts are sent: no amounts, providers, notes, references or email content.
 */

export const DIGEST_LIMITS = { items: 25, itemText: 60, summary: 280, why: 120, top: 5, perHouseholdPerDay: 4 } as const;
export type DigestTrigger = "sign_in" | "first_open" | "refresh";
export type DigestOptions = { firstName: string; otherFirstName?: string | null; trigger: DigestTrigger; force?: boolean };

export const DIGEST_TOOL: ToolDef = {
  name: "submit_digest",
  description: "Submit Homey's short summary and up to 5 items to look at first, by ref.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", maxLength: DIGEST_LIMITS.summary, description: "At most 2 short sentences, UK English." },
      top: {
        type: "array",
        maxItems: DIGEST_LIMITS.top,
        items: {
          type: "object",
          properties: {
            ref: { type: "string", description: "An item ref from the list, e.g. k1" },
            why: { type: "string", maxLength: DIGEST_LIMITS.why },
          },
          required: ["ref", "why"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "top"],
    additionalProperties: false,
  },
};

const BUCKET_ORDER: Record<NeedBucket, number> = { overdue: 0, today: 1, soon: 2, check: 3, activity: 4 };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WORD = /^[a-z_]{1,20}$/;
const TAGS = /<[^>]*>?/g;
/** £45, $1,200.50, 45.00 GBP, 30p: money never goes to the model or back to the page. */
const MONEY = /(?:[£$€]\s?\d[\d,]*(?:\.\d+)?)|(?:\b\d[\d,]*(?:\.\d+)?\s?(?:GBP|EUR|USD|pence|p)\b)/gi;

/** Plain, short, identifier-free text: tags stripped, money and identifiers removed. */
export function scrub(v: string | null | undefined, max: number): string {
  return clean((v ?? "").replace(TAGS, " ").replace(MONEY, "[removed]"), max);
}

function dayDiff(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

function when(today: string, date: string): string {
  const d = dayDiff(today, date);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "1 day ago";
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

export type DigestInput = { refs: Map<string, string>; lines: string[]; hash: string };

/** The only item data sent to Anthropic, plus the cache key (sha256 of sorted keys and dates). */
export function buildDigestInput(items: NeedItem[], today: string): DigestInput {
  const picked = [...items]
    .sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] || (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.key.localeCompare(b.key))
    .slice(0, DIGEST_LIMITS.items);
  const refs = new Map<string, string>();
  const lines = picked.map((it, i) => {
    const ref = `k${i + 1}`;
    refs.set(ref, it.key);
    const kind = WORD.test(it.kind) ? it.kind : "item";
    const bucket = WORD.test(it.bucket) ? it.bucket : "check";
    const date = it.date && DATE.test(it.date.slice(0, 10)) ? it.date.slice(0, 10) : null;
    const text = scrub(it.text, DIGEST_LIMITS.itemText) || "(untitled)";
    return `[${ref}] ${kind}, ${bucket}: ${text}${date ? ` (${date}, ${when(today, date)})` : ""}`;
  });
  const keyed = picked.map((it) => `${it.key}|${it.date ?? ""}`).sort();
  const hash = createHash("sha256").update(JSON.stringify(keyed)).digest("hex");
  return { refs, lines, hash };
}

export function buildDigestMessage(input: DigestInput, today: string, firstName: string, otherFirstName?: string | null): string {
  const name = scrub(firstName, 40) || "there";
  const other = otherFirstName ? scrub(otherFirstName, 40) : "";
  return [
    `Member first name: ${name}`,
    ...(other ? [`Other member first name: ${other}`] : []),
    `Today: ${today}`,
    "",
    `Items (${input.lines.length}):`,
    ...(input.lines.length ? input.lines : ["- none"]),
  ].join("\n");
}

const BodySchema = z.object({
  summary: z.string().min(1).max(DIGEST_LIMITS.summary),
  top: z.array(z.object({ key: z.string().min(1).max(200), why: z.string().max(DIGEST_LIMITS.why) })).max(DIGEST_LIMITS.top),
});
type DigestBody = z.infer<typeof BodySchema>;

/** What the model may send back. Bounds are generous: the text is cleaned and clamped afterwards. */
const ToolInputSchema = z.object({
  summary: z.string().max(4000),
  top: z.array(z.object({ ref: z.string().max(20), why: z.string().max(2000) })).max(50),
});

export type DigestRow = { input_hash: string; body: unknown; created_at: string };
export type DigestStore = {
  /** This member's rows for the day, newest first. Null when they cannot be read. */
  listMine: (day: string) => Promise<DigestRow[] | null>;
  /** Rows the whole household generated that day. Null when it cannot be read. */
  countHousehold: (day: string) => Promise<number | null>;
  insert: (row: { day: string; input_hash: string; trigger: DigestTrigger; model: string; body: DigestBody }) => Promise<boolean>;
};
export type DigestDeps = { ai: AiDeps; store: DigestStore };

export function supabaseDigestStore(s: HouseholdSession): DigestStore {
  return {
    listMine: async (day) => {
      const db = await createUserClient();
      if (!db) return null;
      const { data, error } = await db
        .from("ai_digests")
        .select("input_hash, body, created_at")
        .eq("household_id", s.householdId)
        .eq("user_id", s.userId)
        .eq("day", day)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error || !data) return null;
      const rows = z.array(z.object({ input_hash: z.string(), body: z.unknown(), created_at: z.string() })).safeParse(data);
      return rows.success ? rows.data : null;
    },
    countHousehold: async (day) => {
      const db = await createUserClient();
      if (!db) return null;
      const { count, error } = await db
        .from("ai_digests")
        .select("id", { count: "exact", head: true })
        .eq("household_id", s.householdId)
        .eq("day", day);
      return error || count === null ? null : count;
    },
    insert: async (row) => {
      const db = await createUserClient();
      if (!db) return false;
      const { error } = await db.from("ai_digests").insert({ household_id: s.householdId, user_id: s.userId, ...row });
      return !error;
    },
  };
}

function fromRow(row: DigestRow, stale: boolean, liveKeys: Set<string>): HomeyDigest | null {
  const body = BodySchema.safeParse(row.body);
  if (!body.success) return null;
  return {
    summary: body.data.summary,
    // A stale digest may name items that are now done; never point the page at those.
    top: body.data.top.filter((t) => liveKeys.has(t.key)),
    createdAt: row.created_at,
    stale,
  };
}

/** Maps the tool call back to item keys. Unknown or repeated refs are dropped; all text is cleaned. */
export function parseDigestToolInput(input: unknown, refs: Map<string, string>): DigestBody | null {
  const parsed = ToolInputSchema.safeParse(input);
  if (!parsed.success) return null;
  const summary = scrub(parsed.data.summary, DIGEST_LIMITS.summary);
  if (!summary) return null;
  const seen = new Set<string>();
  const top: DigestBody["top"] = [];
  for (const t of parsed.data.top) {
    const key = refs.get(t.ref.trim());
    if (!key || seen.has(key)) continue;
    seen.add(key);
    top.push({ key, why: scrub(t.why, DIGEST_LIMITS.why) });
    if (top.length === DIGEST_LIMITS.top) break;
  }
  return { summary, top };
}

/**
 * Returns today's digest for this member, generating it only when needed:
 * - same input today: the cached digest, no API call;
 * - different input today: the newest cached digest marked stale, unless force;
 * - otherwise one Haiku call (forced submit_digest tool), within 4 generations per household per day.
 * Null when the assistant is off, the cap is reached with nothing cached, or anything fails.
 */
export async function getOrCreateDigest(
  session: HouseholdSession,
  items: NeedItem[],
  today: string,
  opts: DigestOptions,
  deps: DigestDeps = { ai: defaultDeps(session), store: supabaseDigestStore(session) },
): Promise<HomeyDigest | null> {
  try {
    if (!isPrimaryHousehold(session.householdId)) return null;
    if (!DATE.test(today)) return null;
    const input = buildDigestInput(items, today);
    const liveKeys = new Set(items.map((i) => i.key));

    const mine = await deps.store.listMine(today);
    if (mine === null) return null;
    const exact = mine.find((r) => r.input_hash === input.hash);
    if (exact) return fromRow(exact, false, liveKeys);
    const latest = mine.length ? fromRow(mine[0], true, liveKeys) : null;
    if (latest && !opts.force) return latest;

    if (!deps.ai.apiKey) return latest;
    const used = await deps.store.countHousehold(today);
    if (used === null) return latest;
    if (used >= DIGEST_LIMITS.perHouseholdPerDay) return latest;

    const r = await callClaude(deps.ai, {
      model: MODELS.recommendations,
      system: DIGEST_PROMPT,
      messages: [{ role: "user", content: buildDigestMessage(input, today, opts.firstName, opts.otherFirstName) }],
      tools: [DIGEST_TOOL],
      toolChoice: { type: "tool", name: DIGEST_TOOL.name },
      maxTokens: MAX_TOKENS.digest,
    });
    if (!r.ok) return latest;
    const call = r.data.toolUses.find((t) => t.name === DIGEST_TOOL.name);
    const body = call ? parseDigestToolInput(call.input, input.refs) : null;
    if (!body) return latest;

    // A failed insert (e.g. a race on the same input) still returns the fresh digest.
    await deps.store.insert({ day: today, input_hash: input.hash, trigger: opts.trigger, model: MODELS.recommendations, body });
    return { ...body, createdAt: new Date().toISOString(), stale: false };
  } catch {
    return null;
  }
}
