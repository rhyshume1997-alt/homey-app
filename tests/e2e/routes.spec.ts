import { expect, test } from "@playwright/test";

const PROTECTED = ["/tasks", "/snags", "/money", "/activity", "/more", "/settings", "/activity?before=1"];

for (const path of PROTECTED) {
  test(`GET ${path} redirects to /login with next, no-store`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const loc = new URL(res.headers()["location"], "http://x");
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe(path);
    expect(res.headers()["cache-control"]).toContain("no-store");
  });

  test(`forged auth cookie does not grant ${path}`, async ({ request }) => {
    const res = await request.get(path, {
      maxRedirects: 0,
      headers: {
        cookie: "sb-xxx-auth-token=garbage; sb-xxx-auth-token.0=garbage; sb-access-token=garbage",
      },
    });
    expect(res.status()).toBe(307);
    expect(new URL(res.headers()["location"], "http://x").pathname).toBe("/login");
    expect(res.headers()["cache-control"]).toContain("no-store");
  });
}

test("server action POST to /tasks is redirected before reaching the action", async ({ request }) => {
  const res = await request.post("/tasks", {
    maxRedirects: 0,
    headers: { "Next-Action": "deadbeef00000000000000000000000000000000" },
    form: { title: "injected" },
  });
  expect(res.status()).toBeGreaterThanOrEqual(300);
  expect(res.status()).toBeLessThan(400);
  expect(new URL(res.headers()["location"], "http://x").pathname).toBe("/login");
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(await res.text()).not.toContain("injected");
});

const CALLBACKS = [
  "/auth/callback",
  "/auth/callback?error=access_denied&error_description=SECRET_TEXT_123",
  "/auth/callback?code=abc&error=SECRET_TEXT_123",
];

for (const path of CALLBACKS) {
  test(`GET ${path} fails closed without reflecting input`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(303);
    const rawLoc = res.headers()["location"];
    const loc = new URL(rawLoc, "http://x");
    expect(loc.pathname).toBe("/login");
    expect(["unavailable", "denied"]).toContain(loc.searchParams.get("error"));
    expect(rawLoc).not.toContain("SECRET_TEXT");
    expect(rawLoc).not.toContain("access_denied");
    expect(await res.text()).not.toContain("SECRET_TEXT");
    expect(res.headers()["cache-control"]).toContain("no-store");
  });
}

for (const next of ["//evil.com", "https://evil.com", "/\\evil.com", "//evil.com/%2f.."]) {
  test(`/auth/login?next=${next} never redirects off-origin`, async ({ request }) => {
    const res = await request.get(`/auth/login?next=${encodeURIComponent(next)}`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(303);
    const rawLoc = res.headers()["location"];
    expect(rawLoc).not.toContain("evil.com");
    const loc = new URL(rawLoc, "http://127.0.0.1:3100");
    // `next start -H 127.0.0.1` reports its own origin as localhost:3100; both are local.
    expect(["127.0.0.1", "localhost"]).toContain(loc.hostname);
    expect(loc.port).toBe("3100");
    expect(loc.pathname).toBe("/login");
    expect(res.headers()["cache-control"]).toContain("no-store");
  });
}
