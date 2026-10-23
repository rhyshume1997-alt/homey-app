import { expect, test, type Page } from "@playwright/test";

// Fake signed-in session for the TEST ONLY fake Supabase (tests/mobile/fake-supabase.mjs).
const session = {
  access_token: "test-only",
  refresh_token: "test-only",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 86400,
  user: { id: "0000bbbb-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated" },
};
const COOKIE = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");

async function signIn(page: Page) {
  await page.context().addCookies([{ name: "sb-localhost-auth-token", value: COOKIE, domain: "localhost", path: "/" }]);
}

/** Visible interactive elements smaller than 44x44 CSS px. */
async function smallTargets(page: Page, root = "body") {
  return page.evaluate((sel) => {
    const out: string[] = [];
    const scope = document.querySelector(sel) ?? document.body;
    for (const el of scope.querySelectorAll<HTMLElement>("a[href], button, select, input:not([type=hidden]), textarea, summary, [role=button]")) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || st.visibility === "hidden" || st.display === "none") continue;
      if (r.height < 43.5 || r.width < 43.5) {
        out.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || el.getAttribute("name") || "").trim().slice(0, 40)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  }, root);
}

/** Form fields under 16px make iOS Safari zoom in on tap. */
async function smallFieldText(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("input:not([type=hidden]), select, textarea")]
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.tagName.toLowerCase()} ${el.getAttribute("name") ?? ""} ${getComputedStyle(el).fontSize}`),
  );
}

async function noSidewaysScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, "page must not scroll sideways").toBeLessThanOrEqual(cw);
}

/** Full-height shot with fixed bars at the bottom, labelled as test data. */
async function shot(page: Page, name: string) {
  await page.evaluate(() => {
    const b = document.createElement("div");
    b.textContent = "TEST DATA — phone check, not real household records";
    b.setAttribute("style", "position:fixed;top:0;left:0;right:0;z-index:99999;background:#b45309;color:#fff;font:600 12px system-ui;text-align:center;padding:4px;pointer-events:none");
    document.body.appendChild(b);
  });
  const vp = page.viewportSize()!;
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, h) });
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
  await page.setViewportSize(vp);
}

const PAGES = [
  ["home", "/"],
  ["tasks", "/tasks"],
  ["snags", "/snags"],
  ["money", "/money"],
  ["money-check", "/money/check"],
  ["activity", "/activity"],
  ["more", "/more"],
  ["budget", "/budget"],
  ["bins", "/bins"],
  ["documents", "/documents"],
  ["shopping", "/shopping"],
  ["maintenance", "/maintenance"],
  ["energy", "/energy"],
  ["house", "/house"],
  ["mortgage", "/mortgage"],
  ["contacts", "/contacts"],
  ["replies", "/replies"],
  ["notifications", "/notifications"],
  ["assistant", "/assistant"],
  ["settings-google", "/settings/google"],
  ["rooms", "/rooms"],
  ["room-kitchen", "/rooms/0000d18a-0000-4000-8000-000000000001"],
  ["things-to-get", "/things-to-get"],
  ["checklist", "/checklist"],
  ["calendar", "/calendar"],
  ["appliances", "/appliances"],
  ["appliance", "/appliances/0000d18a-0000-4000-8000-000000000002"],
  ["meals", "/meals"],
  ["meals-ingredients", "/meals/ingredients"],
  ["wifi", "/wifi"],
  ["emergency", "/emergency"],
] as const;

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  for (const [name, path] of PAGES) {
    test(`${name}: fits the screen, 44px targets`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/$" : path}`));
      await noSidewaysScroll(page);
      expect(await smallTargets(page)).toEqual([]);
      expect(await smallFieldText(page), "fields under 16px zoom on iPhone").toEqual([]);
      await shot(page, name);
    });
  }

  test("bottom nav is in thumb reach and every item is a big target", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const nav = page.getByRole("navigation").filter({ has: page.getByRole("link", { name: /tasks/i }) }).last();
    const box = (await nav.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.y + box.height).toBeGreaterThan(vp.height - 2);
    expect(box.y).toBeGreaterThan(vp.height * 0.75);
    for (const label of ["Home", "Tasks", "Snags", "Money", "More"]) {
      const b = (await nav.getByRole("link", { name: label }).boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.width).toBeGreaterThanOrEqual(44);
    }
    // Navigating with a tap works.
    await nav.getByRole("link", { name: "Tasks" }).tap();
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test("Quick Add opens as a sheet that fits and has big buttons", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Quick Add" }).first().tap();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await noSidewaysScroll(page);
    expect(await smallTargets(page, '[role="dialog"]')).toEqual([]);
    expect(await smallFieldText(page)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath("quick-add.png") });
  });

  test("date format setting is usable", async ({ page }) => {
    await page.goto("/more", { waitUntil: "networkidle" });
    const card = page.locator("section", { has: page.getByRole("heading", { name: "Date format" }) });
    await card.scrollIntoViewIfNeeded();
    expect(await smallTargets(page, 'section:has(#date-format-heading)')).toEqual([]);
    await expect(card.getByTestId("date-example")).toHaveText(/\d{2}\/[A-Z][a-z]{2}\/\d{4}/);
    await card.screenshot({ path: test.info().outputPath("date-format.png") });
  });
});

test("sign in page fits and has a big Google button", async ({ page }) => {
  await page.goto("/login", { waitUntil: "networkidle" });
  await noSidewaysScroll(page);
  expect(await smallTargets(page)).toEqual([]);
  await shot(page, "sign-in");
});

test.describe("Add to Home Screen", () => {
  test("manifest is public and installable", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m).toMatchObject({ name: "Our Home", short_name: "Our Home", start_url: "/", display: "standalone", background_color: "#16131d", theme_color: "#16131d" });
    expect(m.icons.map((i: { purpose: string }) => i.purpose)).toContain("maskable");
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    // Browsers fetch install icons without the session cookie, so they must be public.
    for (const icon of m.icons) {
      const r = await request.get(icon.src, { maxRedirects: 0 });
      expect(r.status(), icon.src).toBe(200);
    }
  });

  test("iOS meta: apple-touch-icon is public, web-app capable, viewport set", async ({ page, request }) => {
    await page.goto("/login");
    const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    expect(apple).toBeTruthy();
    expect((await request.get(apple!, { maxRedirects: 0 })).status()).toBe(200);
    await expect(page.locator('meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"]').first()).toHaveAttribute("content", "yes");
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /width=device-width.*viewport-fit=cover/);
  });
});
