import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

/**
 * How the UI under test is served (see tests/e2e/fixtures/core.ts):
 *  - MFBE_CORE_BIN=/path/to/mfbe-core  -> each worker starts its own core serving ui/dist;
 *    baseURL comes from the worker fixture (port + token).
 *  - MFBE_UI_URL=http://...            -> an already running UI (core-served or vite dev).
 *  - neither                            -> core-less mode: `vite preview` serves ui/dist on
 *    MFBE_PREVIEW_PORT (default 4173); the bundle is built first when dist/ is missing.
 */
const coreBin = process.env.MFBE_CORE_BIN;
const uiUrl = process.env.MFBE_UI_URL;
const previewPort = Number(process.env.MFBE_PREVIEW_PORT ?? 4173);
const previewUrl = `http://127.0.0.1:${previewPort}/`;
const distReady = existsSync(fileURLToPath(new URL('./dist/index.html', import.meta.url)));
const useVitePreview = !coreBin && !uiUrl;

export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: ['**/shell/**'], // CEF shell specs run through tools/shell-smoke.sh
  // Hosted CI runners are 2-3x slower than the development host: longer budgets there.
  timeout: process.env.CI ? 120_000 : 60_000,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: uiUrl ?? (useVitePreview ? previewUrl : undefined),
    headless: true,
    trace: 'on-first-retry',
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: useVitePreview
    ? {
        command: `${distReady ? '' : 'npm run build && '}npx vite preview --host 127.0.0.1 --port ${previewPort} --strictPort`,
        url: previewUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      }
    : undefined,
});
