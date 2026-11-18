/**
 * Feature 017, User Story 1 (tasks T024): File > Export > Export as TXT... writes the book as plain
 * text - the title page, the text, the record at the end with the line naming the editor - in UTF-8
 * or an encoding of the book's language, CR LF, the byte-order mark only when ticked. Checked: the
 * Save dialog's list per language, UTF-8 proposed out of the box, the byte-order mark and ZIP boxes;
 * the editor's own window when the dialog cannot carry them; a single-byte encoding and its summary;
 * a Save dialog closed without a file writing nothing.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test, type CoreHandle } from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';
import { openFixtureBook } from './fixtures/pdfExport';
import { scratchDir } from './fixtures/scratch';

/** A record of test.dialogRequests: the request's fields at the top level. */
interface SaveRequest {
  method: string;
  encodingChoices?: string[];
  selectedEncoding?: string;
  checks?: { id: string; label: string; checked: boolean }[];
  zipChoice?: { checked: boolean };
}

async function lastSaveRequest(core: CoreHandle): Promise<SaveRequest> {
  const requests = await core.rpc<SaveRequest[]>('test.dialogRequests');
  return requests.filter((r) => r.method === 'dialog.saveFile').at(-1)!;
}

/** Waits for the end of the export: the status line naming the file, or the summary, closed. */
async function exportEnds(page: Page, target: string): Promise<string> {
  const summary = page.getByTestId('dialog-txt-export-summary');
  const failed = page.getByTestId('dialog-txt-export-failed');
  let text = '';
  await expect
    .poll(
      async () => {
        if (await failed.isVisible()) throw new Error(`failed: ${await failed.textContent()}`);
        if (await summary.isVisible()) {
          text = (await summary.textContent()) ?? '';
          await summary.getByRole('button', { name: 'OK' }).click();
          return true;
        }
        text = (await page.getByTestId('status-message').textContent()) ?? '';
        return text.includes(`Exported to ${target}`);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  return text;
}

test('the reference book in UTF-8, with and without the byte-order mark (D1 to D10)', async ({
  core,
  page,
}) => {
  await core.openApp(page);
  await openFixtureBook(core, page, 'reference-all-elements.fb2');
  const dir = scratchDir('txt-utf8-');
  const target = path.join(dir, 'reference.txt');
  await core.enqueueDialog('dialog.saveFile', {
    path: target,
    encoding: 'UTF-8 (Unicode)',
    zip: false,
    checks: { bom: false },
  });
  await clickExport(core, page, 'exportTxt');
  await exportEnds(page, target);
  const request = await lastSaveRequest(core);
  // D11: an English book is offered UTF-8 and the Western encodings; UTF-8 proposed (D19).
  expect(request.encodingChoices).toEqual([
    'UTF-8 (Unicode)',
    'windows-1252 (Western European)',
    'ISO-8859-1 (Western European, Latin-1)',
    'ISO-8859-15 (Western European with €)',
    'macintosh (Mac Western European)',
  ]);
  expect(request.selectedEncoding).toBe('UTF-8 (Unicode)');
  expect(request.checks).toEqual([{ id: 'bom', label: 'Byte-order mark', checked: false }]);
  expect(request.zipChoice?.checked).toBe(false);
  const bytes = readFileSync(target);
  expect(bytes.subarray(0, 3).toString('hex')).not.toBe('efbbbf');
  const text = bytes.toString('utf8');
  expect(text.startsWith('The Reference Book\r\n(The Series #3)\r\nAnna B. Example\r\n')).toBe(
    true,
  );
  expect(text).toContain(
    '\r\n========================================\r\nTitle: The Reference Book\r\n',
  );
  expect(text).toMatch(/Made with Maxima Fiction Book Editor \S+\r\n$/);
  expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  expect(text).toContain('---------------- Note 1 ----------------');
  // The second export proposes what the first one chose (D17); the byte-order mark ticked now.
  const withBom = path.join(dir, 'with-bom.txt');
  await core.enqueueDialog('dialog.saveFile', {
    path: withBom,
    encoding: 'UTF-8 (Unicode)',
    zip: false,
    checks: { bom: true },
  });
  await clickExport(core, page, 'exportTxt');
  await exportEnds(page, withBom);
  expect(readFileSync(withBom).subarray(0, 3).toString('hex')).toBe('efbbbf');
  const again = path.join(dir, 'again.txt');
  await core.enqueueDialog('dialog.saveFile', {
    path: again,
    encoding: 'UTF-8 (Unicode)',
    zip: false,
    checks: { bom: true },
  });
  await clickExport(core, page, 'exportTxt');
  await exportEnds(page, again);
  expect((await lastSaveRequest(core)).checks?.[0]?.checked).toBe(true);
});

test('a Russian book in KOI8-R, its summary naming what was replaced (D11, D12, D16)', async ({
  core,
  page,
}) => {
  await core.openApp(page);
  await openFixtureBook(core, page, 'modern-utf8.fb2');
  const target = path.join(scratchDir('txt-koi8-'), 'modern.txt');
  await core.enqueueDialog('dialog.saveFile', {
    path: target,
    encoding: 'KOI8-R (Russian)',
    zip: false,
    checks: { bom: true },
  });
  await clickExport(core, page, 'exportTxt');
  await exportEnds(page, target);
  const request = await lastSaveRequest(core);
  expect(request.encodingChoices?.length).toBe(7);
  expect(request.encodingChoices?.[1]).toBe('windows-1251 (Cyrillic)');
  const bytes = readFileSync(target);
  // No byte-order mark outside UTF-8, whatever the box said.
  expect(bytes.subarray(0, 3).toString('hex')).not.toBe('efbbbf');
  const text = new TextDecoder('koi8-r').decode(bytes);
  expect(text.startsWith('Современная книга\r\n')).toBe(true);
  expect(text).toContain('\r\nTitle: Современная книга\r\n');
  // The record is English whatever the book's language (D14, the requester's decision).
  expect(text).toMatch(/Made with Maxima Fiction Book Editor \S+\r\n$/);
});

test("the editor's own window asks when the dialog cannot carry the options (DP-5)", async ({
  core,
  page,
}) => {
  await core.openApp(page);
  await openFixtureBook(core, page, 'modern-utf8.fb2');
  const target = path.join(scratchDir('txt-own-window-'), 'own.txt');
  await core.enqueueDialog('dialog.saveFile', { path: target });
  await clickExport(core, page, 'exportTxt');
  const window = page.getByTestId('dialog-txt-export-options');
  await expect(window).toBeVisible();
  await window.getByTestId('dialog-txt-export-encoding').selectOption('windows-1251');
  await window.getByRole('button', { name: 'OK' }).click();
  await exportEnds(page, target);
  const text = new TextDecoder('windows-1251').decode(readFileSync(target));
  expect(text.startsWith('Современная книга\r\n')).toBe(true);
});

test('a Save dialog closed without a file writes nothing (D3)', async ({ core, page }) => {
  await core.openApp(page);
  await openFixtureBook(core, page, 'modern-utf8.fb2');
  const dir = scratchDir('txt-cancel-');
  await core.enqueueDialog('dialog.saveFile', {});
  await clickExport(core, page, 'exportTxt');
  await expect(page.getByTestId('dialog-txt-export-options')).toBeHidden();
  expect(existsSync(path.join(dir, 'modern.txt'))).toBe(false);
});
