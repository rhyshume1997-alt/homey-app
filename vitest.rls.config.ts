import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/rls/**/*.test.ts"],
    environment: "node",
    // Remote runs (Management API, one HTTP round trip per statement) are much slower.
    testTimeout: process.env.SUPABASE_PROJECT_REF ? 180000 : 20000,
    hookTimeout: process.env.SUPABASE_PROJECT_REF ? 180000 : 30000,
    fileParallelism: false,
  },
});
