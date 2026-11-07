import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Database tests need a live Postgres and run through `pnpm test:db`.
    exclude: ["**/node_modules/**", "tests/db/**"],
  },
});
