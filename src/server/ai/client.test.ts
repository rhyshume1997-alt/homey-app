import { describe, expect, it, vi } from "vitest";
import { callClaude, costPence, estimateCallPence, MODELS, MSG, PRICES_PENCE_PER_MTOK, type AiDeps } from "./client";

const okBody = {
  content: [
    { type: "text", text: "Hello" },
    { type: "tool_use", id: "t1", name: "propose_task", input: { title: "Bleed radiators" } },
  ],
  usage: { input_tokens: 1000, output_tokens: 200 },
};

function deps(over: Partial<AiDeps> = {}): AiDeps & { fetch: ReturnType<typeof vi.fn>; recordUsage: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 })),
    apiKey: "sk-test",
    capGbp: 5,
    getSpentPence: vi.fn(async () => 0),
    recordUsage: vi.fn(async () => true),
    ...over,
  } as never;
}

const req = { model: MODELS.chat, system: "sys", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 1024 };

describe("callClaude", () => {
  it("refuses with no key and never calls fetch", async () => {
    const d = deps({ apiKey: undefined });
    const r = await callClaude(d, req);
    expect(r).toEqual({ ok: false, error: MSG.off });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("blocks BEFORE the call when the cap would be exceeded", async () => {
    const d = deps({ getSpentPence: async () => 500 }); // at the £5 cap: any real call (min 1p) would exceed it
    const r = await callClaude(d, req);
    expect(r).toEqual({ ok: false, error: MSG.cap });
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.recordUsage).not.toHaveBeenCalled();
  });

  it("refuses when spend cannot be read (fail closed)", async () => {
    const d = deps({ getSpentPence: async () => null });
    expect((await callClaude(d, req)).ok).toBe(false);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("calls the Messages API with the right headers and bounded max_tokens, then records usage", async () => {
    const d = deps();
    const r = await callClaude(d, { ...req, maxTokens: 999999 });
    expect(r.ok).toBe(true);
    const [url, init] = d.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "sk-test", "anthropic-version": "2023-06-01" });
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 2048 });
    expect(sent).not.toHaveProperty("tool_choice");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(d.recordUsage).toHaveBeenCalledWith({
      model: MODELS.chat,
      inputTokens: 1000,
      outputTokens: 200,
      costPence: costPence(MODELS.chat, 1000, 200),
    });
    if (r.ok) {
      expect(r.data.text).toBe("Hello");
      expect(r.data.toolUses).toEqual([{ id: "t1", name: "propose_task", input: { title: "Bleed radiators" } }]);
    }
  });

  it("returns a generic error on HTTP failure and records nothing", async () => {
    const d = deps({ fetch: vi.fn(async () => new Response("secret detail", { status: 500 })) as never });
    const r = await callClaude(d, req);
    expect(r).toEqual({ ok: false, error: MSG.unavailable });
    expect(d.recordUsage).not.toHaveBeenCalled();
  });

  it("returns a generic error on network failure or timeout", async () => {
    const d = deps({ fetch: vi.fn(async () => { throw new Error("timeout sk-test"); }) as never });
    const r = await callClaude(d, req);
    expect(r).toEqual({ ok: false, error: MSG.unavailable });
  });
});

describe("models and tool_choice", () => {
  it("uses Haiku 5.5 for chat and recommendations (D18)", () => {
    expect(MODELS).toEqual({ recommendations: "claude-haiku-5-5", chat: "claude-haiku-5-5" });
  });

  it("passes tool_choice through only when tools are sent", async () => {
    const tool = { name: "submit_digest", description: "d", input_schema: { type: "object" } };
    const d = deps();
    await callClaude(d, { ...req, tools: [tool], toolChoice: { type: "tool", name: "submit_digest" } });
    const body = JSON.parse((d.fetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit_digest" });
    expect(body.tools).toEqual([tool]);

    const e = deps();
    await callClaude(e, { ...req, toolChoice: { type: "any" } });
    expect(JSON.parse((e.fetch.mock.calls[0] as [string, RequestInit])[1].body as string)).not.toHaveProperty("tool_choice");
  });
});

describe("pricing", () => {
  it("is never below Anthropic's list price (Haiku 5.5 about $0.50/$2.50 per MTok at worst, Sonnet 5.5 $2/$10)", () => {
    // 1 USD is assumed to be at most 100p: the table must still cover it.
    expect(PRICES_PENCE_PER_MTOK["claude-haiku-5-5"].input).toBeGreaterThanOrEqual(50);
    expect(PRICES_PENCE_PER_MTOK["claude-haiku-5-5"].output).toBeGreaterThanOrEqual(250);
    expect(PRICES_PENCE_PER_MTOK["claude-sonnet-5-5"].input).toBeGreaterThanOrEqual(200);
    expect(PRICES_PENCE_PER_MTOK["claude-sonnet-5-5"].output).toBeGreaterThanOrEqual(1000);
  });

  it("rounds up and is never below 1p for a real call", () => {
    expect(costPence(MODELS.recommendations, 10, 10)).toBe(1);
    expect(costPence(MODELS.chat, 0, 0)).toBe(0);
    expect(costPence(MODELS.chat, 1_000_000, 0)).toBe(100);
    expect(costPence("claude-sonnet-5-5", 1_000_000, 0)).toBe(300);
  });
  it("estimates worst case including full max_tokens", () => {
    expect(estimateCallPence(MODELS.chat, 3000, 1000)).toBeGreaterThanOrEqual(costPence(MODELS.chat, 1000, 1000));
  });
});
