import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests of the brew-day screens, on a phone-sized viewport (docs/code-review-plan.md, fase 4).
 *
 * `npm run e2e:server` starts the app against an isolated Worker config (e2e/wrangler.jsonc): an empty
 * local database that is reset on every start, no brewery code and no Anthropic key. Port 5174 leaves
 * `npm run dev` (5173) alone.
 */
const PORT = 5174;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results",
  globalSetup: "./e2e/global-setup.ts",
  // Every test makes its own batch, but they share the one brewery and person from global setup.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    storageState: "./e2e/.auth/brage.json",
    locale: "nb-NO",
    timezoneId: "Europe/Oslo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // iPhone 14 size, Chromium engine: same layout as the phone, without a WebKit download.
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "npm run e2e:server",
    url: `http://localhost:${PORT}/api/mode`,
    // The first Vite start optimises dependencies, which takes a while on a cold cache.
    timeout: 180_000,
    // Never reuse a server: only `npm run e2e:server` resets the database and selects e2e/wrangler.jsonc
    // (no .dev.vars, no real Anthropic key). If port 5174 is taken, the run fails instead of guessing.
    reuseExistingServer: false,
  },
});
