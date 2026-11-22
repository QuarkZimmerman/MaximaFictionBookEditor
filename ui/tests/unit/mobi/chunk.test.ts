// @vitest-environment node
/**
 * Feature 018 (T013, DP-1, FR-050): folder rules and production build guard for the MOBI lazy
 * chunks (`mobi-export`, `mobi-import`, `mobi-shared`, and neutral `ebook-shared`).
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

import {
  isEbookSharedModule,
  isEpubExportModule,
  isEpubImportModule,
  isMobiExportModule,
  isMobiImportModule,
  isMobiSharedModule,
} from '../../../vite.config';

const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MOBI = path.join(UI_ROOT, 'src', 'features', 'mobi');
const EBOOK_SHARED = path.join(UI_ROOT, 'src', 'features', 'ebookShared');

describe('the mobi and ebook-shared chunk rules', () => {
  it('capture export, import, mobi-shared, and ebook-shared folders without leaking static entries', () => {
    expect(isMobiExportModule(path.join(MOBI, 'export', 'job.ts'))).toBe(true);
    expect(isMobiImportModule(path.join(MOBI, 'export', 'job.ts'))).toBe(false);
    expect(isMobiImportModule(path.join(MOBI, 'import', 'job.ts'))).toBe(true);
    expect(isMobiExportModule(path.join(MOBI, 'import', 'job.ts'))).toBe(false);

    for (const staticFile of ['exportCommand.ts', 'importCommand.ts', 'MobiExportOptions.tsx']) {
      expect(isMobiExportModule(path.join(MOBI, staticFile)), staticFile).toBe(false);
      expect(isMobiImportModule(path.join(MOBI, staticFile)), staticFile).toBe(false);
      expect(isMobiSharedModule(path.join(MOBI, staticFile)), staticFile).toBe(false);
    }

    expect(isMobiSharedModule(path.join(MOBI, 'shared', 'words.ts'))).toBe(true);
    expect(isMobiSharedModule(path.join(MOBI, 'shared', 'format.ts'))).toBe(true);
    expect(isMobiExportModule(path.join(MOBI, 'shared', 'words.ts'))).toBe(false);
    expect(isMobiImportModule(path.join(MOBI, 'shared', 'words.ts'))).toBe(false);

    expect(isEbookSharedModule(path.join(EBOOK_SHARED, 'fbdMaker.ts'))).toBe(true);
    expect(isEbookSharedModule(path.join(EBOOK_SHARED, 'exportCss.ts'))).toBe(true);
    expect(isEbookSharedModule(path.join(EBOOK_SHARED, 'importCss.ts'))).toBe(true);
    expect(isEbookSharedModule(path.join(EBOOK_SHARED, 'svg.ts'))).toBe(true);
    expect(isEpubExportModule(path.join(EBOOK_SHARED, 'exportCss.ts'))).toBe(false);
    expect(isEpubImportModule(path.join(EBOOK_SHARED, 'importCss.ts'))).toBe(false);

    // Query suffixes and Windows separators do not break matching.
    expect(isMobiExportModule(`${path.join(MOBI, 'export', 'job.ts')}?v=1`)).toBe(true);
    expect(isMobiImportModule(path.join(MOBI, 'import', 'job.ts').replace(/\//g, '\\'))).toBe(true);
    expect(
      isMobiExportModule(path.join(UI_ROOT, 'src', 'dialogs', 'settings', 'MobiPage.tsx')),
    ).toBe(false);
  });
});

describe('the production build lazy boundaries for ebook-shared and mobi chunks', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'mfbe-ui-mobi-chunk-'));
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

  it('never loads ebook-shared, mobi-shared, mobi-export, or mobi-import at start-up', () => {
    const scripts = readdirSync(path.join(outDir, 'assets')).filter((name) => name.endsWith('.js'));
    const index = scripts.filter((name) => /^index-[\w-]+\.js$/.test(name));
    expect(index).toHaveLength(1);
    const indexSource = readFileSync(path.join(outDir, 'assets', index[0]!), 'utf8');
    const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');

    for (const chunkName of ['ebook-shared', 'mobi-shared', 'mobi-export', 'mobi-import']) {
      expect(indexSource, chunkName).not.toMatch(new RegExp(`from\\s*["'\`]\\./${chunkName}-`));
      expect(indexSource, chunkName).not.toMatch(new RegExp(`import\\s*["'\`]\\./${chunkName}-`));
      expect(html, chunkName).not.toContain(`${chunkName}-`);
    }

    // Once mobi-export / mobi-import chunks exist in the build, enforce strict isolation too.
    const mobiExport = scripts.find((name) => /^mobi-export-[\w-]+\.js$/.test(name));
    const mobiImport = scripts.find((name) => /^mobi-import-[\w-]+\.js$/.test(name));
    if (mobiExport) {
      const src = readFileSync(path.join(outDir, 'assets', mobiExport), 'utf8');
      expect(src).not.toContain('mobi-import-');
      expect(src).not.toContain('epub-export-');
      expect(src).not.toContain('epub-import-');
    }
    if (mobiImport) {
      const src = readFileSync(path.join(outDir, 'assets', mobiImport), 'utf8');
      expect(src).not.toContain('mobi-export-');
      expect(src).not.toContain('epub-export-');
      expect(src).not.toContain('epub-import-');
    }
  }, 30_000);
});
