import { defineConfig, devices } from "@playwright/test";

// Runs against the browser mock mode (`pnpm dev:mock`): fixture data, no real
// Stockfish, Claude or network. WebKit is the engine of the Mac app's webview;
// Chromium is close to WebView2 on Windows.
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:1430",
    viewport: { width: 1320, height: 860 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1320, height: 860 } } },
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1320, height: 860 } } },
  ],
  webServer: {
    command: "pnpm dev:mock",
    port: 1430,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
