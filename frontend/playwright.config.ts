import { defineConfig, devices } from '@playwright/test'

// E2E suite (U13). Not part of `make check`; run via `make e2e` against a compose stack.
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/e2e',
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${process.env.HTTP_PORT ?? 8080}`,
    trace: 'retain-on-failure',
  },
  // channel 'chromium' = full Chromium in new headless mode: it has a PDF viewer, so the annex tab keeps its URL.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
})
