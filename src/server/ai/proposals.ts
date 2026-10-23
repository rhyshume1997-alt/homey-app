import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import type { HouseholdSession } from "@/server/auth/session";
import { TaskInputSchema } from "@/contracts/tasks";
import { SnagInputSchema } from "@/contracts/snags";
import { createTask } from "@/server/data/tasks";
import { createSnag } from "@/server/data/snags";
import {
  PAYLOAD_SCHEMAS, PROPOSAL_KINDS, TOOL_TO_KIND, type AiProposal, type ProposalKind,
} from "./schemas";
import type { ToolDef, ToolUse } from "./client";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  failed: "Something went wrong. Please try again.",
  invalid: "That suggestion is not valid, so it was not applied.",
  decided: "That suggestion has already been dealt with.",
  noShopping: "The shopping list is not set up yet, so this suggestion was rejected.",
} as const;

/** The assistant's ONLY tools. Each one stores a pending proposal; none changes household data. */
export const TOOLS: ToolDef[] = [
  {
    name: "propose_task",
    description: "Propose adding a household task. A person must confirm before it is created.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 200 },
        due_date: { type: "string", description: "Optional due date, YYYY-MM-DD" },
      },
      required: ["title"],
    },
  },
  {
    name: "propose_snag",
    description: "Propose adding a snag (a defect to fix). A person must confirm before it is created.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 200 },
        location: { type: "string", maxLength: 100 },
        priority: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["title"],
    },
  },
  {
    name: "propose_shopping_item",
    description: "Propose adding an item to the shopping list. A person must confirm before it is added.",
    input_schema: { type: "object", properties: { title: { type: "string", maxLength: 200 } }, required: ["title"] },
  },
];

/** Maps a Claude tool call to a validated proposal. Unknown tools or invalid input give null. */
export function toolUseToProposal(t: ToolUse): { kind: ProposalKind; payload: Record<string, unknown> } | null {
  if (!Object.hasOwn(TOOL_TO_KIND, t.name)) return null;
  const kind = TOOL_TO_KIND[t.name as keyof typeof TOOL_TO_KIND];
  const parsed = PAYLOAD_SCHEMAS[kind].safeParse(t.input);
  if (!parsed.success) return null;
  // Drop null/undefined so the stored payload stays minimal.
  const payload = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v != null));
  return { kind, payload };
}

const RowSchema = z.object({
  id: z.uuid(),
  kind: z.enum(PROPOSAL_KINDS),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "confirmed", "rejected"]),
  created_at: z.string(),
});

/** How many proposals were stored, and their new ids (empty when the ids could not be read back). */
export type StoredProposals = { count: number; ids: string[] };

const NONE_STORED: StoredProposals = { count: 0, ids: [] };
const InsertedIds = z.array(z.object({ id: z.uuid() }));

export async function storeProposals(
  s: HouseholdSession,
  items: { kind: ProposalKind; payload: Record<string, unknown> }[],
): Promise<StoredProposals> {
  if (!items.length) return NONE_STORED;
  const db = await createUserClient();
  if (!db) return NONE_STORED;
  const { data, error } = await db
    .from("ai_proposals")
    .insert(items.map((i) => ({ household_id: s.householdId, created_by: s.userId, kind: i.kind, payload: i.payload })))
    .select("id");
  if (error) return NONE_STORED;
  const ids = InsertedIds.safeParse(data);
  return { count: items.length, ids: ids.success && ids.data.length === items.length ? ids.data.map((r) => r.id) : [] };
}

export async function listPendingProposals(s: HouseholdSession): Promise<AiProposal[]> {
  const db = await createUserClient();
  if (!db) return [];
  const { data } = await db
    .from("ai_proposals")
    .select("id, kind, payload, status, created_at")
    .eq("household_id", s.householdId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = z.array(RowSchema).safeParse(data ?? []);
  return rows.success ? rows.data : [];
}

async function setStatus(s: HouseholdSession, id: string, status: "confirmed" | "rejected"): Promise<boolean> {
  const db = await createUserClient();
  if (!db) return false;
  const { data, error } = await db
    .from("ai_proposals")
    .update({ status })
    .eq("id", id)
    .eq("household_id", s.householdId)
    .eq("status", "pending")
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

export async function rejectProposal(s: HouseholdSession, id: string): Promise<Result> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: MSG.invalid };
  return (await setStatus(s, id, "rejected")) ? { ok: true, data: undefined } : { ok: false, error: MSG.decided };
}

async function shoppingTableExists(): Promise<boolean> {
  const db = await createUserClient();
  if (!db) return false;
  const { error } = await db.from("shopping_items").select("id").limit(1);
  return !error;
}

/**
 * Executes a confirmed proposal through the normal data functions with the same zod
 * validation as the forms. Validation happens BEFORE the proposal is claimed.
 */
export async function confirmProposal(s: HouseholdSession, id: string): Promise<Result<{ message: string }>> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: MSG.invalid };
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { data } = await db
    .from("ai_proposals")
    .select("id, kind, payload, status, created_at")
    .eq("id", id)
    .eq("household_id", s.householdId)
    .maybeSingle();
  const row = RowSchema.safeParse(data);
  if (!row.success) return { ok: false, error: MSG.failed };
  if (row.data.status !== "pending") return { ok: false, error: MSG.decided };

  const { kind } = row.data;
  const payload = PAYLOAD_SCHEMAS[kind].safeParse(row.data.payload);
  if (!payload.success) return { ok: false, error: MSG.invalid };

  let run: () => Promise<Result>;
  let message: string;
  if (kind === "create_task") {
    const p = payload.data as z.infer<typeof PAYLOAD_SCHEMAS.create_task>;
    const input = TaskInputSchema.safeParse({ title: p.title, due_date: p.due_date ?? null, notes: null, assignee_user_id: null });
    if (!input.success) return { ok: false, error: MSG.invalid };
    run = () => createTask(s, input.data);
    message = "Task added.";
  } else if (kind === "create_snag") {
    const p = payload.data as z.infer<typeof PAYLOAD_SCHEMAS.create_snag>;
    const input = SnagInputSchema.safeParse({
      title: p.title, location: p.location ?? null, priority: p.priority ?? "medium", status: "open", notes: null,
    });
    if (!input.success) return { ok: false, error: MSG.invalid };
    run = () => createSnag(s, input.data);
    message = "Snag added.";
  } else if (kind === "add_shopping_item") {
    if (!(await shoppingTableExists())) {
      await setStatus(s, id, "rejected");
      return { ok: false, error: MSG.noShopping };
    }
    const p = payload.data as z.infer<typeof PAYLOAD_SCHEMAS.add_shopping_item>;
    run = async () => {
      const { error } = await db.from("shopping_items").insert({ household_id: s.householdId, title: p.title, created_by: s.userId });
      return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
    };
    message = "Added to the shopping list.";
  } else {
    run = async () => ({ ok: true, data: undefined });
    message = "Noted.";
  }

  if (!(await setStatus(s, id, "confirmed"))) return { ok: false, error: MSG.decided };
  const r = await run();
  if (!r.ok) return { ok: false, error: "It was confirmed but could not be applied. Please add it by hand." };
  return { ok: true, data: { message } };
}
