/**
 * Feature 011, User Story 6 - the Markdown ZIP (D14, D23, D24, D27): the Save dialog proposes the
 * book's name with `.md.zip` in its folder without the *Include pictures* box; the archive holds
 * `<name>.md` and `images/` with exactly the pictures the text and the cover use, byte for byte,
 * under valid distinct names; the archive the book was opened from is refused and left unchanged.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle } from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const JPEG = readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'images', 'tiny.jpg'));
const PNG = readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'images', 'tiny.png'));

const BOOK = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info><genre>prose</genre><author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Pictures</book-title><coverpage><image l:href="#Cover"/></coverpage><lang>en</lang></title-info>
<document-info><author><nickname>maker</nickname></author><date>2026</date><id>zip-1</id><version>1.0</version></document-info>
</description>
<body>
<section><title><p>One</p></title>
<image l:href="#cover.jpg"/>
<p>A map: <image l:href="#карта 1"/></p>
</section>
</body>
<binary id="Cover" content-type="image/jpeg">${JPEG.toString('base64')}</binary>
<binary id="cover.jpg" content-type="image/jpeg">${JPEG.toString('base64')}</binary>
<binary id="карта 1" content-type="image/png">${PNG.toString('base64')}</binary>
<binary id="unused" content-type="image/png">${PNG.toString('base64')}</binary>
</FictionBook>
`;

/** The archive's entries with their bytes (Python's zipfile reads it). */
function zipEntries(file: string): Map<string, Buffer> {
  const script =
    'import base64,json,sys,zipfile\n' +
    'z=zipfile.ZipFile(sys.argv[1])\n' +
    'print(json.dumps({n: base64.b64encode(z.read(n)).decode() for n in z.namelist()}))';
  const run = spawnSync('python3', ['-c', script, file], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr);
  const entries = JSON.parse(run.stdout) as Record<string, string>;
  return new Map(
    Object.entries(entries).map(([name, data]) => [name, Buffer.from(data, 'base64')]),
  );
}

async function open(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
}

async function exportZip(core: CoreHandle, page: Page): Promise<void> {
  await clickExport(core, page, 'exportMarkdownZip');
}

test.describe('US6 (feature 011) - the Markdown ZIP', () => {
  let dir: string;
  let book: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-011-us6-'));
    book = path.join(dir, 'pictures.fb2');
    writeFileSync(book, BOOK, 'utf8');
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('1-3. the dialog, the archive and its picture names', async ({ core, page }) => {
    await open(core, page, book);
    const target = path.join(dir, 'pictures.md.zip');
    await core.enqueueDialog('dialog.saveFile', { path: target });
    await exportZip(core, page);
    await expect(page.getByTestId('status-message')).toContainText(`Exported to ${target}:`, {
      timeout: 30_000,
    });
    // The Save dialog: the book's name with .md.zip in its folder, no Include pictures box.
    const requests = await core.rpc<Array<Record<string, unknown>>>('test.dialogRequests');
    const save = requests.at(-1) ?? {};
    const request = (save.params ?? save) as { defaultPath?: string; zipChoice?: unknown };
    expect(request.defaultPath).toMatch(/\.md\.zip$/);
    expect(path.dirname(request.defaultPath ?? '')).toBe(dir);
    expect(request.zipChoice).toBeUndefined();
    // The archive: the text and the pictures the text and the cover use, byte for byte.
    const entries = zipEntries(target);
    expect([...entries.keys()].sort()).toEqual(
      ['images/Cover.jpg', 'images/cover-2.jpg', 'images/карта 1.png', 'pictures.md'].sort(),
    );
    expect(entries.get('images/Cover.jpg')!.equals(JPEG)).toBe(true);
    expect(entries.get('images/cover-2.jpg')!.equals(JPEG)).toBe(true);
    expect(entries.get('images/карта 1.png')!.equals(PNG)).toBe(true);
    const text = decodeURI(entries.get('pictures.md')!.toString('utf8'));
    expect(text).toContain('](images/Cover.jpg)');
    expect(text).toContain('](images/cover-2.jpg)');
    expect(text).toContain('](images/карта 1.png)');
  });

  test('4. the archive the book was opened from is refused and left unchanged', async ({
    core,
    page,
  }) => {
    const archive = path.join(dir, 'book.zip');
    const made = spawnSync(
      'python3',
      [
        '-c',
        'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w")\nz.write(sys.argv[2],"pictures.fb2")\nz.close()',
        archive,
        book,
      ],
      { encoding: 'utf8' },
    );
    expect(made.status).toBe(0);
    const before = readFileSync(archive);
    // A book read from an archive: the title names the entry and the archive (feature 009).
    await core.enqueueDialog('dialog.openFile', { paths: [archive] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await expect(page).toHaveTitle(/^pictures\.fb2 \(book\.zip\) - /, { timeout: 30_000 });
    await core.enqueueDialog('dialog.saveFile', { path: archive });
    await exportZip(core, page);
    await expect(page.getByTestId('command-error')).toBeVisible({ timeout: 30_000 });
    expect(readFileSync(archive).equals(before)).toBe(true);
  });
});
