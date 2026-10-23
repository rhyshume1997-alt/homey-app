import { expect, test } from "@playwright/test";

test("GET /shopping redirects to /login with next, no-store", async ({ request }) => {
  const res = await request.get("/shopping", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const loc = new URL(res.headers()["location"], "http://x");
  expect(loc.pathname).toBe("/login");
  expect(loc.searchParams.get("next")).toBe("/shopping");
  expect(res.headers()["cache-control"]).toContain("no-store");
});

test("forged auth cookie does not grant /shopping", async ({ request }) => {
  const res = await request.get("/shopping", { maxRedirects: 0, headers: { cookie: "sb-xxx-auth-token=garbage" } });
  expect(res.status()).toBe(307);
  expect(new URL(res.headers()["location"], "http://x").pathname).toBe("/login");
});
