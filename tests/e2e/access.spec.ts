import { expect, test } from "@playwright/test";

test("GET / signed out is the public landing page (200, no redirect, no-store)", async ({ request }) => {
  const res = await request.get("/", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  const html = await res.text();
  expect(html).toContain("A private household app");
  expect(html).toContain('href="/privacy"');
  expect(html).toContain('href="/terms"');
  expect(html).toContain('href="/login"');
});

for (const [path, heading] of [["/privacy", "Privacy policy"], ["/terms", "Terms of use"], ["/welcome", "A private household app"]]) {
  test(`${path} is public`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain(heading);
  });
}

test("privacy policy names the scopes, Limited Use and the contact email", async ({ request }) => {
  const html = await (await request.get("/privacy")).text();
  expect(html).toContain("https://www.googleapis.com/auth/spreadsheets.readonly");
  expect(html).toContain("https://www.googleapis.com/auth/gmail.readonly");
  expect(html).toContain("Limited Use");
  expect(html).toContain("rhyshume1997@gmail.com");
});

test("GET /some/page redirects to /login with next", async ({ request }) => {
  const res = await request.get("/some/page", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const loc = new URL(res.headers()["location"], "http://x");
  expect(loc.pathname).toBe("/login");
  expect(loc.searchParams.get("next")).toBe("/some/page");
});

test("protected paths land on login when followed", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login\?next=%2Ftasks$/);
  const link = page.getByRole("link", { name: "Sign in with Google" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/auth/login?next=%2Ftasks");
});

test("GET /api/anything is 401 JSON, no-store", async ({ request }) => {
  const res = await request.get("/api/anything");
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
  expect(res.headers()["cache-control"]).toContain("no-store");
});

test("GET /api/health is 200 and minimal", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(res.headers()["cache-control"]).toContain("no-store");
});

test("/login is 200 with security headers", async ({ request }) => {
  const res = await request.get("/login");
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("/robots.txt is public", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain("Disallow: /");
});

test("/auth/login without Supabase env redirects to unavailable", async ({ request }) => {
  const res = await request.get("/auth/login", { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  const loc = new URL(res.headers()["location"], "http://x");
  expect(loc.pathname).toBe("/login");
  expect(loc.searchParams.get("error")).toBe("unavailable");
});

test("POST /auth/signout without a session is not 2xx", async ({ request }) => {
  const res = await request.post("/auth/signout", { maxRedirects: 0 });
  expect(res.status()).toBeGreaterThanOrEqual(300);
});

test("GET /onboarding signed out redirects to login", async ({ request }) => {
  const res = await request.get("/onboarding", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(new URL(res.headers()["location"], "http://x").pathname).toBe("/login");
});

test("a well-formed invite link signed out stores a short-lived httpOnly cookie and redirects to login without the token", async ({ request }) => {
  const token = "A".repeat(43);
  const res = await request.get(`/invite/${token}`, { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  const loc = res.headers()["location"];
  expect(new URL(loc, "http://x").pathname).toBe("/login");
  expect(loc).not.toContain(token);
  const cookie = res.headers()["set-cookie"] ?? "";
  expect(cookie).toContain("oh_invite=");
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Max-Age=900/i);
  expect(res.headers()["cache-control"]).toContain("no-store");
});

test("malformed invite links are not public and set no cookie", async ({ request }) => {
  for (const p of ["/invite/short", `/invite/${"A".repeat(43)}/x`]) {
    const res = await request.get(p, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(new URL(res.headers()["location"] ?? "", "http://x").pathname).toBe("/login");
    expect(res.headers()["set-cookie"] ?? "").not.toContain("oh_invite");
  }
});

test("dot-segment invite paths fold to the public landing page and never reach the invite handler", async ({ request }) => {
  // The server normalises /x/%2e%2e to "/", like every other path (pre-existing behaviour).
  const res = await request.get("/invite/%2e%2e", { maxRedirects: 0 });
  expect(res.headers()["set-cookie"] ?? "").not.toContain("oh_invite");
  expect(await res.text()).toContain("A private household app");
});
