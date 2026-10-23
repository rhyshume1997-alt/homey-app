import { expect, test } from "@playwright/test";

const ID = "d0c00000-0000-4000-8000-000000000001";

for (const path of ["/documents", `/documents/${ID}/open`]) {
  test(`GET ${path} redirects to /login when signed out`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const loc = new URL(res.headers()["location"], "http://x");
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe(path);
  });
}

test("open route with a non-uuid id never returns 2xx", async ({ request }) => {
  for (const id of ["not-a-uuid", "1", "..%2F..%2Fetc", "%00"]) {
    const res = await request.get(`/documents/${id}/open`, { maxRedirects: 0 });
    expect(res.status(), id).toBeGreaterThanOrEqual(300);
  }
});
