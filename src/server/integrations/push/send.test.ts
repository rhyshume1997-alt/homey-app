import { beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({ default: { sendNotification: (...a: unknown[]) => sendNotification(...a) } }));

const env: Record<string, string | undefined> = {};
vi.mock("@/server/env", () => ({ getServerEnv: () => env }));

import { sendToHousehold, sendToUser } from "./send";

const payload = { title: "Hi", body: "There", link: "/tasks" };
const rows = [
  { id: "1", endpoint: "https://p.test/1", p256dh: "k1", auth: "a1" },
  { id: "2", endpoint: "https://p.test/2", p256dh: "k2", auth: "a2" },
  { id: "3", endpoint: "https://p.test/3", p256dh: "k3", auth: "a3" },
];

function fakeDb() {
  const deleted: string[] = [];
  const rpc = vi.fn(async () => ({}));
  const db = {
    rpc,
    from: () => ({
      select: () => ({ eq: async () => ({ data: rows }) }),
      delete: () => ({ eq: async (_c: string, id: string) => void deleted.push(id) }),
    }),
  };
  return { db: db as never, deleted, rpc };
}

beforeEach(() => {
  sendNotification.mockReset();
  env.VAPID_PUBLIC_KEY = "pub";
  env.VAPID_PRIVATE_KEY = "priv";
  env.VAPID_SUBJECT = "mailto:a@example.test";
});

describe("send", () => {
  it("is a no-op when VAPID env is missing", async () => {
    env.VAPID_PRIVATE_KEY = undefined;
    const { db } = fakeDb();
    expect(await sendToUser(db, "u", payload)).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("removes 404/410 subscriptions, counts other failures, and never logs keys", async () => {
    sendNotification
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockRejectedValueOnce({ statusCode: 500 })
      .mockResolvedValueOnce({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, deleted, rpc } = fakeDb();
    expect(await sendToHousehold(db, "h", payload)).toEqual({ sent: 1, removed: 1, failed: 1 });
    expect(deleted).toEqual(["1"]);
    expect(rpc).toHaveBeenCalledWith("push_record_result", { p_id: "2", p_ok: false });
    expect(rpc).toHaveBeenCalledWith("push_record_result", { p_id: "3", p_ok: true });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/priv|k1|a1|p\.test/);
    warn.mockRestore();
  });

  it("also removes on 404", async () => {
    sendNotification.mockRejectedValue({ statusCode: 404 });
    const { db, deleted } = fakeDb();
    expect((await sendToUser(db, "u", payload)).removed).toBe(3);
    expect(deleted).toEqual(["1", "2", "3"]);
  });

  it("rejects a non-relative link", async () => {
    const { db } = fakeDb();
    await expect(sendToUser(db, "u", { ...payload, link: "https://evil.test" })).rejects.toThrow();
  });
});
