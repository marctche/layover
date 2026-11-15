import { defineConfig } from "@playwright/test";

// Browser tests run the production build against a local Supabase stack (with Mailpit).
//   LAYOVER_TEST_SUPABASE_URL  API URL
//   LAYOVER_TEST_SUPABASE_KEY  publishable (or anon) key
// They are kept out of the default `pnpm test` run and fail, rather than skip, when unconfigured.

const supabaseUrl = process.env.LAYOVER_TEST_SUPABASE_URL;
const supabaseKey = process.env.LAYOVER_TEST_SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
  throw new Error("LAYOVER_TEST_SUPABASE_URL and LAYOVER_TEST_SUPABASE_KEY must be set for the browser tests.");
}

// localhost, not 127.0.0.1: the server builds redirect URLs from its own hostname (localhost), and a
// browser on another host would lose its session cookie across that redirect.
const PORT = 3000;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    // NEXT_PUBLIC_* values are read at build time, so the build gets them too.
    command: `pnpm build && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseKey,
    },
  },
});
