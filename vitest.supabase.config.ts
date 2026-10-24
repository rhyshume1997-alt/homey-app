import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Written by scripts/supabase-test.sh from `supabase status -o env` (loopback only).
const envFile = ".env.supabase-test.local";
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  test: {
    include: ["tests/supabase/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Suites share one local stack; run files one at a time.
    fileParallelism: false,
  },
});
