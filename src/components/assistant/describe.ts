import type { AiProposal } from "@/server/ai/schemas";

/** One-line summary of a proposal. No zod here: the client proposal list imports it. */
export function describeProposal(p: Pick<AiProposal, "kind" | "payload">): string {
  const t = (k: string) => (typeof p.payload[k] === "string" ? (p.payload[k] as string) : "");
  switch (p.kind) {
    case "create_task":
      return `Add task: ${t("title")}${t("due_date") ? ` (due ${t("due_date")})` : ""}`;
    case "create_snag":
      return `Add snag: ${t("title")}${t("location") ? ` in ${t("location")}` : ""}${t("priority") ? `, ${t("priority")} priority` : ""}`;
    case "add_shopping_item":
      return `Add to shopping list: ${t("title")}`;
    default:
      return `Note: ${t("text")}`;
  }
}
