/**
 * Feature 017, User Story 3 (tasks T045): Settings > Exports gives the defaults of every export dialog's
 * options for a book's first export; the choices made stay with that book until another book takes the
 * window (D17 to D22, SC-009). The dialogs are answered without a file, so nothing is written.
 */
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test, type CoreHandle } from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';
import { openFixtureBook } from './fixtures/pdfExport';
import { scratchDir } from './fixtures/scratch';

interface SaveRequest {
  method: string;
  selectedEncoding?: string;
  zipChoice?: { checked: boolean };
  checks?: { id: string; checked: boolean }[];
}

test.beforeEach(({ core }) => {
  test.skip(!core.hasCore, 'needs the core');
});

test.afterEach(async ({ core }) => {
  if (core.hasCore)
    await core
      .rpc('settings.set', {
        patch: {
          pdf: { zip: false },
          markdown: { includePictures: true },
          txt: {
            encodingMode: 'utf-8',
            encodings: {
              en: 'windows-1252',
              ru: 'windows-1251',
              uk: 'windows-1251',
              other: 'utf-8',
            },
            bom: false,
            zip: false,
          },
        },
      })
      .catch(() => undefined);
});

async function lastSave(core: CoreHandle): Promise<SaveRequest> {
  const requests = await core.rpc<SaveRequest[]>('test.dialogRequests');
  return requests.filter((r) => r.method === 'dialog.saveFile').at(-1)!;
}

/** Opens the export's Save dialog and closes it without a file. */
async function askAndClose(core: CoreHandle, page: Page, item: string): Promise<SaveRequest> {
  await core.enqueueDialog('dialog.saveFile', {});
  await clickExport(core, page, item);
  return lastSave(core);
}

test("the settings' defaults serve a book's first export (D19 to D21)", async ({ core, page }) => {
  await core.rpc('settings.set', {
    patch: {
      pdf: { zip: true },
      markdown: { includePictures: false },
      txt: { encodingMode: 'language', encodings: { ru: 'koi8-r' }, bom: true, zip: true },
    },
  });
  await core.openApp(page);
  await openFixtureBook(core, page, 'modern-utf8.fb2');
  expect((await askAndClose(core, page, 'exportPdf')).zipChoice?.checked).toBe(true);
  expect((await askAndClose(core, page, 'exportMarkdown')).zipChoice?.checked).toBe(false);
  const txt = await askAndClose(core, page, 'exportTxt');
  // A Russian book in the language mode proposes the Russian default (D19).
  expect(txt.selectedEncoding).toBe('KOI8-R (Russian)');
  expect(txt.zipChoice?.checked).toBe(true);
  expect(txt.checks?.[0]).toMatchObject({ id: 'bom', checked: true });
});

test('a choice stays with the book until another book is opened (D17, SC-009)', async ({
  core,
  page,
}) => {
  await core.openApp(page);
  await openFixtureBook(core, page, 'modern-utf8.fb2');
  const dir = scratchDir('txt-kept-');
  const first = await askAndClose(core, page, 'exportTxt');
  expect(first.selectedEncoding).toBe('UTF-8 (Unicode)');
  // An export in windows-1251 with the byte-order mark box ticked.
  await core.enqueueDialog('dialog.saveFile', {
    path: path.join(dir, 'kept.txt'),
    encoding: 'windows-1251 (Cyrillic)',
    zip: false,
    checks: { bom: true },
  });
  await clickExport(core, page, 'exportTxt');
  await expect
    .poll(async () => (await page.getByTestId('status-message').textContent()) ?? '', {
      timeout: 60_000,
    })
    .toContain('Exported to');
  const again = await askAndClose(core, page, 'exportTxt');
  expect(again.selectedEncoding).toBe('windows-1251 (Cyrillic)');
  expect(again.checks?.[0]?.checked).toBe(true);
  // Another book in the window: the defaults again.
  await openFixtureBook(core, page, 'reference-all-elements.fb2');
  const other = await askAndClose(core, page, 'exportTxt');
  expect(other.selectedEncoding).toBe('UTF-8 (Unicode)');
  expect(other.checks?.[0]?.checked).toBe(false);
});
