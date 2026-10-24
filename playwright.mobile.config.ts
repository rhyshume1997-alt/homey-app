import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Phone layout checks against the real app, signed in as a fake user backed by
// tests/mobile/fake-supabase.mjs (made-up data). Build first: npm run test:mobile.
// Only Chromium is installed here, so iPhone runs emulate Safari's viewport, touch and
// user agent on Chromium; real WebKit rendering still needs a check on a device.
const PORT = 3300;
const localChromium = "/opt/pw-browsers/chromium";
const launch = existsSync(localChromium) ? { launchOptions: { executablePath: localChromium } } : {};
// Same household id as H in tests/mobile/fake-supabase.mjs, so the primary-household features behave as before.
const env = { NEXT_DIST_DIR: ".next-mobile", PATH: process.env.PATH ?? "", PRIMARY_HOUSEHOLD_ID: "0000aaaa-0000-4000-8000-000000000001" };

const iphone = devices["iPhone 13"];
const android = devices["Pixel 7"];

export default defineConfig({
  testDir: "tests/mobile",
  outputDir: "test-results/mobile",
  use: { baseURL: `http://localhost:${PORT}`, timezoneId: "Europe/London", locale: "en-GB", ...launch },
  projects: [
    { name: "iphone-375", use: { ...iphone, defaultBrowserType: "chromium", viewport: { width: 375, height: 667 } } },
    { name: "iphone-390", use: { ...iphone, defaultBrowserType: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "android-390", use: { ...android, viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: "node tests/mobile/fake-supabase.mjs",
      url: "http://127.0.0.1:54329/health",
      reuseExistingServer: false,
      timeout: 20_000,
    },
    {
      command: `npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env,
    },
  ],
});
