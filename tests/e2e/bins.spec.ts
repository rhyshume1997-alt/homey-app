import { expect, test } from "@playwright/test";

const URL_PATH = "/api/integrations/bins";
const sig = "a".repeat(64);

test("GET is not allowed", async ({ request }) => {
  const res = await request.get(URL_PATH, { maxRedirects: 0 });
  expect(res.status()).toBe(405);
  expect(res.headers()["cache-control"]).toContain("no-store");
});

test("POST without signature headers is rejected, never 2xx", async ({ request }) => {
  const res = await request.post(URL_PATH, { data: { collections: [] }, maxRedirects: 0 });
  expect([401, 503]).toContain(res.status());
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(await res.text()).not.toContain("collections");
});

test("POST with malformed headers is rejected", async ({ request }) => {
  const res = await request.post(URL_PATH, {
    data: "{}",
    headers: { "x-ourhome-timestamp": "abc", "x-ourhome-signature": "short" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
});

test("a well-formed but unverified request is never accepted", async ({ request }) => {
  const res = await request.post(URL_PATH, {
    data: "{}",
    headers: { "x-ourhome-timestamp": String(Math.floor(Date.now() / 1000)), "x-ourhome-signature": sig, "content-type": "application/json" },
    maxRedirects: 0,
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
});

test("oversized body is rejected", async ({ request }) => {
  const res = await request.post(URL_PATH, {
    data: "x".repeat(70 * 1024),
    headers: { "x-ourhome-timestamp": String(Math.floor(Date.now() / 1000)), "x-ourhome-signature": sig, "content-type": "text/plain" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(413);
});
