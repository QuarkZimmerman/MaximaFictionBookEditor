// @vitest-environment node
/**
 * Feature 019 (T058; US6, FR-022): folder rules and production build guard for the Batch Converter
 * lazy chunk (`batch-converter`). Proves:
 *  1. `index-*.js` and `index.html` never statically import `batch-converter`.
 *  2. `batch-converter-*.js` never statically imports any format converter chunk (`epub-*`,
 *     `mobi-*`, `pdf-*`, `txt-*`, `import-shared`, `ebook-shared`, `text-shared`).
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

import { isBatchConverterModule } from '../../../vite.config';

const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BATCH = path.join(UI_ROOT, 'src', 'features', 'batch');

describe('the batch-converter chunk rules', () => {
  it('captures every batch module except static index.ts', () => {
    expect(isBatchConverterModule(path.join(BATCH, 'index.ts'))).toBe(false);
    expect(isBatchConverterModule(path.join(BATCH, 'openDialog.ts'))).toBe(true);
    expect(isBatchConverterModule(path.join(BATCH, 'BatchConverterDialog.tsx'))).toBe(true);
    expect(isBatchConverterModule(path.join(BATCH, 'engine', 'scheduler.ts'))).toBe(true);
    expect(isBatchConverterModule(path.join(BATCH, 'adapters', 'fb2ToEpub.ts'))).toBe(true);
    expect(isBatchConverterModule(path.join(BATCH, 'adapters', 'pdfToFb2.ts'))).toBe(true);

    // Query suffixes and Windows separators do not break matching.
    expect(isBatchConverterModule(`${path.join(BATCH, 'openDialog.ts')}?v=1`)).toBe(true);
    expect(isBatchConverterModule(path.join(BATCH, 'engine', 'paths.ts').replace(/\//g, '\\'))).toBe(
      true,
    );
    expect(isBatchConverterModule(path.join(UI_ROOT, 'src', 'app', 'menus.ts'))).toBe(false);
  });
});

describe('the production build lazy boundaries for batch-converter', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'mfbe-ui-batch-chunk-'));
    await build({
      root: UI_ROOT,
      configFile: path.join(UI_ROOT, 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true, sourcemap: false, write: true },
    });
  }, 120_000);

  afterAll(() => {
    if (outDir && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  });

  it('never loads batch-converter at start-up and never statically couples batch-converter to format chunks', () => {
    const scripts = readdirSync(path.join(outDir, 'assets')).filter((name) => name.endsWith('.js'));
    const index = scripts.filter((name) => /^index-[\w-]+\.js$/.test(name));
    expect(index).toHaveLength(1);
    const indexSource = readFileSync(path.join(outDir, 'assets', index[0]!), 'utf8');
    const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');

    // Main entry and index.html must never statically import batch-converter.
    expect(indexSource).not.toMatch(/from\s*["'`]\.\/batch-converter-/);
    expect(indexSource).not.toMatch(/import\s*["'`]\.\/batch-converter-/);
    expect(html).not.toContain('batch-converter-');

    // batch-converter chunk must exist and must never statically import any format converter chunk.
    const batchChunk = scripts.find((name) => /^batch-converter-[\w-]+\.js$/.test(name));
    expect(batchChunk).toBeDefined();
    const batchSource = readFileSync(path.join(outDir, 'assets', batchChunk!), 'utf8');

    const forbiddenStaticChunks = [
      'epub-export',
      'epub-import',
      'epub-shared',
      'mobi-export',
      'mobi-import',
      'mobi-shared',
      'ebook-shared',
      'pdf-export',
      'pdf-import',
      'txt-export',
      'txt-import',
      'txt-shared',
      'text-shared',
      'import-shared',
    ];
    for (const chunkName of forbiddenStaticChunks) {
      expect(batchSource, `static from ${chunkName}`).not.toMatch(
        new RegExp(`from\\s*["'\`]\\./${chunkName}-`),
      );
      expect(batchSource, `static side-effect import ${chunkName}`).not.toMatch(
        new RegExp(`import\\s*["'\`]\\./${chunkName}-`),
      );
    }
  }, 30_000);
});
