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

import { isPdfExportModule } from '../../../vite.config';

const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PDF = path.join(UI_ROOT, 'src', 'features', 'pdf');

describe('the pdf chunk rule', () => {
  it('captures the export folder, and nothing else', () => {
    expect(isPdfExportModule(path.join(PDF, 'export', 'job.ts'))).toBe(true);
    expect(isPdfExportModule(`${path.join(PDF, 'export', 'paginator.ts')}?v=1`)).toBe(true);
    for (const file of ['index.ts', 'pageSizes.ts', 'PageSizeDialog.tsx', 'keptPageSize.ts']) {
      expect(isPdfExportModule(path.join(PDF, file)), file).toBe(false);
    }
    expect(isPdfExportModule(path.join(UI_ROOT, 'src', 'model', 'store.ts'))).toBe(false);
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
    // The export's fonts are served by the core when a paged document asks for them, never here.
    expect(indexSource).not.toContain('/pdf/fonts/shipped/');
  }, 30_000);
});
