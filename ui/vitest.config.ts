import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // import.meta.glob of the i18n catalogues must see new feature files immediately
      fsModuleCache: false,
      environment: 'jsdom',
      globals: true,
      // Hosted CI runners are several times slower than the development host.
      testTimeout: process.env.CI ? 30_000 : 5_000,
      hookTimeout: process.env.CI ? 30_000 : 10_000,
      setupFiles: ['tests/unit/setup.ts'],
      // Vitest replaces CSS with empty strings unless it processes the file (its `css` option,
      // default `{ include: [] }`): Preview's base sheet is read as text (`?raw`) by the code
      // under test, so its tests see the same sheet the build ships (feature 011, US10).
      css: { include: [/readerBase\.css/] },
      include: ['tests/unit/**/*.test.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        reportsDirectory: 'coverage',
        reporter: ['text', 'html', 'lcov'],
        include: ['src/**/*.{ts,tsx}'],
      },
    },
  }),
);
