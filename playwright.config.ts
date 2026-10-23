import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const PORT = 3100;
const localChromium = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...(existsSync(localChromium)
      ? { launchOptions: { executablePath: localChromium } }
      : {}),
  },
  webServer: {
    command: `npx next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
