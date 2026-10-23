import { expect, test } from "@playwright/test";

test("GET /notifications redirects signed-out users to /login with next", async ({ request }) => {
  const res = await request.get("/notifications", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const loc = new URL(res.headers()["location"], "http://x");
  expect(loc.pathname).toBe("/login");
  expect(loc.searchParams.get("next")).toBe("/notifications");
});
