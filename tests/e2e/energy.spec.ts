import { expect, test } from "@playwright/test";

test("GET /energy redirects signed-out users to /login", async ({ request }) => {
  const res = await request.get("/energy", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const loc = new URL(res.headers()["location"], "http://x");
  expect(loc.pathname).toBe("/login");
  expect(loc.searchParams.get("next")).toBe("/energy");
  expect(res.headers()["cache-control"]).toContain("no-store");
});
