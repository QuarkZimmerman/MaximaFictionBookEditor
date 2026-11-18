/**
 * Feature 017, User Story 2 (tasks T042): Save in ZIP archive writes <name>.zip holding exactly <name>.txt
 * and <name>.fbd, the book's description with its cover as Export as FBD writes it (D13). The archive is
 * read back through the TXT import's own session, as the import will read it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';
import { openFixtureBook } from './fixtures/pdfExport';
import { scratchDir } from './fixtures/scratch';

test.beforeEach(({ core }) => {
  test.skip(!core.hasCore, 'needs the core');
});

async function exported(page: Page, target: string): Promise<void> {
  await expect
    .poll(async () => (await page.getByTestId('status-message').textContent()) ?? '', {
      timeout: 60_000,
    })
    .toContain(`Exported to ${target}`);
}

test('the TXT and its FBD in one ZIP archive, named after it (D13)', async ({ core, page }) => {
  await core.openApp(page);
  await openFixtureBook(core, page, 'reference-all-elements.fb2');
  const dir = scratchDir('txt-zip-');
  // The Save dialog names a .txt; the ticked box turns it into the archive's name.
  await core.enqueueDialog('dialog.saveFile', {
    path: path.join(dir, 'reference.txt'),
    encoding: 'UTF-8 (Unicode)',
    zip: true,
    checks: { bom: false },
  });
  await clickExport(core, page, 'exportTxt');
  const zip = path.join(dir, 'reference.zip');
  await exported(page, zip);
  const listed = await core.rpc<{
    archive: { txts: { entry: string }[]; fbds: { entry: string }[] };
  }>('txtImport.begin', { path: zip });
  expect(listed.archive.txts.map((e) => e.entry)).toEqual(['reference.txt']);
  expect(listed.archive.fbds.map((e) => e.entry)).toEqual(['reference.fbd']);
  const { token } = await core.rpc<{ token: string }>('txtImport.begin', {
    path: zip,
    entry: 'reference.txt',
  });
  const read = await core.rpc<{ text: string }>('txtImport.read', { token });
  expect(read.text.startsWith('The Reference Book\r\n')).toBe(true);
  const { path: fbd } = await core.rpc<{ path: string }>('txtImport.extractFbd', {
    token,
    entry: 'reference.fbd',
  });
  const description = readFileSync(fbd, 'utf8');
  expect(description).toContain('<book-title>The Reference Book</book-title>');
  expect(description).toContain('<coverpage>');
  await core.rpc('txtImport.end', { token });
  // The option is kept for the book: the next export proposes the archive again (D17).
  await core.enqueueDialog('dialog.saveFile', {
    path: path.join(dir, 'again.txt'),
    encoding: 'UTF-8 (Unicode)',
    zip: false,
    checks: { bom: false },
  });
  await clickExport(core, page, 'exportTxt');
  await exported(page, path.join(dir, 'again.txt'));
  const requests =
    await core.rpc<{ method: string; zipChoice?: { checked: boolean } }[]>('test.dialogRequests');
  expect(requests.filter((r) => r.method === 'dialog.saveFile').at(-1)?.zipChoice?.checked).toBe(
    true,
  );
});
