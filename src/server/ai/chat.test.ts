import { describe, expect, it, vi } from "vitest";
import type { HouseholdSession } from "@/server/auth/session";

const stored = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("@/server/db/supabase", () => ({
  createUserClient: async () => ({
    from: () => ({
      insert: (v: unknown[]) => {
        stored.items.push(...v);
        const ids = v.map((_, i) => ({ id: `a1a10000-0000-4000-8000-00000000000${i + 1}` }));
        return Object.assign(Promise.resolve({ error: null }), { select: async () => ({ data: ids, error: null }) });
      },
    }),
  }),
}));
vi.mock("@/server/data/tasks", () => ({ createTask: vi.fn() }));
vi.mock("@/server/data/snags", () => ({ createSnag: vi.fn() }));
vi.mock("@/server/data/records", () => ({ listRecords: vi.fn() }));

import { chatTurn } from "./chat";
import type { AiDeps } from "./client";

const S = { userId: "u", householdId: "11111111-1111-4111-8111-111111111111" } as unknown as HouseholdSession;

describe("chatTurn", () => {
  it("stores tool calls as pending proposals, drops invalid ones, and sends only the allowed tools", async () => {
    const body = {
      content: [
        { type: "text", text: "Sure." },
        { type: "tool_use", id: "a", name: "propose_task", input: { title: "Book boiler service" } },
        { type: "tool_use", id: "b", name: "send_email", input: { to: "x" } },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body)));
    const deps: AiDeps = {
      fetch: fetchMock as never, apiKey: "k", capGbp: 5,
      getSpentPence: async () => 0, recordUsage: async () => true,
    };
    const r = await chatTurn(S, deps, [{ role: "user", content: "hi" }], "2026-10-21", async () => "SUMMARY");
    expect(r).toEqual({ ok: true, reply: "Sure.", proposed: 1 });
    expect(stored.items).toEqual([
      { household_id: S.householdId, created_by: "u", kind: "create_task", payload: { title: "Book boiler service" } },
    ]);
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.tools.map((t: { name: string }) => t.name)).toEqual(["propose_task", "propose_snag", "propose_shopping_item"]);
    expect(sent.system).toContain("SUMMARY");
  });
});
