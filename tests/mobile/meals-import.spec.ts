import { expect, test, type Page } from "@playwright/test";

// "Add from a link" sheet on a phone. Uses the paste box, which needs no network: made-up text only.
const session = {
  access_token: "test-only",
  refresh_token: "test-only",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 86400,
  user: { id: "0000bbbb-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated" },
};
const COOKIE = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");

async function smallTargets(page: Page, root: string) {
  return page.evaluate((sel) => {
    const out: string[] = [];
    const scope = document.querySelector(sel) ?? document.body;
    for (const el of scope.querySelectorAll<HTMLElement>("a[href], button, select, input:not([type=hidden]), textarea, summary, [role=button]")) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || st.visibility === "hidden" || st.display === "none") continue;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, root);
}

async function smallFieldText(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("input:not([type=hidden]), select, textarea")]
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.tagName.toLowerCase()} ${el.getAttribute("name") ?? ""} ${getComputedStyle(el).fontSize}`),
  );
}

test("meals: Add from a link opens a sheet that fits, with big targets, and previews pasted text", async ({ page }) => {
  await page.context().addCookies([{ name: "sb-localhost-auth-token", value: COOKIE, domain: "localhost", path: "/" }]);
  await page.goto("/meals", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Add from a link" }).tap();
  const dialog = page.getByRole("dialog", { name: "Add from a link" });
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  await dialog.getByRole("button", { name: "Paste the recipe text instead" }).tap();
  await dialog.getByLabel("Paste the caption or recipe text").fill("Made-up soup\nIngredients:\n- 2 leeks\n- 300ml stock\n- a pinch of salt");
  await dialog.getByRole("button", { name: "Find ingredients" }).tap();
  await expect(dialog.getByTestId("import-row")).toHaveCount(3);
  await dialog.getByRole("radio", { name: "A new meal" }).check();

  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw);
  expect(await smallTargets(page, '[role="dialog"]')).toEqual([]);
  expect(await smallFieldText(page)).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("meals-import.png") });
});
