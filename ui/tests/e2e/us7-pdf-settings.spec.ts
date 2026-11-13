/**
 * Feature 014, User Story 7 (tasks T048): Settings > PDF export.
 * - A fresh settings file shows the defaults, each with a Reset, and Reset all (scenario 1, DP-5).
 * - Each shipped text family prints the book; titles set in "Arial, sans-serif" keep their kind,
 *   code stays monospace (scenarios 2, 8).
 * - A font file is added and printed - whole when its licence forbids subsetting (R6) - and still
 *   used after its original is deleted; a restricted font and a file that is no font are refused
 *   with their reason (scenarios 3, 4, 7).
 * - A Russian book in an added font without Cyrillic lists the letters the shipped fonts drew
 *   (scenario 5).
 * - Larger text and narrow margins give larger text in a wider text area (scenario 6; all nine sizes
 *   in ui/tests/unit/pdf/lineLength.test.ts).
 * - An installed font is added through the Local Font Access API (DP-4).
 * The exported files go to build/pdf-export/, where CI's veraPDF step checks them.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, type CoreHandle } from './fixtures/core';
import { exportPdfTo, openFixtureBook } from './fixtures/pdfExport';
import { startPrintSeam } from './fixtures/printSeam';
import { scratchDir } from './fixtures/scratch';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'build', 'pdf-export');
const FONTS = path.join(ROOT, 'resources', 'fonts');
const A5 = 'A5 (148 × 210 mm)';

interface AddedFont {
  id: string;
  family: string;
  kind: string;
  wholeFont: boolean;
}

/** A copy of a shipped font file whose OS/2 fsType is `fsType` (offset 8 of the table). */
function withFsType(file: string, fsType: number, target: string): string {
  const bytes = Buffer.from(readFileSync(path.join(FONTS, file)));
  for (let i = 0, n = bytes.readUInt16BE(4); i < n; i++) {
    const entry = 12 + 16 * i;
    if (bytes.toString('latin1', entry, entry + 4) === 'OS/2') {
      bytes.writeUInt16BE(fsType, bytes.readUInt32BE(entry + 8) + 8);
    }
  }
  writeFileSync(target, bytes);
  return target;
}

/** The names of the fonts a PDF embeds, without their subset tags, and whether each is a subset. */
function embedded(file: string): Map<string, boolean> {
  const text = readFileSync(file).toString('latin1');
  const fonts = new Map<string, boolean>();
  for (const m of text.matchAll(/\/FontName\s*\/(?:([A-Z]{6})\+)?([A-Za-z0-9-]+)/g)) {
    fonts.set(m[2], fonts.get(m[2]) === false ? false : !!m[1]);
  }
  return fonts;
}

async function setPdf(core: CoreHandle, page: Page, patch: Record<string, string>): Promise<void> {
  await core.rpc('settings.set', { patch: { pdf: patch } });
  // The window takes the settings the core announces (settings.changed).
  await page.waitForTimeout(200);
}

async function openSettingsPage(page: Page): Promise<void> {
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-settings').click();
  await expect(page.getByTestId('dialog-settings')).toBeVisible();
  await page.getByTestId('settings-tab-pdf').click();
  await expect(page.getByTestId('settings-page-pdf')).toBeVisible();
}

function variant(name: string, file: string, edit: (xml: string) => string): string {
  const copy = path.join(scratchDir('pdf-us7-'), file);
  writeFileSync(copy, edit(readFileSync(fixtureBook(name), 'utf8')), 'utf8');
  return copy;
}

test.describe('US7: the PDF export settings (feature 014)', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs the core');
    mkdirSync(OUT, { recursive: true });
  });

  test('a fresh settings file shows the defaults; Reset and Reset all put them back', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openSettingsPage(page);
    await expect(page.getByTestId('settings-pdf-page-size')).toHaveValue('a4');
    await expect(page.getByTestId('settings-pdf-text-font')).toHaveValue('noto-serif');
    await expect(page.getByTestId('settings-pdf-text-size')).toHaveValue('standard');
    await expect(page.getByTestId('settings-pdf-margins')).toHaveValue('standard');
    await expect(page.getByTestId('settings-page-pdf')).toContainText('Default: A4 (210 × 297 mm)');
    await page.getByTestId('settings-pdf-page-size').selectOption('letter');
    await page.getByTestId('settings-pdf-margins').selectOption('wide');
    await page.getByTestId('settings-pdf-reset-defaultPageSize').click();
    await expect(page.getByTestId('settings-pdf-page-size')).toHaveValue('a4');
    await expect(page.getByTestId('settings-pdf-margins')).toHaveValue('wide');
    await page.getByTestId('settings-pdf-reset-all').click();
    await expect(page.getByTestId('settings-pdf-margins')).toHaveValue('standard');
    await page.getByTestId('settings-pdf-text-size').selectOption('larger');
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toBeHidden();
    expect(((await core.rpc('settings.get')) as { pdf: Record<string, string> }).pdf).toMatchObject(
      { defaultPageSize: 'a4', textSize: 'larger', margins: 'standard' },
    );
  });

  test('each shipped text family prints the book; titles in Arial keep their kind', async ({
    core,
    page,
    context,
  }) => {
    test.setTimeout(600_000);
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    try {
      // D7 (second clarify): titles set in a sans-serif font, the text in the text font.
      const book = variant('reference-all-elements.fb2', 'arial-titles.fb2', (xml) =>
        xml.replace(
          /<stylesheet type="text\/css">/,
          '<stylesheet type="text/css">title { font-family: Arial, sans-serif; }\n',
        ),
      );
      expect(readFileSync(book, 'utf8')).toContain('font-family: Arial, sans-serif');
      for (const family of ['noto-serif', 'noto-sans'] as const) {
        await setPdf(core, page, { textFont: family });
        await openFixtureBook(core, page, book);
        const target = path.join(OUT, `text-font-${family}.pdf`);
        await exportPdfTo(core, page, target, A5);
        const fonts = embedded(target);
        expect(
          [...fonts.keys()].some((name) => name.startsWith('NotoSans-')),
          family,
        ).toBe(true);
        // Serif text, sans titles; with a sans text font no serif is left.
        expect(
          [...fonts.keys()].some((name) => name.startsWith('NotoSerif-')),
          family,
        ).toBe(family === 'noto-serif');
        // Code stays monospace.
        expect(fonts.has('DejaVuSansMono'), family).toBe(true);
      }
    } finally {
      await setPdf(core, page, { textFont: 'noto-serif' });
      await seam.stop();
    }
  });

  test('a font file added prints the book, whole when it may not be subset, after its original is gone', async ({
    core,
    page,
    context,
  }) => {
    test.setTimeout(600_000);
    const dir = scratchDir('pdf-us7-fonts-');
    await core.openApp(page);

    // Scenario 4: refused with its reason, nothing added.
    const restricted = withFsType('NotoSerif-Bold.ttf', 0x0002, path.join(dir, 'restricted.ttf'));
    const notAFont = path.join(dir, 'notes.ttf');
    writeFileSync(notAFont, 'not a font', 'utf8');
    await openSettingsPage(page);
    for (const [file, reason] of [
      [restricted, 'licence forbids embedding'],
      [notAFont, 'is not a font'],
    ] as const) {
      await core.enqueueDialog('dialog.openFile', { paths: [file] });
      await page.getByTestId('settings-pdf-add-file').click();
      const refused = page.getByTestId('dialog-pdf-font-refused');
      await expect(refused).toContainText(reason);
      await refused.getByRole('button', { name: 'OK' }).click();
    }
    expect(((await core.rpc('pdf.fonts.list')) as { added: AddedFont[] }).added).toEqual([]);

    // Scenario 3 and R6: "No subsetting" (bit 8) - added from the Settings page, the text font.
    const whole = withFsType('DejaVuSansMono.ttf', 0x0108, path.join(dir, 'WholeMono.ttf'));
    await core.enqueueDialog('dialog.openFile', { paths: [whole] });
    await page.getByTestId('settings-pdf-add-file').click();
    const select = page.getByTestId('settings-pdf-text-font');
    await expect(select.locator('option', { hasText: 'DejaVu Sans Mono' })).toHaveCount(1);
    await page.getByTestId('dialog-settings-button-ok').click();
    const added = ((await core.rpc('pdf.fonts.list')) as { added: AddedFont[] }).added;
    expect(added).toHaveLength(1);
    expect(added[0].wholeFont).toBe(true);
    expect(((await core.rpc('settings.get')) as { pdf: { textFont: string } }).pdf.textFont).toBe(
      added[0].id,
    );
    // Scenario 7: the original goes; the editor prints from its own copy.
    rmSync(whole);
    expect(existsSync(whole)).toBe(false);

    const seam = startPrintSeam(core, context);
    try {
      await openFixtureBook(core, page, 'reference-all-elements.fb2');
      const target = path.join(OUT, 'added-font-whole.pdf');
      await exportPdfTo(core, page, target, A5);
      const fonts = embedded(target);
      // Embedded whole: no subset tag, and the program is the whole file.
      expect(fonts.get('DejaVuSansMono')).toBe(false);
      expect(readFileSync(target).toString('latin1')).toContain(
        `/Length1 ${readFileSync(path.join(FONTS, 'DejaVuSansMono.ttf')).length}`,
      );
    } finally {
      await core.rpc('pdf.fonts.remove', { id: added[0].id });
      await seam.stop();
    }
    expect(((await core.rpc('settings.get')) as { pdf: { textFont: string } }).pdf.textFont).toBe(
      'noto-serif',
    );
  });

  test('an added font without Cyrillic: the letters the shipped fonts drew are listed', async ({
    core,
    page,
    context,
  }) => {
    test.setTimeout(600_000);
    const dir = scratchDir('pdf-us7-armenian-');
    const armenian = path.join(dir, 'NotoSerifArmenian-Regular.ttf');
    copyFileSync(path.join(FONTS, 'NotoSerifArmenian-Regular.ttf'), armenian);
    await core.openApp(page);
    const answer = (await core.rpc('pdf.fonts.addFile', { path: armenian })) as { font: AddedFont };
    await setPdf(core, page, { textFont: answer.font.id });
    const seam = startPrintSeam(core, context);
    try {
      const book = variant('russian-untitled-notes.fb2', 'russian.fb2', (xml) => xml);
      await openFixtureBook(core, page, book);
      const summary = await exportPdfTo(core, page, path.join(OUT, 'added-font-russian.pdf'), A5);
      expect(summary).toContain(`Not in ${answer.font.family}, drawn with the shipped fonts:`);
      expect(summary).toMatch(/[а-яё]/);
    } finally {
      await core.rpc('pdf.fonts.remove', { id: answer.font.id });
      await seam.stop();
    }
  });

  test('larger text and narrow margins: larger text in a wider text area', async ({
    core,
    page,
    context,
  }) => {
    test.setTimeout(600_000);
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    const { getDocument } = (await import(
      pathToFileURL(
        path.join(ROOT, 'ui', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'),
      ).href
    )) as {
      getDocument(o: { data: Uint8Array; verbosity: number }): {
        promise: Promise<{
          getPage(n: number): Promise<{
            getTextContent(): Promise<{ items: { str?: string; transform?: number[] }[] }>;
          }>;
        }>;
        destroy(): Promise<void>;
      };
    };
    // The body text's size and left edge on the first text page.
    const measure = async (file: string) => {
      const task = getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 });
      const pdf = await task.promise;
      const items = (await (await pdf.getPage(4)).getTextContent()).items.filter(
        (item) => item.str?.trim() && item.transform,
      );
      await task.destroy();
      const sizes = items.map((item) => Math.abs(item.transform![3]));
      sizes.sort((a, b) => a - b);
      return {
        size: sizes[Math.floor(sizes.length / 2)],
        left: Math.min(...items.map((item) => item.transform![4])),
      };
    };
    try {
      await openFixtureBook(core, page, 'reference-all-elements.fb2');
      await setPdf(core, page, { textSize: 'standard', margins: 'standard' });
      const standard = path.join(OUT, 'layout-standard.pdf');
      await exportPdfTo(core, page, standard, A5);
      await setPdf(core, page, { textSize: 'larger', margins: 'narrow' });
      const changed = path.join(OUT, 'layout-larger-narrow.pdf');
      await exportPdfTo(core, page, changed, A5);
      const a = await measure(standard);
      const b = await measure(changed);
      expect(b.size).toBeGreaterThan(a.size);
      expect(b.left).toBeLessThan(a.left);
    } finally {
      await setPdf(core, page, { textSize: 'standard', margins: 'standard' });
      await seam.stop();
    }
  });

  test('an installed font is added through the Local Font Access API (DP-4)', async ({
    core,
    page,
    context,
  }) => {
    await context.grantPermissions(['local-fonts']);
    await core.openApp(page);
    await openSettingsPage(page);
    await page.getByTestId('settings-pdf-add-installed').click();
    const installed = page.getByTestId('settings-pdf-installed');
    await expect(installed).toBeVisible({ timeout: 30_000 });
    const first = await installed.locator('option:not([disabled])').first().getAttribute('value');
    expect(first).toBeTruthy();
    await installed.selectOption(first!);
    await expect(installed).toBeHidden({ timeout: 30_000 });
    const added = (
      (await core.rpc('pdf.fonts.list')) as { added: (AddedFont & { source: string })[] }
    ).added;
    expect(added.some((font) => font.source === 'installed')).toBe(true);
    await page.getByTestId('dialog-settings-button-cancel').click();
    for (const font of added) await core.rpc('pdf.fonts.remove', { id: font.id });
  });
});
