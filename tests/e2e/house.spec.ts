import { expect, test } from "@playwright/test";

for (const path of ["/house", "/mortgage", "/contacts"]) {
  test(`GET ${path} redirects to /login when signed out`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const loc = new URL(res.headers()["location"], "http://x");
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe(path);
  });
}
