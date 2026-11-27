/**
 * Feature 022: FBD ZIP Package Mode end-to-end journeys (Playwright against real mfbe-core).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

import { expect, test, waitForStartupDocument } from './fixtures/core';

/** Minimal ZIP writer for building test fixtures (body-less FBD, subfolders, non-FBD ZIPs). */
function writeTestZip(zipPath: string, items: Array<[string, Buffer | string]>): void {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c >>> 0;
  }
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  for (const [name, content] of items) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = deflateRawSync(raw);
    const crc = crc32(raw);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);

    localParts.push(lfh, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);

    cdParts.push(cd, nameBuf);
    offset += lfh.length + nameBuf.length + comp.length;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(items.length, 8);
  eocd.writeUInt16LE(items.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  writeFileSync(zipPath, Buffer.concat([...localParts, cdBuf, eocd]));
}

/** Minimal ZIP reader for verifying saved package entries and byte payloads in E2E tests. */
function readZipEntries(zipPath: string): Map<string, Buffer> {
  const buf = readFileSync(zipPath);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error(`Invalid ZIP (no EOCD): ${zipPath}`);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const entries = new Map<string, Buffer>();
  let pos = cdOffset;
  const end = cdOffset + cdSize;
  while (pos < end) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error(`Invalid Central Directory header at ${pos}`);
    }
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const lhOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    const lfhNameLen = buf.readUInt16LE(lhOffset + 26);
    const lfhExtraLen = buf.readUInt16LE(lhOffset + 28);
    const dataStart = lhOffset + 30 + lfhNameLen + lfhExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    entries.set(name, data);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Minimal valid 1x1 PNG (67 bytes) and 1x1 JPEG (107 bytes) fixtures for cover testing.
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de' +
    '0000000c49444154789c63f8cfc000000301010018dd8db00000000049454e44ae426082',
  'hex',
);

const TINY_JPEG = Buffer.from(
  'ffd8ffe000104a46494600010101004800480000ffdb0043000302020202020302' +
    '02020303030304060404040404080606050609080a0a090809090a0c0f0c0a0b' +
    '0e0b09090d110d0e0f101011100a0c12131210130f101010ffc0000b08000100' +
    '0101011100ffc40014000100000000000000000000000000000009ffc4001410' +
    '0100000000000000000000000000000000ffda0008010100003f00d2cf20ffd9',
  'hex',
);

test.describe('Feature 022: FBD ZIP Package Mode', () => {
  test('US1: create multi-file package, Hybrid single cover, read-only Source, first Save -> Save As, second Save overwrite', async ({
    page,
    core,
  }) => {
    test.skip(!core.hasCore, 'Requires mfbe-core binary');
    const workDir = mkdtempSync(path.join(tmpdir(), 'mfbe-e2e-pkg-us1-'));
    try {
      const pdfBytes = Buffer.from('%PDF-1.7\nSample PDF payload bytes for US1.\n', 'utf8');
      const txtBytes = Buffer.from('Sample TXT book payload for US1.\n', 'utf8');
      const pdfPath = path.join(workDir, 'Book One.PDF');
      const txtPath = path.join(workDir, 'Book Two.txt');
      const fb2Path = path.join(workDir, 'disallowed.fb2');
      const dupPath = path.join(workDir, 'book one.rtf');
      const tempPath = path.join(workDir, 'Untouched.txt');
      const pngCoverPath = path.join(workDir, 'cover-source.png');
      const jpgCoverPath = path.join(workDir, 'cover-source.jpg');
      const outZipPath = path.join(workDir, 'my-books.zip');

      writeFileSync(pdfPath, pdfBytes);
      writeFileSync(txtPath, txtBytes);
      writeFileSync(fb2Path, '<FictionBook/>');
      writeFileSync(dupPath, '{\\rtf1 dup}');
      writeFileSync(tempPath, 'Temporary untouched file');
      writeFileSync(pngCoverPath, TINY_PNG);
      writeFileSync(jpgCoverPath, TINY_JPEG);

      await core.openApp(page);
      await waitForStartupDocument(page);

      // Toolbar New split button starts in FB2 mode and switches icon+action when choosing New Package.
      await expect(page.getByTestId('toolbar-file.new')).toHaveAttribute('data-active-action', 'fb2');
      await page.getByTestId('toolbar-file.new-dropdown').click();
      await expect(page.getByTestId('toolbar-file.new-menu')).toBeVisible();
      await page.getByTestId('toolbar-file.new-menu-package').click();

      await expect(page.getByTestId('app-root')).toHaveAttribute('data-editor-mode', 'package');
      await expect(page.getByTestId('toolbar-file.new')).toHaveAttribute(
        'data-active-action',
        'package',
      );
      await expect(page.getByTestId('package-files-sidebar')).toBeVisible();
      await expect(page.getByTestId('package-empty-workspace')).toBeVisible();

      // Saving an empty package shows a clear warning and writes nothing.
      await page.getByTestId('toolbar-file.save').click();
      await expect(page.getByTestId('package-save-empty')).toBeVisible();
      await page.getByTestId('package-save-empty').getByRole('button').first().click();

      // Add 2 valid files + 2 rejected files (FB2 + duplicate stem).
      await core.enqueueDialog('dialog.openFile', {
        paths: [pdfPath, txtPath, fb2Path, dupPath],
      });
      await page.getByTestId('package-files-add').click();

      // Rejection summary dialog appears for disallowed.fb2 and duplicate stem book one.rtf.
      await expect(page.getByTestId('package-add-rejected')).toBeVisible();
      await page.getByTestId('package-add-rejected').getByRole('button').first().click();

      // Package Files lists the 2 accepted files with normalized lower-cased extension.
      const items = page.getByTestId('package-files-list').locator('li');
      await expect(items).toHaveCount(2);
      await expect(items.nth(0)).toHaveAttribute('data-filename', 'Book One.pdf');
      await expect(items.nth(0)).toHaveAttribute('data-active', 'true');
      await expect(items.nth(1)).toHaveAttribute('data-filename', 'Book Two.txt');
      await expect(page.getByTestId('package-active-file-name')).toHaveText('Book One.pdf');

      // Fill Book One metadata.
      await page.getByTestId('description-book-title').fill('First Packaged Book');
      await page.getByTestId('description-genre-add').click();
      await page.getByTestId('genre-picker-option-sf').dblclick();
      await page.getByTestId('description-author-add').click();
      await page.getByTestId('description-author-0-first').fill('Alice');
      await page.getByTestId('description-author-0-last').fill('Author');
      await page.getByTestId('description-lang-code').fill('en');

      // Hybrid single cover: add PNG from Cover page -> auto-named cover.png, Add disabled in both sections, no Rename.
      await core.enqueueDialog('dialog.openFile', { paths: [pngCoverPath] });
      await page.getByTestId('description-cover-add').click();

      await expect(page.getByTestId('description-cover-0-href')).toHaveText('#cover.png');
      await expect(page.getByTestId('description-cover-add')).toBeDisabled();
      await expect(page.getByTestId('binary-objects-row-cover.png')).toBeVisible();
      await expect(page.getByTestId('binary-objects-add')).toBeDisabled();
      await expect(page.getByTestId('binary-objects-rename-cover.png')).toHaveCount(0);

      // Replace cover with JPEG -> swaps cleanly to cover.jpg with zero orphans.
      await core.enqueueDialog('dialog.openFile', { paths: [jpgCoverPath] });
      await page.getByTestId('description-cover-0-choose').click();

      await expect(page.getByTestId('description-cover-0-href')).toHaveText('#cover.jpg');
      await expect(page.getByTestId('binary-objects-row-cover.jpg')).toBeVisible();
      await expect(page.getByTestId('binary-objects-row-cover.png')).toHaveCount(0);

      // Remove from Binary objects -> clears Cover page too, zero orphans.
      await page.getByTestId('binary-objects-remove-cover.jpg').click();
      await expect(page.getByTestId('binary-objects-row-cover.jpg')).toHaveCount(0);
      await expect(page.getByTestId('description-cover-0')).toHaveCount(0);
      await expect(page.getByTestId('binary-objects-add')).toBeEnabled();

      // Add PNG back from Binary objects -> syncs Cover page automatically!
      await core.enqueueDialog('dialog.openFile', { paths: [pngCoverPath] });
      await page.getByTestId('binary-objects-add').click();
      await expect(page.getByTestId('description-cover-0-href')).toHaveText('#cover.png');
      await expect(page.getByTestId('binary-objects-row-cover.png')).toBeVisible();

      // Switch to Book Two without prompt and populate its metadata.
      await items.nth(1).locator('button').first().click();
      await expect(page.getByTestId('package-active-file-name')).toHaveText('Book Two.txt');
      await page.getByTestId('description-book-title').fill('Second Packaged Book');
      await page.getByTestId('description-genre-add').click();
      await page.getByTestId('genre-picker-option-sf').dblclick();
      await page.getByTestId('description-author-add').click();
      await page.getByTestId('description-author-0-first').fill('Bob');
      await page.getByTestId('description-author-0-last').fill('Writer');
      await page.getByTestId('description-lang-code').fill('en');

      // Switch to Source view: verify read-only badge, live XML, and blocked typing.
      await page.getByTestId('view-source').click();
      await expect(page.getByTestId('package-source-readonly-badge')).toBeVisible();
      await expect(page.getByTestId('source-view')).toHaveAttribute('data-readonly', 'true');
      const sourceEditor = page.getByTestId('source-editor');
      await expect(sourceEditor).toContainText('Second Packaged Book');
      const beforeTyping = await sourceEditor.textContent();
      await sourceEditor.click();
      await page.keyboard.type('SHOULD_NOT_BE_TYPED');
      await expect(sourceEditor).toHaveText(beforeTyping ?? '');

      // Switching back to Book One in Source view updates XML live to First Packaged Book + #cover.png.
      await items.nth(0).locator('button').first().click();
      await expect(sourceEditor).toContainText('First Packaged Book');
      await expect(sourceEditor).toContainText('#cover.png');

      // Return to Description view and verify FR-010 Remove confirmation behavior:
      // Adding an untouched empty file and removing it removes immediately without prompt.
      await page.getByTestId('view-description').click();
      await core.enqueueDialog('dialog.openFile', { paths: [tempPath] });
      await page.getByTestId('package-files-add').click();
      await expect(items).toHaveCount(3);
      await items.nth(2).locator('[data-testid^="package-file-remove-"]').click();
      await expect(page.getByTestId('dialog-package-remove-entry')).toHaveCount(0);
      await expect(items).toHaveCount(2);

      // Removing Book Two (edited metadata) prompts Yes/No; clicking No preserves it.
      await items.nth(1).locator('[data-testid^="package-file-remove-"]').click();
      await expect(page.getByTestId('dialog-package-remove-entry')).toBeVisible();
      await page.getByTestId('dialog-package-remove-entry-button-no').click();
      await expect(items).toHaveCount(2);

      // First Save opens Save As dialog and writes a valid multi-file FBD ZIP package.
      await core.enqueueDialog('dialog.saveFile', { path: outZipPath });
      await page.getByTestId('toolbar-file.save').click();
      await expect(page).toHaveTitle(/^my-books\.zip - /);
      expect(existsSync(outZipPath)).toBe(true);

      const zip1 = readZipEntries(outZipPath);
      expect([...zip1.keys()].sort()).toEqual([
        'Book One.fbd',
        'Book One.pdf',
        'Book Two.fbd',
        'Book Two.txt',
      ]);
      expect(zip1.get('Book One.pdf')).toEqual(pdfBytes);
      expect(zip1.get('Book Two.txt')).toEqual(txtBytes);
      const fbd1 = zip1.get('Book One.fbd')!.toString('utf8');
      expect(fbd1).toContain('<book-title>First Packaged Book</book-title>');
      expect(fbd1).toContain('cover.png');
      expect(fbd1).not.toContain('<stylesheet');

      // Delete original disk payload files, edit Book One metadata, and press Save again:
      // overwrites in place WITHOUT opening Save As and preserves payloads byte-for-byte!
      unlinkSync(pdfPath);
      unlinkSync(txtPath);
      await page.getByTestId('description-book-title').fill('First Packaged Book Rev 2');
      await expect(page).toHaveTitle(/^my-books\.zip\* - /);
      await page.getByTestId('toolbar-file.save').click();
      await expect(page).toHaveTitle(/^my-books\.zip - /);

      const zip2 = readZipEntries(outZipPath);
      expect(zip2.get('Book One.pdf')).toEqual(pdfBytes);
      expect(zip2.get('Book Two.txt')).toEqual(txtBytes);
      expect(zip2.get('Book One.fbd')!.toString('utf8')).toContain(
        '<book-title>First Packaged Book Rev 2</book-title>',
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  test('US2: open existing body-less multi-book subfolder ZIP via File -> Open & Recent Files, in-place Save preserves subfolders, Save As writes clean ZIP, non-FBD ZIP refused', async ({
    page,
    core,
  }) => {
    test.skip(!core.hasCore, 'Requires mfbe-core binary');
    const workDir = mkdtempSync(path.join(tmpdir(), 'mfbe-e2e-pkg-us2-'));
    try {
      const pdfBytes = Buffer.from('%PDF-1.7\nImmutable existing PDF payload.\n', 'utf8');
      const unpairedBytes = Buffer.from('Unpaired second book content.\n', 'utf8');
      const subBytes = Buffer.from('Subfolder file must survive in-place Save.\n', 'utf8');
      const bodylessFbd =
        '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">\n' +
        '  <description>\n' +
        '    <title-info>\n' +
        '      <genre>sf</genre>\n' +
        '      <author><first-name>Arthur</first-name><last-name>Clarke</last-name></author>\n' +
        '      <book-title>Rendezvous with Rama</book-title>\n' +
        '      <lang>en</lang>\n' +
        '    </title-info>\n' +
        '    <document-info>\n' +
        '      <author><first-name>Editor</first-name><last-name>One</last-name></author>\n' +
        '      <date value="2026-11-27">2026-11-27</date>\n' +
        '      <id>RAMA-1</id>\n' +
        '      <version>1.0</version>\n' +
        '    </document-info>\n' +
        '  </description>\n' +
        '</FictionBook>\n';

      const existingZip = path.join(workDir, 'rama-pack.zip');
      const cleanZip = path.join(workDir, 'rama-clean.zip');
      const plainZip = path.join(workDir, 'plain-no-fbd.zip');

      writeTestZip(existingZip, [
        ['extras/notes.txt', subBytes],
        ['Rama.PDF', pdfBytes],
        ['rama.fbd', bodylessFbd],
        ['Unpaired.txt', unpairedBytes],
      ]);
      writeTestZip(plainZip, [['only-pdf.pdf', pdfBytes]]);

      await core.openApp(page);
      await waitForStartupDocument(page);

      // 1. Opening a non-FBD ZIP via File -> Open refuses cleanly and stays in FB2 mode.
      await core.enqueueDialog('dialog.openFile', { paths: [plainZip] });
      await page.getByTestId('toolbar-file.open').click();
      await expect(page.getByTestId('app-root')).toHaveAttribute('data-editor-mode', 'fb2');
      // Dismiss the error/info dialog that appeared.
      const dialogBtn = page.locator('[data-testid="dialog-layer"] button').first();
      await expect(dialogBtn).toBeVisible();
      await dialogBtn.click();

      // 2. Opening existing FBD ZIP via File -> Open auto-detects and switches into Package mode.
      await core.enqueueDialog('dialog.openFile', { paths: [existingZip] });
      await page.getByTestId('toolbar-file.open').click();

      await expect(page.getByTestId('app-root')).toHaveAttribute('data-editor-mode', 'package');
      await expect(page).toHaveTitle(/^rama-pack\.zip - /);
      const items = page.getByTestId('package-files-list').locator('li');
      await expect(items).toHaveCount(2);
      await expect(items.nth(0)).toHaveAttribute('data-filename', 'Rama.pdf');
      await expect(items.nth(1)).toHaveAttribute('data-filename', 'Unpaired.txt');
      await expect(page.getByTestId('description-book-title')).toHaveValue('Rendezvous with Rama');

      // Populate unpaired entry's description and edit Rama's title.
      await page.getByTestId('description-book-title').fill('Rendezvous with Rama (Revised)');
      await items.nth(1).locator('button').first().click();
      await page.getByTestId('description-book-title').fill('Bonus Essay');
      await page.getByTestId('description-genre-add').click();
      await page.getByTestId('genre-picker-option-sf').dblclick();
      await page.getByTestId('description-author-add').click();
      await page.getByTestId('description-author-0-first').fill('Arthur');
      await page.getByTestId('description-author-0-last').fill('Clarke');
      await page.getByTestId('description-lang-code').fill('en');

      // 3. Plain Save overwrites existingZip atomically and preserves extras/notes.txt + payloads byte-for-byte.
      await page.getByTestId('toolbar-file.save').click();
      await expect(page).toHaveTitle(/^rama-pack\.zip - /);

      const inPlaceEntries = readZipEntries(existingZip);
      expect([...inPlaceEntries.keys()].sort()).toEqual([
        'Rama.fbd',
        'Rama.pdf',
        'Unpaired.fbd',
        'Unpaired.txt',
        'extras/notes.txt',
      ]);
      expect(inPlaceEntries.get('extras/notes.txt')).toEqual(subBytes);
      expect(inPlaceEntries.get('Rama.pdf')).toEqual(pdfBytes);
      expect(inPlaceEntries.get('Unpaired.txt')).toEqual(unpairedBytes);
      expect(inPlaceEntries.get('Rama.fbd')!.toString('utf8')).toContain(
        '<book-title>Rendezvous with Rama (Revised)</book-title>',
      );

      // 4. Save As to a new path writes a clean package (omitting extras/notes.txt).
      await core.enqueueDialog('dialog.saveFile', { path: cleanZip });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-saveAs').click();
      await expect(page).toHaveTitle(/^rama-clean\.zip - /);

      const cleanEntries = readZipEntries(cleanZip);
      expect([...cleanEntries.keys()].sort()).toEqual([
        'Rama.fbd',
        'Rama.pdf',
        'Unpaired.fbd',
        'Unpaired.txt',
      ]);
      expect(cleanEntries.get('Rama.pdf')).toEqual(pdfBytes);

      // 5. Switch back to FB2 (New), then reopen rama-pack.zip from File -> Recent Files!
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-new').click();
      await expect(page.getByTestId('app-root')).toHaveAttribute('data-editor-mode', 'fb2');

      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-recent').hover();
      await page
        .locator('[role="menuitem"][data-testid^="menu-file-recent-"]')
        .filter({ hasText: 'rama-pack.zip' })
        .click();
      await expect(page.getByTestId('app-root')).toHaveAttribute('data-editor-mode', 'package');
      await expect(page).toHaveTitle(/^rama-pack\.zip - /);
      await expect(page.getByTestId('description-book-title')).toHaveValue(
        'Rendezvous with Rama (Revised)',
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
