import { defineConfig, devices } from '@playwright/test'

// E2E suite (U13). Not part of `make check`; run via `make e2e` against a compose stack.
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/e2e',
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `https://localhost:${process.env.HTTPS_PORT ?? 8443}`,
    ignoreHTTPSErrors: true, // Caddy internal CA
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
