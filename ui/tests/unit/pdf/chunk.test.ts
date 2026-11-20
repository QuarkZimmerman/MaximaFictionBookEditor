// @vitest-environment node
/**
 * Feature 014 (D24, plan DP-13, guard G20): the PDF export is the lazy chunk `pdf-export`. The folder
 * rule of vite.config.ts, and the outputs of a production build: the main bundle reaches the chunk
 * through one dynamic `import()` only, and the page loads neither the chunk nor the export's fonts.
 * The build goes to a temporary folder; `dist/` is untouched.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

import { isPdfExportModule, isPdfImportModule } from '../../../vite.config';

const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PDF = path.join(UI_ROOT, 'src', 'features', 'pdf');

describe('the pdf chunk rule', () => {
  it('captures the export folder, and nothing else', () => {
    expect(isPdfExportModule(path.join(PDF, 'export', 'job.ts'))).toBe(true);
    expect(isPdfExportModule(`${path.join(PDF, 'export', 'paginator.ts')}?v=1`)).toBe(true);
    for (const file of ['index.ts', 'pageSizes.ts', 'PageSizeDialog.tsx']) {
      expect(isPdfExportModule(path.join(PDF, file)), file).toBe(false);
    }
    expect(isPdfExportModule(path.join(UI_ROOT, 'src', 'model', 'store.ts'))).toBe(false);
  });
});

describe('the pdf-import chunk rule (feature 016, D29)', () => {
  it('captures the import folder, and neither the export nor the static entry', () => {
    expect(isPdfImportModule(path.join(PDF, 'import', 'job.ts'))).toBe(true);
    expect(isPdfImportModule(`${path.join(PDF, 'import', 'layout.ts')}?v=1`)).toBe(true);
    for (const file of ['index.ts', 'importCommand.ts', 'pageSizes.ts']) {
      expect(isPdfImportModule(path.join(PDF, file)), file).toBe(false);
    }
    expect(isPdfImportModule(path.join(PDF, 'export', 'job.ts'))).toBe(false);
    expect(isPdfExportModule(path.join(PDF, 'import', 'job.ts'))).toBe(false);
  });
});

describe('the production build', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'mfbe-ui-pdf-chunk-'));
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

  it('emits one pdf-export chunk, reached lazily only', () => {
    const scripts = readdirSync(path.join(outDir, 'assets')).filter((name) => name.endsWith('.js'));
    const index = scripts.filter((name) => /^index-[\w-]+\.js$/.test(name));
    expect(index).toHaveLength(1);
    const indexSource = readFileSync(path.join(outDir, 'assets', index[0]!), 'utf8');
    const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
    const chunk = scripts.filter((name) => /^pdf-export-[\w-]+\.js$/.test(name));
    expect(chunk).toHaveLength(1);
    const dynamicImports = indexSource.match(/import\((["'`])\.\/pdf-export-[\w-]+\.js\1\)/g) ?? [];
    expect(dynamicImports).toHaveLength(1);
    expect(indexSource).not.toMatch(/from\s*["'`]\.\/pdf-export-/);
    expect(indexSource).not.toMatch(/import\s*["'`]\.\/pdf-export-/);
    expect(html).not.toContain('pdf-export-');
    // Feature 016 (D29): the import is a chunk of its own, reached lazily only, apart from the export.
    const importChunk = scripts.filter((name) => /^pdf-import-[\w-]+\.js$/.test(name));
    expect(importChunk).toHaveLength(1);
    const importImports = indexSource.match(/import\((["'`])\.\/pdf-import-[\w-]+\.js\1\)/g) ?? [];
    expect(importImports).toHaveLength(1);
    expect(indexSource).not.toMatch(/from\s*["'`]\.\/pdf-import-/);
    expect(html).not.toContain('pdf-import-');
    // The export's fonts are served by the core when a paged document asks for them, never here.
    expect(indexSource).not.toContain('/pdf/fonts/shipped/');
  }, 30_000);
});
