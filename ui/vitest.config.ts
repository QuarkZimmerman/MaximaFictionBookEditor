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
