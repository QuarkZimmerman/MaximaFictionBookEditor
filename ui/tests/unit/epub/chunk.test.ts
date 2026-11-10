// @vitest-environment node
/**
 * Feature 012 (D32, research DP-1, guard G16): the EPUB import and export are two lazy chunks,
 * `epub-import` and `epub-export`. The folder rules of vite.config.ts, and the outputs of a
 * production build: the main bundle reaches each chunk through one dynamic `import()` only, the
 * page loads neither, and neither chunk imports the other. The build goes to a temporary folder;
 * `dist/` is untouched.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

import { isEpubExportModule, isEpubImportModule } from '../../../vite.config';

const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EPUB = path.join(UI_ROOT, 'src', 'features', 'epub');

describe('the epub chunk rules', () => {
  it('capture the import and export folders, and nothing else', () => {
    expect(isEpubImportModule(path.join(EPUB, 'import', 'job.ts'))).toBe(true);
    expect(isEpubExportModule(path.join(EPUB, 'import', 'job.ts'))).toBe(false);
    expect(isEpubExportModule(path.join(EPUB, 'export', 'job.ts'))).toBe(true);
    expect(isEpubImportModule(path.join(EPUB, 'export', 'job.ts'))).toBe(false);
    for (const file of ['index.ts', 'shared/words.ts', 'shared/fbdMaker.ts']) {
      expect(isEpubImportModule(path.join(EPUB, file)), file).toBe(false);
      expect(isEpubExportModule(path.join(EPUB, file)), file).toBe(false);
    }
    // A query suffix and Windows separators do not change the answer.
    expect(isEpubImportModule(`${path.join(EPUB, 'import', 'job.ts')}?v=1`)).toBe(true);
    expect(isEpubExportModule(path.join(EPUB, 'export', 'job.ts').replace(/\//g, '\\'))).toBe(true);
    expect(isEpubImportModule(path.join(UI_ROOT, 'src', 'model', 'store.ts'))).toBe(false);
  });
});

describe('the production build', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'mfbe-ui-epub-chunk-'));
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

  it('emits one epub-import and one epub-export chunk, each reached lazily only', () => {
    const scripts = readdirSync(path.join(outDir, 'assets')).filter((name) => name.endsWith('.js'));
    const index = scripts.filter((name) => /^index-[\w-]+\.js$/.test(name));
    expect(index).toHaveLength(1);
    const indexSource = readFileSync(path.join(outDir, 'assets', index[0]!), 'utf8');
    const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
    const sources: Record<string, string> = {};
    for (const part of ['epub-import', 'epub-export']) {
      const chunk = scripts.filter((name) => new RegExp(`^${part}-[\\w-]+\\.js$`).test(name));
      expect(chunk, part).toHaveLength(1);
      sources[part] = readFileSync(path.join(outDir, 'assets', chunk[0]!), 'utf8');
      // One dynamic import from the main bundle (the command's first run), never a static one.
      const dynamicImports =
        indexSource.match(new RegExp(`import\\((["'\`])\\./${part}-[\\w-]+\\.js\\1\\)`, 'g')) ?? [];
      expect(dynamicImports, part).toHaveLength(1);
      expect(indexSource).not.toMatch(new RegExp(`from\\s*["'\`]\\./${part}-`));
      expect(indexSource).not.toMatch(new RegExp(`import\\s*["'\`]\\./${part}-`));
      // The page loads the main bundle only: no script tag and no modulepreload for the chunk.
      expect(html).not.toContain(`${part}-`);
    }
    // Neither part loads the other (D32).
    expect(sources['epub-import']).not.toContain('epub-export-');
    expect(sources['epub-export']).not.toContain('epub-import-');
  }, 30_000);
});
