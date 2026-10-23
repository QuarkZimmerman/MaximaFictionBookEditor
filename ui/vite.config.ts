import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// A running core (`mfbe-core serve`) to proxy API traffic to while developing with `vite dev`.
const core = process.env.MFBE_CORE ?? 'http://127.0.0.1:41237';

// The AI assistant (feature 005) is a lazy chunk, `ai-assistant`, loaded by `import()` on the
// first turn-on only, so that nothing of it is requested while the assistant is off or disabled
// (SC-013). A folder rule, not a list of modules: every module under `src/ai/` goes into the
// chunk except the static set the main bundle imports directly (the entry, the address helpers,
// the agreements, the test hooks and the inert panel of the Disabled state - FR-096: shown
// without the chunk); so do the MCP SDK packages and their production
// transitives (the closure of the three exact pins in package-lock.json). Everything else - the
// settings page included, it lives outside the folder - stays in the main `index-*.js`. The
// rule is a rolldown code-splitting group with `includeDependenciesRecursively: false`: the
// default (and the `manualChunks` compatibility path) would drag the matched modules'
// dependencies - the store, React - into the chunk and make `index-*.js` import it statically,
// the opposite of lazy. `tests/unit/ai/chunk.test.ts` checks the built output.
const aiFolder = fileURLToPath(new URL('./src/ai/', import.meta.url)).replace(/\\/g, '/');
const aiStaticModules = new Set([
  'index.ts',
  'address.ts',
  'agreements.ts',
  'testHooks.ts',
  'DisabledPanel.tsx',
]);
// The texts the catalogue bundles as `?raw` resources (US6: the script API description, the
// scripting guide, the example script) - read by the chunk alone, so they travel with it.
const repoRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/');
const aiRawFolders = [`${repoRoot}docs/scripting/`, `${repoRoot}scripts/`];
const aiPackages = [
  '@modelcontextprotocol/',
  'zod/',
  'eventsource/',
  'eventsource-parser/',
  'jose/',
  'pkce-challenge/',
  'cross-spawn/',
  'which/',
  'isexe/',
  'path-key/',
  'shebang-command/',
  'shebang-regex/',
];

/** True for a module of the `ai-assistant` chunk (exported for the unit test of the rule). */
export function isAiAssistantModule(id: string): boolean {
  // Module ids may carry a query (`?raw`, `?worker`, …) and, on Windows, backslashes.
  const path = id.split('?')[0].replace(/\\/g, '/');
  if (path.startsWith(aiFolder)) {
    return !aiStaticModules.has(path.slice(aiFolder.length));
  }
  if (id.includes('?raw') && aiRawFolders.some((folder) => path.startsWith(folder))) return true;
  const marker = '/node_modules/';
  const index = path.lastIndexOf(marker);
  if (index >= 0) {
    const packagePath = path.slice(index + marker.length);
    return aiPackages.some((prefix) => packagePath.startsWith(prefix));
  }
  return false;
}

// Kept as a plain object (not a callback) so vitest.config.ts can merge it.
export default defineConfig({
  plugins: [react()],
  // The core serves the bundle from a sub-path, so every asset URL must be relative.
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __MFBE_TOKEN__: JSON.stringify(process.env.MFBE_TOKEN ?? ''),
    __MFBE_UI_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'ai-assistant',
              test: isAiAssistantModule,
              // The matched modules only: their shared dependencies stay in the main bundle,
              // which the chunk imports (not the other way round).
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // The About dialog bundles the original's contributor notice from the repository root
    // (`?raw` imports are checked by folder, so the folder is allowed, as for a workspace).
    fs: {
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
    proxy: {
      '/rpc': { target: core, ws: true },
      '/binary': { target: core },
      '/scripts': { target: core },
      '/health': { target: core },
    },
  },
});
