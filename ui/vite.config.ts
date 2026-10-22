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
// the agreements and the test hooks); so do the MCP SDK packages and their production
// transitives (the closure of the three exact pins in package-lock.json). Everything else - the
// settings page included, it lives outside the folder - stays in the main `index-*.js`.
const aiFolder = fileURLToPath(new URL('./src/ai/', import.meta.url)).replace(/\\/g, '/');
const aiStaticModules = new Set(['index.ts', 'address.ts', 'agreements.ts', 'testHooks.ts']);
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

function aiAssistantChunk(id: string): string | undefined {
  // Module ids may carry a query (`?raw`, `?worker`, …) and, on Windows, backslashes.
  const path = id.split('?')[0].replace(/\\/g, '/');
  if (path.startsWith(aiFolder)) {
    return aiStaticModules.has(path.slice(aiFolder.length)) ? undefined : 'ai-assistant';
  }
  const marker = '/node_modules/';
  const index = path.lastIndexOf(marker);
  if (index >= 0) {
    const packagePath = path.slice(index + marker.length);
    if (aiPackages.some((prefix) => packagePath.startsWith(prefix))) return 'ai-assistant';
  }
  return undefined;
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
    rollupOptions: {
      output: {
        // A function, not a map: the chunk exists only once a module matches, so a build
        // without AI modules emits no empty `ai-assistant-*.js`.
        manualChunks: aiAssistantChunk,
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
