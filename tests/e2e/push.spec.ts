import { expect, test } from "@playwright/test";

test("GET /api/push/public-key is 401 when signed out", async ({ request }) => {
  const res = await request.get("/api/push/public-key");
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
  expect(res.headers()["cache-control"]).toContain("no-store");
});
