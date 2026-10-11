import { defineConfig } from "@playwright/test";

/**
 * Browser end-to-end tests. They run the PRODUCTION build against a throwaway in-process database seeded with the real
 * pipeline over canned providers (scripts/e2e-server.mjs), so nothing here touches Supabase, Tavily or Gemini: the server
 * is started with empty API keys, and the first test asserts that.
 *
 *   npm run build && npm run test:e2e        (uses the Edge or Chrome you already have; no browser download)
 */
const PORT = 3222;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.E2E_BROWSER ?? "msedge",
    // Without this, Edge's proxy auto-detection (WPAD) delays every navigation to localhost by ~20 s on some Windows machines.
    launchOptions: { args: ["--no-proxy-server"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: { command: "node scripts/e2e-server.mjs", url: `http://localhost:${PORT}/api/health`, reuseExistingServer: false, timeout: 120_000, stdout: "pipe" },
});
