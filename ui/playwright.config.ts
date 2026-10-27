import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

import type { CoreOptions } from './tests/e2e/fixtures/core';

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

export default defineConfig<CoreOptions>({
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
    {
      // The main journeys again with the Russian interface (feature 002); the divider journey
      // (feature 004 US1) proves the view's minimum width against each language's switcher,
      // the file-name journey (feature 004 US6) the interface language's "Untitled", the AI
      // settings journey (feature 005 US1) the limits notes and radio labels of each language,
      // the privacy journey (feature 005 US7) the offline failure text of each language (SC-010),
      // the table journey (feature 006 US1, C78) the Table properties dialog's labels and the
      // unavailable titles of each language, the layout journey of pictures in cells (feature
      // 006 US3, its test 8) the placeholders' text in each language, the irregular-table marks
      // (feature 006 US8, C78) the marks' names and tooltips, the tree marks and the warnings of
      // Validate in each language.
      name: 'chromium-ru',
      testMatch: [
        'us1-open-save.spec.ts',
        'us1-tree-divider.spec.ts',
        'us2-body-editing.spec.ts',
        'us2-template.spec.ts',
        'us5-find-modeless.spec.ts',
        'us6-file-names.spec.ts',
        'us8-toolbars.spec.ts',
        'us12-scripts.spec.ts',
        'us1-ai-settings.spec.ts',
        'us7-ai-privacy.spec.ts',
        'us1-table-create.spec.ts',
        'us3-table-images-layout.spec.ts',
        'us8-table-marks.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], locale: 'ru-RU', uiLang: 'ru' },
    },
    {
      // ... and with the Ukrainian interface (feature 003, FR-005): the same journeys as the
      // Russian project, started with `?lang=uk` on a Ukrainian browser locale.
      name: 'chromium-uk',
      testMatch: [
        'us1-open-save.spec.ts',
        'us1-tree-divider.spec.ts',
        'us2-body-editing.spec.ts',
        'us2-template.spec.ts',
        'us5-find-modeless.spec.ts',
        'us6-file-names.spec.ts',
        'us8-toolbars.spec.ts',
        'us12-scripts.spec.ts',
        'us1-ai-settings.spec.ts',
        'us7-ai-privacy.spec.ts',
        'us1-table-create.spec.ts',
        'us3-table-images-layout.spec.ts',
        'us8-table-marks.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], locale: 'uk-UA', uiLang: 'uk' },
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
