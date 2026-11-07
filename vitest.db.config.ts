import { defineConfig } from "vitest/config";

// Database tests need a Postgres with the migrations applied, supplied through LAYOVER_TEST_DB_URL.
// They are kept out of the default run, and they fail (rather than skip) when the URL is missing,
// so a missing database can never look like a pass.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
