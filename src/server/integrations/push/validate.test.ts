import { describe, expect, it } from "vitest";
import { payloadSchema, subscriptionSchema } from "./validate";

const P256 = "B".repeat(87);
const AUTH = "a".repeat(22);
const ok = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: P256, auth: AUTH };

describe("subscriptionSchema", () => {
  it("accepts a valid subscription", () => {
    expect(subscriptionSchema.safeParse(ok).success).toBe(true);
  });
  it("rejects non-https, junk and over-long endpoints", () => {
    for (const endpoint of ["http://x.test/a", "javascript:alert(1)", "not a url", `https://x.test/${"a".repeat(1000)}`]) {
      expect(subscriptionSchema.safeParse({ ...ok, endpoint }).success).toBe(false);
    }
  });
  it("rejects bad key lengths and characters", () => {
    expect(subscriptionSchema.safeParse({ ...ok, p256dh: "short" }).success).toBe(false);
    expect(subscriptionSchema.safeParse({ ...ok, auth: "x" }).success).toBe(false);
    expect(subscriptionSchema.safeParse({ ...ok, auth: "a b".repeat(8) }).success).toBe(false);
    expect(subscriptionSchema.safeParse({ ...ok, userAgent: "u".repeat(201) }).success).toBe(false);
  });
});

describe("payloadSchema", () => {
  it("allows only relative links", () => {
    expect(payloadSchema.safeParse({ title: "t", body: "b", link: "/tasks" }).success).toBe(true);
    for (const link of ["https://evil.test", "//evil.test", "tasks", "/a\\b", "javascript:1"]) {
      expect(payloadSchema.safeParse({ title: "t", body: "b", link }).success).toBe(false);
    }
  });
});

describe("push endpoint host allowlist (SSRF)", () => {
  it("accepts the browser push services", async () => {
    const { isPushServiceHost } = await import("./validate");
    for (const h of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "wns2-par02p.notify.windows.com", "web.push.apple.com"]) {
      expect(isPushServiceHost(h)).toBe(true);
    }
  });
  it("rejects other hosts, IP literals and ports", () => {
    for (const endpoint of ["https://169.254.169.254/latest", "https://10.0.0.1/a", "https://localhost/a", "https://evil.example/fcm.googleapis.com", "https://fcm.googleapis.com.evil.example/a", "https://fcm.googleapis.com:8443/a", "https://[::1]/a"]) {
      expect(subscriptionSchema.safeParse({ ...ok, endpoint }).success).toBe(false);
    }
  });
});
