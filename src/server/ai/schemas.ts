import { z } from "zod";
import { SNAG_LIMITS, SnagPrioritySchema } from "@/contracts/snags";
import { TASK_LIMITS } from "@/contracts/tasks";

/** Pure schemas (no server-only) so client components can share the types. */
export const PROPOSAL_KINDS = ["create_task", "create_snag", "add_shopping_item", "note"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

const title = z.string().trim().min(1).max(TASK_LIMITS.title);

export const TaskPayloadSchema = z.object({ title, due_date: z.iso.date().nullish() }).strict();
export const SnagPayloadSchema = z
  .object({
    title: z.string().trim().min(1).max(SNAG_LIMITS.title),
    location: z.string().trim().max(SNAG_LIMITS.location).nullish(),
    priority: SnagPrioritySchema.nullish(),
  })
  .strict();
export const ShoppingPayloadSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();
export const NotePayloadSchema = z.object({ text: z.string().trim().min(1).max(1000) }).strict();

export const PAYLOAD_SCHEMAS = {
  create_task: TaskPayloadSchema,
  create_snag: SnagPayloadSchema,
  add_shopping_item: ShoppingPayloadSchema,
  note: NotePayloadSchema,
} as const;

/** Claude tool name -> proposal kind. These are the ONLY tools the assistant has. */
export const TOOL_TO_KIND = {
  propose_task: "create_task",
  propose_snag: "create_snag",
  propose_shopping_item: "add_shopping_item",
} as const satisfies Record<string, ProposalKind>;

export type AiProposal = {
  id: string;
  kind: ProposalKind;
  payload: Record<string, unknown>;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
};

export const ChatMessagesSchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }))
  .min(1)
  .max(20)
  .refine((m) => m[m.length - 1].role === "user", "last message must be from the user");
export type ChatMessage = z.infer<typeof ChatMessagesSchema>[number];

export { describeProposal } from "@/components/assistant/describe";
