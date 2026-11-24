import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// The bundle's version (`ctx.version`: About's fallback, the version check's running version):
// the version label the CMake build passes as MFBE_UI_VERSION (ui/CMakeLists.txt; 0.0.6-rc, or
// 0.0.6-rc.N from a release tag - feature 006), else the package's own version, as for a plain
// `npm run build`.
const uiVersion = process.env.MFBE_UI_VERSION || pkg.version;

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

// The EPUB import and export (feature 012, D32) are two lazy chunks, `epub-import` and
// `epub-export`, each loaded by `import()` on its first use and never at start-up or with the
// other. Folder rules again: everything under `src/features/epub/import/` and
// `src/features/epub/export/`. The tables both parts read (`src/features/epub/shared/`) form a third
// small chunk, `epub-shared`, loaded with whichever part needs it and never at start-up; without
// it, rolldown names the export's dynamic import after a facade chunk (`job-*.js`) instead of the
// part. The static entry (`src/features/epub/index.ts`) stays in the main bundle.
// `tests/unit/epub/chunk.test.ts` checks the built output (guard G16).
const epubImportFolder = fileURLToPath(
  new URL('./src/features/epub/import/', import.meta.url),
).replace(/\\/g, '/');
const epubExportFolder = fileURLToPath(
  new URL('./src/features/epub/export/', import.meta.url),
).replace(/\\/g, '/');
const epubSharedFolder = fileURLToPath(
  new URL('./src/features/epub/shared/', import.meta.url),
).replace(/\\/g, '/');

/** True for a module of the `epub-shared` chunk (exported for the unit test of the rule). */
export function isEpubSharedModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').startsWith(epubSharedFolder);
}

/** True for a module of the `epub-import` chunk (exported for the unit test of the rule). */
export function isEpubImportModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').startsWith(epubImportFolder);
}

// The PDF export (feature 014, D24, plan DP-13) is the lazy chunk `pdf-export`: everything under
// `src/features/pdf/export/`, loaded by `import()` on the first export and never at start-up. The
// static entry (`src/features/pdf/index.ts`, `pageSizes.ts`) and the settings page stay in the main
// bundle. `tests/unit/pdf/chunk.test.ts` checks the built output (guard G20).
const pdfExportFolder = fileURLToPath(
  new URL('./src/features/pdf/export/', import.meta.url),
).replace(/\\/g, '/');

/** True for a module of the `pdf-export` chunk (exported for the unit test of the rule). */
export function isPdfExportModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').startsWith(pdfExportFolder);
}

// The PDF import (feature 016, D29, plan DP-10) is the lazy chunk `pdf-import`: everything under
// `src/features/pdf/import/`, loaded by `import()` on the first import and never at start-up, apart from
// `pdf-export`. The static entry (`src/features/pdf/importCommand.ts`) stays in the main bundle.
// `tests/unit/pdf/import/chunk.test.ts` checks the built output.
const pdfImportFolder = fileURLToPath(
  new URL('./src/features/pdf/import/', import.meta.url),
).replace(/\\/g, '/');

/** True for a module of the `pdf-import` chunk (exported for the unit test of the rule). */
export function isPdfImportModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').startsWith(pdfImportFolder);
}

// Feature 017 (D15, D38, DP-1): the TXT export and import are the lazy chunks `txt-export` and
// `txt-import`: everything under `src/features/txt/export/` and `src/features/txt/import/`, loaded by
// `import()` at their first use and never at start-up. The static entries (`src/features/txt/
// exportCommand.ts`, `importCommand.ts`, `encodings.ts`, `TxtExportOptions.tsx`) stay in the main bundle.
// `tests/unit/txt/chunk.test.ts` checks the rules.
const txtExportFolder = fileURLToPath(
  new URL('./src/features/txt/export/', import.meta.url),
).replace(/\\/g, '/');
const txtImportFolder = fileURLToPath(
  new URL('./src/features/txt/import/', import.meta.url),
).replace(/\\/g, '/');

/** True for a module of the `txt-export` chunk (exported for the unit test of the rule). */
export function isTxtExportModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').startsWith(txtExportFolder);
}

/** True for a module of the `txt-import` chunk (exported for the unit test of the rule). */
export function isTxtImportModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').startsWith(txtImportFolder);
}

// What both TXT parts read - the words of the record (`src/features/txt/shared/`) - is the lazy chunk
// `txt-shared`, as the EPUB parts' `epub-shared`.
const txtSharedFolder = fileURLToPath(
  new URL('./src/features/txt/shared/', import.meta.url),
).replace(/\\/g, '/');

/** True for a module of the `txt-shared` chunk (exported for the unit test of the rule). */
export function isTxtSharedModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').startsWith(txtSharedFolder);
}

// Feature 017 (D34, D39): what every lazy import shares that the main bundle never reaches - an FBD read and
// given to the new book (`src/features/importShared/`) - is the lazy chunk `import-shared`.
const importSharedFolder = fileURLToPath(
  new URL('./src/features/importShared/', import.meta.url),
).replace(/\\/g, '/');

/** True for a module of the `import-shared` chunk (exported for the unit test of the rule). */
export function isImportSharedModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').startsWith(importSharedFolder);
}

// Feature 017 (DP-13): text helpers the lazy imports share - the joining of words broken at a line's end
// (`src/features/text/`) - are the lazy chunk `text-shared`, which the `pdf-import` and `txt-import` chunks
// import; never reached from the main bundle.
const textSharedFolder = fileURLToPath(new URL('./src/features/text/', import.meta.url)).replace(
  /\\/g,
  '/',
);

/** True for a module of the `text-shared` chunk (exported for the unit test of the rule). */
export function isTextSharedModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').startsWith(textSharedFolder);
}

/** True for a module of the `epub-export` chunk (exported for the unit test of the rule). */
export function isEpubExportModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').startsWith(epubExportFolder);
}

// Feature 018 (DP-1, FR-050): MOBI export and import are two lazy chunks (`mobi-export`,
// `mobi-import`), plus small lazy helpers `mobi-shared` and neutral `ebook-shared` (shared by EPUB
// and MOBI without coupling the two format chunks). Static entries (`exportCommand.ts`,
// `importCommand.ts`, `MobiExportOptions.tsx`) and `MobiPage.tsx` stay in the main bundle.
const mobiExportFolder = fileURLToPath(
  new URL('./src/features/mobi/export/', import.meta.url),
).replace(/\\/g, '/');
const mobiImportFolder = fileURLToPath(
  new URL('./src/features/mobi/import/', import.meta.url),
).replace(/\\/g, '/');
const mobiSharedFolder = fileURLToPath(
  new URL('./src/features/mobi/shared/', import.meta.url),
).replace(/\\/g, '/');
const ebookSharedFolder = fileURLToPath(
  new URL('./src/features/ebookShared/', import.meta.url),
).replace(/\\/g, '/');

/** True for a module of the `mobi-export` chunk (exported for the unit test of the rule). */
export function isMobiExportModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').startsWith(mobiExportFolder);
}

/** True for a module of the `mobi-import` chunk (exported for the unit test of the rule). */
export function isMobiImportModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').startsWith(mobiImportFolder);
}

/** True for a module of the `mobi-shared` chunk (exported for the unit test of the rule). */
export function isMobiSharedModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').startsWith(mobiSharedFolder);
}

/** True for a module of the neutral `ebook-shared` chunk (exported for the unit test of the rule). */
export function isEbookSharedModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').startsWith(ebookSharedFolder);
}

// Feature 019 (DP-6, FR-022): Batch Converter lives in the lazy chunk `batch-converter`; only
// `src/features/batch/index.ts` (static Tools menu command registration) stays in the main bundle.
const batchFolder = fileURLToPath(new URL('./src/features/batch/', import.meta.url)).replace(
  /\\/g,
  '/',
);
const batchStaticModules = new Set(['index.ts']);

/** True for a module of the `batch-converter` chunk (exported for the unit test of the rule). */
export function isBatchConverterModule(id: string): boolean {
  const path = id.split('?')[0].replace(/\\/g, '/');
  if (!path.startsWith(batchFolder)) return false;
  return !batchStaticModules.has(path.slice(batchFolder.length));
}

// Kept as a plain object (not a callback) so vitest.config.ts can merge it.
export default defineConfig({
  plugins: [
    react(),
    {
      // The version the bundle is compiled with (`__MFBE_UI_VERSION__`), also as a file of the
      // bundle: the one source the tests that compare with it read (guard G5), so a test always
      // compares with the version of the build it runs against.
      name: 'mfbe-version-file',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: `${JSON.stringify({ version: uiVersion })}\n`,
        });
      },
    },
  ],
  // The core serves the bundle from a sub-path, so every asset URL must be relative.
  base: './',
  resolve: {
    alias: [
      // Feature 011 (D49): Mermaid's optional ELK layout (elkjs, EPL-2.0) is not shipped.
      {
        find: /^elkjs\/lib\/elk\.bundled\.js$/,
        replacement: fileURLToPath(
          new URL('./src/features/markdown/diagrams/elkUnavailable.ts', import.meta.url),
        ),
      },
      // Feature 011 (D50): MathJax's interactive menu is not used and not shipped.
      {
        find: /^mj-context-menu(\/.*)?$/,
        replacement: fileURLToPath(
          new URL('./src/features/markdown/diagrams/menuUnavailable.ts', import.meta.url),
        ),
      },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
  define: {
    __MFBE_TOKEN__: JSON.stringify(process.env.MFBE_TOKEN ?? ''),
    __MFBE_UI_VERSION__: JSON.stringify(uiVersion),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // The editor's own core serves the bundle from the local disk, so a chunk's size is no download
    // cost (the main bundle of about 2.3 MB starts in about 200 ms, feature 011's measurement); the
    // warning is kept for a chunk that grows past that.
    chunkSizeWarningLimit: 2600,
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
            {
              name: 'epub-import',
              test: isEpubImportModule,
              includeDependenciesRecursively: false,
            },
            {
              name: 'epub-export',
              test: isEpubExportModule,
              includeDependenciesRecursively: false,
            },
            {
              name: 'epub-shared',
              test: isEpubSharedModule,
              includeDependenciesRecursively: false,
            },
            {
              name: 'pdf-export',
              test: isPdfExportModule,
              includeDependenciesRecursively: false,
            },
            {
              name: 'pdf-import',
              test: isPdfImportModule,
              includeDependenciesRecursively: false,
            },
            {
              name: 'txt-export',
              test: isTxtExportModule,
              includeDependenciesRecursively: false,
            },
            {
              name: 'txt-import',
              test: isTxtImportModule,
              includeDependenciesRecursively: false,
            },
            {
              name: 'txt-shared',
              test: isTxtSharedModule,
              includeDependenciesRecursively: false,
            },
            {
              name: 'text-shared',
              test: isTextSharedModule,
              includeDependenciesRecursively: false,
            },
            {
              name: 'import-shared',
              test: isImportSharedModule,
              includeDependenciesRecursively: false,
            },
            {
              name: 'ebook-shared',
              test: isEbookSharedModule,
              includeDependenciesRecursively: false,
            },
            {
              name: 'mobi-export',
              test: isMobiExportModule,
              includeDependenciesRecursively: false,
            },
            {
              name: 'mobi-import',
              test: isMobiImportModule,
              includeDependenciesRecursively: false,
            },
            {
              name: 'mobi-shared',
              test: isMobiSharedModule,
              includeDependenciesRecursively: false,
            },
            {
              name: 'batch-converter',
              test: isBatchConverterModule,
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
