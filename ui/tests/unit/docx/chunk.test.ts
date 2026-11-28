// @vitest-environment node
/**
 * Feature 023 (T043; DP-1, FR-003): folder rules and production build guard for the DOCX lazy
 * chunks (`docx-export`, `docx-import`, `docx-shared`). Verifies they never load at startup and
 * never cross-import `epub-*`, `mobi-*`, or `pdf-*` chunks.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isDocxExportModule, isDocxImportModule, isDocxSharedModule } from '../../../vite.config';

const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DOCX = path.join(UI_ROOT, 'src', 'features', 'docx');

describe('DOCX lazy chunk rules', () => {
  it('capture export, import, and shared folders without leaking static entries or Settings page', () => {
    expect(isDocxExportModule(path.join(DOCX, 'export', 'docxExportJob.ts'))).toBe(true);
    expect(isDocxImportModule(path.join(DOCX, 'export', 'docxExportJob.ts'))).toBe(false);
    expect(isDocxImportModule(path.join(DOCX, 'import', 'docxImportJob.ts'))).toBe(true);
    expect(isDocxExportModule(path.join(DOCX, 'import', 'docxImportJob.ts'))).toBe(false);
    expect(isDocxSharedModule(path.join(DOCX, 'shared', 'docxWords.ts'))).toBe(true);
    expect(isDocxSharedModule(path.join(DOCX, 'shared', 'docxRoundtripTypes.ts'))).toBe(true);

    for (const staticFile of [
      'exportCommand.ts',
      'importCommand.ts',
      'DocxExportOptions.tsx',
      'docxSettingsSchema.ts',
    ]) {
      expect(isDocxExportModule(path.join(DOCX, staticFile)), staticFile).toBe(false);
      expect(isDocxImportModule(path.join(DOCX, staticFile)), staticFile).toBe(false);
      expect(isDocxSharedModule(path.join(DOCX, staticFile)), staticFile).toBe(false);
    }

    expect(
      isDocxExportModule(path.join(UI_ROOT, 'src', 'dialogs', 'settings', 'DocxPage.tsx')),
    ).toBe(false);
    expect(isDocxExportModule(`${path.join(DOCX, 'export', 'docxExportJob.ts')}?v=1`)).toBe(true);
    expect(
      isDocxImportModule(path.join(DOCX, 'import', 'docxImportJob.ts').replace(/\//g, '\\')),
    ).toBe(true);
  });
});

describe('production build lazy boundaries for docx chunks', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'mfbe-ui-docx-chunk-'));
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

  it('never loads docx-shared, docx-export, or docx-import at startup and keeps them isolated from epub/mobi/pdf chunks', () => {
    const scripts = readdirSync(path.join(outDir, 'assets')).filter((name) => name.endsWith('.js'));
    const index = scripts.filter((name) => /^index-[\w-]+\.js$/.test(name));
    expect(index).toHaveLength(1);
    const indexSource = readFileSync(path.join(outDir, 'assets', index[0]!), 'utf8');
    const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');

    for (const chunkName of ['docx-shared', 'docx-export', 'docx-import']) {
      expect(indexSource, chunkName).not.toMatch(new RegExp(`from\\s*["'\`]\\./${chunkName}-`));
      expect(indexSource, chunkName).not.toMatch(new RegExp(`import\\s*["'\`]\\./${chunkName}-`));
      expect(html, chunkName).not.toContain(`${chunkName}-`);
    }

    const docxExport = scripts.find((name) => /^docx-export-[\w-]+\.js$/.test(name));
    const docxImport = scripts.find((name) => /^docx-import-[\w-]+\.js$/.test(name));
    expect(docxExport).toBeTruthy();
    expect(docxImport).toBeTruthy();

    const forbiddenCross = [
      'epub-export-',
      'epub-import-',
      'mobi-export-',
      'mobi-import-',
      'pdf-export-',
      'pdf-import-',
    ];

    const exportSrc = readFileSync(path.join(outDir, 'assets', docxExport!), 'utf8');
    expect(exportSrc).not.toContain('docx-import-');
    for (const bad of forbiddenCross) expect(exportSrc).not.toContain(bad);

    const importSrc = readFileSync(path.join(outDir, 'assets', docxImport!), 'utf8');
    expect(importSrc).not.toContain('docx-export-');
    for (const bad of forbiddenCross) expect(importSrc).not.toContain(bad);
  }, 30_000);
});
