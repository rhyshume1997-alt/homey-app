import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const src = readFileSync(path.resolve(__dirname, "../../../../public/sw.js"), "utf8");

function load() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const showNotification = vi.fn(async () => {});
  const openWindow = vi.fn(async () => ({}));
  const matchAll = vi.fn(async () => [] as unknown[]);
  const self = {
    addEventListener: (t: string, h: (e: unknown) => void) => void (handlers[t] = h),
    registration: { showNotification },
    clients: { claim: vi.fn(), matchAll, openWindow },
    location: { origin: "https://home.example.test" },
    skipWaiting: vi.fn(),
  };
  vm.runInNewContext(src, { self, URL });
  return { handlers, showNotification, openWindow, matchAll };
}

const waited = async (fn: (e: unknown) => void, ev: Record<string, unknown>) => {
  let p: Promise<unknown> = Promise.resolve();
  fn({ ...ev, waitUntil: (x: Promise<unknown>) => void (p = x) });
  await p;
};

describe("public/sw.js", () => {
  it("registers push and notificationclick but no fetch handler", () => {
    const { handlers } = load();
    expect(handlers.push).toBeTypeOf("function");
    expect(handlers.notificationclick).toBeTypeOf("function");
    expect(handlers.fetch).toBeUndefined();
  });

  it("shows a notification with icon and relative link", async () => {
    const { handlers, showNotification } = load();
    await waited(handlers.push, { data: { json: () => ({ title: "T", body: "B", link: "/tasks" }) } });
    expect(showNotification).toHaveBeenCalledWith(
      "T",
      expect.objectContaining({ body: "B", icon: "/icons/icon-192.png", data: { link: "/tasks" } }),
    );
  });

  it("falls back to a safe link and survives bad payloads", async () => {
    const { handlers, showNotification } = load();
    await waited(handlers.push, { data: { json: () => ({ title: "T", link: "https://evil.test" }) } });
    expect((showNotification.mock.calls[0] as unknown[])[1]).toMatchObject({ data: { link: "/" } });
    await waited(handlers.push, {
      data: {
        json: () => {
          throw new Error("x");
        },
      },
    });
    expect((showNotification.mock.calls[1] as unknown[])[0]).toBe("Our Home");
  });

  it("opens only same-origin links on click", async () => {
    for (const [link, expected] of [
      ["/tasks", "https://home.example.test/tasks"],
      ["//evil.test/x", "https://home.example.test/"],
      ["https://evil.test", "https://home.example.test/"],
    ]) {
      const { handlers, openWindow } = load();
      const close = vi.fn();
      await waited(handlers.notificationclick, { notification: { close, data: { link } } });
      expect(close).toHaveBeenCalled();
      expect(openWindow).toHaveBeenCalledWith(expected);
    }
  });

  it("focuses an existing same-origin window", async () => {
    const { handlers, matchAll, openWindow } = load();
    const focus = vi.fn(async () => ({}));
    const navigate = vi.fn();
    matchAll.mockResolvedValue([{ url: "https://home.example.test/x", focus, navigate }]);
    await waited(handlers.notificationclick, { notification: { close: vi.fn(), data: { link: "/tasks" } } });
    expect(navigate).toHaveBeenCalledWith("https://home.example.test/tasks");
    expect(focus).toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });
});
