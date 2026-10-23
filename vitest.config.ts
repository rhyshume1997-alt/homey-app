import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // 'server-only' throws outside the RSC bundler condition; stub for unit tests.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  // RLS tests need a live Postgres and run separately via `npm run test:rls`.
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/components/**/*.test.{ts,tsx}"],
    environment: "node",
    // jsdom component tests are slow to start on busy CI runners; 5 s caused false timeouts.
    testTimeout: 30_000,
  },
});
