import { expect, test } from "@playwright/test";

test("GET /maintenance redirects to /login with next, no-store", async ({ request }) => {
  const res = await request.get("/maintenance", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const loc = new URL(res.headers()["location"], "http://x");
  expect(loc.pathname).toBe("/login");
  expect(loc.searchParams.get("next")).toBe("/maintenance");
  expect(res.headers()["cache-control"]).toContain("no-store");
});

test("forged auth cookie does not grant /maintenance", async ({ request }) => {
  const res = await request.get("/maintenance", {
    maxRedirects: 0,
    headers: { cookie: "sb-xxx-auth-token=garbage; sb-access-token=garbage" },
  });
  expect(res.status()).toBe(307);
  expect(new URL(res.headers()["location"], "http://x").pathname).toBe("/login");
});
