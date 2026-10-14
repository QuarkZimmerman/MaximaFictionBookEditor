import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// A running core (`mfbe-core serve`) to proxy API traffic to while developing with `vite dev`.
const core = process.env.MFBE_CORE ?? 'http://127.0.0.1:41237';

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
