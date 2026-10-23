import { expect, test } from "@playwright/test";

const ROUTE = "/api/integrations/gmail";
const BODY = JSON.stringify({ member: "Alex", threads: [] });

test("gmail ingest never succeeds without a valid signature", async ({ request }) => {
  const ts = String(Math.floor(Date.now() / 1000));
  const cases: Record<string, string>[] = [
    {},
    { "x-ourhome-timestamp": ts },
    { "x-ourhome-timestamp": ts, "x-ourhome-signature": "zz" },
    { "x-ourhome-timestamp": ts, "x-ourhome-signature": "0".repeat(64) },
    { "x-ourhome-timestamp": "abc", "x-ourhome-signature": "0".repeat(64) },
  ];
  for (const headers of cases) {
    const res = await request.post(ROUTE, { headers: { "content-type": "application/json", ...headers }, data: BODY, maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(await res.text()).not.toContain("Alex");
  }
});

test("gmail ingest rejects an oversized body", async ({ request }) => {
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await request.post(ROUTE, {
    headers: { "x-ourhome-timestamp": ts, "x-ourhome-signature": "0".repeat(64) },
    data: "x".repeat(70 * 1024),
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
});

test("gmail ingest is POST only", async ({ request }) => {
  expect((await request.get(ROUTE, { maxRedirects: 0 })).status()).toBe(405);
});

test("/replies redirects to login", async ({ request }) => {
  const res = await request.get("/replies", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(new URL(res.headers()["location"], "http://x").pathname).toBe("/login");
});
