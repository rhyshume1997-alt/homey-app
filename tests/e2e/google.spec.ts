import { expect, test } from "@playwright/test";

for (const path of ["/auth/google/connect", "/auth/google/callback?code=abc", "/settings/google"]) {
  test(`${path} redirects to login when signed out`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(new URL(res.headers()["location"]!, "http://x").pathname).toBe("/login");
    expect(res.headers()["cache-control"]).toContain("no-store");
  });
}
