import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.ts';

// Feature 011 (FR-081): the corpus Markdown round trip (tests/corpus/run.sh --markdown); it starts the
// real core and runs as long as the sample needs.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['tests/corpus/**/*.test.ts'],
      testTimeout: 0,
      hookTimeout: 0,
    },
  }),
);
