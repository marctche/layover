import { defineConfig } from "vitest/config";

// Real-login tests need a local Supabase stack (with Mailpit) and fail, rather than skip,
// when it is not configured. They are kept out of the default run.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/auth/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60000,
  },
});
