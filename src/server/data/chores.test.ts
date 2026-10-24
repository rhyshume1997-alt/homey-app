import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/server/db/supabase", () => ({ createUserClient: async () => ({ rpc }) }));
const sendToSubscriptions = vi.fn();
let configured = true;
vi.mock("@/server/integrations/push/send", () => ({
  pushConfig: () => (configured ? { publicKey: "p", privateKey: "k", subject: "mailto:a@b.test" } : null),
  sendToSubscriptions: (...a: unknown[]) => sendToSubscriptions(...a),
}));

import { NUDGE_MSG, nudgeAssignee, nudgeError } from "./chores";

const T = "44444444-4444-4444-8444-444444444444";
const N = "55555555-5555-4555-8555-555555555555";
const R = "66666666-6666-4666-8666-666666666666";
const session = { userId: "77777777-7777-4777-8777-777777777777", displayName: "Alex", householdId: "88888888-8888-4888-8888-888888888888" } as never;
const ok = { data: [{ nudge_id: N, recipient_user_id: R, title: "Clean oven" }], error: null };
const target = { id: "s1", endpoint: "https://p.test/1", p256dh: "k", auth: "a" };

beforeEach(() => {
  rpc.mockReset();
  sendToSubscriptions.mockReset();
  configured = true;
});

describe("nudgeError", () => {
  it.each([
    ["task is not assigned", NUDGE_MSG.notAssigned],
    ["cannot nudge yourself", NUDGE_MSG.self],
    ["assignee is not an active member", NUDGE_MSG.inactive],
    ["task is closed", NUDGE_MSG.closed],
    ["task not found", NUDGE_MSG.notFound],
    ["rate limit reached", NUDGE_MSG.rate],
    ["boom", NUDGE_MSG.failed],
  ])("%s", (m, text) => expect(nudgeError(m)).toBe(text));
});

describe("nudgeAssignee", () => {
  it("rejects a bad id without touching the database", async () => {
    expect(await nudgeAssignee(session, "nope")).toEqual({ ok: false, error: NUDGE_MSG.invalid });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["not assigned", "task is not assigned", NUDGE_MSG.notAssigned],
    ["self", "cannot nudge yourself", NUDGE_MSG.self],
    ["removed member", "assignee is not an active member", NUDGE_MSG.inactive],
    ["other household / missing", "task not found", NUDGE_MSG.notFound],
    ["closed task", "task is closed", NUDGE_MSG.closed],
    ["per-task rate limit", "rate limit reached", NUDGE_MSG.rate],
    ["daily rate limit", "rate limit reached", NUDGE_MSG.rate],
  ])("refuses: %s, and sends no push", async (_n, message, error) => {
    rpc.mockResolvedValueOnce({ data: null, error: { message } });
    expect(await nudgeAssignee(session, T)).toEqual({ ok: false, error });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("nudge_task", { p_task: T });
    expect(sendToSubscriptions).not.toHaveBeenCalled();
  });

  it("pushes to the recipient's devices when configured", async () => {
    rpc.mockResolvedValueOnce(ok).mockResolvedValueOnce({ data: [target], error: null });
    sendToSubscriptions.mockResolvedValueOnce({ sent: 1, removed: 0, failed: 0 });
    expect(await nudgeAssignee(session, T)).toEqual({ ok: true, data: { pushed: 1 } });
    expect(sendToSubscriptions.mock.calls[0][2]).toMatchObject({ title: "Alex nudged you", body: "Clean oven", link: "/tasks" });
  });

  it("skips push when not configured", async () => {
    configured = false;
    rpc.mockResolvedValueOnce(ok);
    expect(await nudgeAssignee(session, T)).toEqual({ ok: true, data: { pushed: 0 } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("still succeeds when push throws or target lookup fails", async () => {
    rpc.mockResolvedValueOnce(ok).mockResolvedValueOnce({ data: [target], error: null });
    sendToSubscriptions.mockRejectedValueOnce(new Error("push down"));
    expect(await nudgeAssignee(session, T)).toEqual({ ok: true, data: { pushed: 0 } });
    rpc.mockResolvedValueOnce(ok).mockRejectedValueOnce(new Error("rpc down"));
    expect(await nudgeAssignee(session, T)).toEqual({ ok: true, data: { pushed: 0 } });
  });
});
