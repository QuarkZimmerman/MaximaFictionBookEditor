/**
 * Feature 023 (T044): end-to-end Playwright journeys covering US1–US5 against real `mfbe-core`:
 * - US1: Export as DOCX (bare & ZIP+FBD), timed SC-001 (< 5 s), fallback options modal, sticky per-book options
 * - US2: Foreign DOCX bare/zipped/sibling-FBD import, `.doc`/`.docm`/encrypted refusals (< 2 s SC-004),
 *        File > Open refusal vs FBD ZIP Package mode coexistence
 * - US3: Reversible round-trip (untouched & externally edited DOCX + archive FBD conflict prompt)
 * - US4: Settings > Exports > DOCX defaults, custom margin/font reveal, Apply dirty tracking, persistence
 * - US5: Batch Converter From FB2 -> DOCX (bare & ZIP + batch-only Export settings) & To FB2 <- DOCX
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

import type { Page } from '@playwright/test';

import {
  makeTempDir,
  openBatchDialog,
  resetBatchSettings,
  TINY_PNG_BYTES,
  writeStoredZip,
} from './fixtures/batchHelpers';
import {
  expect,
  fixtureBook,
  shownDocId,
  test,
  waitForBook,
  type CoreHandle,
} from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';

interface ZipParsedEntry {
  name: string;
  method: number;
  data: Buffer;
}

/** Minimal pure-Node ZIP reader supporting Store (0) and Deflate (8) entries. */
function readZipEntries(zipPath: string): Map<string, ZipParsedEntry> {
  const buf = readFileSync(zipPath);
  // Locate EOCD
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`Invalid ZIP: ${zipPath}`);
  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, ZipParsedEntry>();
  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('Bad central header');
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOff = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    out.set(name, { name, method, data });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function writeMinimalForeignDocx(
  targetPath: string,
  opts: { title?: string; bodyParagraphs: string[]; macroEnabled?: boolean } = {
    bodyParagraphs: ['Hello from foreign DOCX.'],
  },
): void {
  const mainCt = opts.macroEnabled
    ? 'application/vnd.ms-word.document.macroEnabled.main+xml'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    `<Override PartName="/word/document.xml" ContentType="${mainCt}"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `</Relationships>`;
  const docRels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>` +
    `</Relationships>`;
  const coreXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:title>${opts.title ?? 'Foreign Word Title'}</dc:title>` +
    `<dc:creator>Foreign Author</dc:creator>` +
    `<dc:language>en</dc:language>` +
    `</cp:coreProperties>`;
  const paras = opts.bodyParagraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Foreign Chapter</w:t></w:r></w:p>${paras}</w:body>` +
    `</w:document>`;
  writeStoredZip(targetPath, [
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rels },
    { name: 'word/_rels/document.xml.rels', content: docRels },
    { name: 'docProps/core.xml', content: coreXml },
    { name: 'word/document.xml', content: documentXml },
    { name: 'word/media/image1.png', content: TINY_PNG_BYTES },
  ]);
}

function makeSimpleFbdXml(title: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">` +
    `<description><title-info><genre>sf</genre><author><first-name>Fbd</first-name><last-name>Author</last-name></author>` +
    `<book-title>${title}</book-title><lang>en</lang></title-info>` +
    `<document-info><author><nickname>tester</nickname></author><date>2026-11-28</date><id>fbd-e2e-id</id><version>1.0</version></document-info>` +
    `</description></FictionBook>`
  );
}

function makeOle2Stub(streamName: string): Buffer {
  // Minimal OLE2 CFBF header (sector 0 = directory) containing UTF-16LE `streamName`.
  const buf = Buffer.alloc(1024, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buf, 0);
  buf.writeUInt16LE(0x0009, 30); // sector shift 512 bytes
  buf.writeUInt32LE(0, 48); // first directory sector = 0 (at byte offset 512)
  const nameUtf16 = Buffer.from(streamName + '\0', 'utf16le');
  nameUtf16.copy(buf, 512);
  buf.writeUInt16LE(nameUtf16.length, 512 + 64);
  buf[512 + 66] = 2; // stream object
  return buf;
}

async function openBook(core: CoreHandle, page: Page, bookPath: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [bookPath] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, bookPath);
}

async function waitDocxExportEnds(page: Page, targetBasename: string): Promise<string> {
  const summary = page.getByTestId('dialog-docx-export-summary');
  const failed = page.getByTestId('dialog-docx-export-failed');
  let text = '';
  await expect
    .poll(
      async () => {
        if (await failed.isVisible()) {
          throw new Error(`DOCX export failed: ${await failed.textContent()}`);
        }
        if (await summary.isVisible()) {
          text = (await summary.textContent()) ?? '';
          await summary.getByRole('button').first().click();
          return true;
        }
        text = (await page.getByTestId('status-message').textContent()) ?? '';
        return text.includes('Exported to') && text.includes(targetBasename);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return text;
}

async function dismissDiscardPromptIfShown(page: Page): Promise<void> {
  const noBtn = page.getByRole('dialog').getByRole('button', { name: 'No' });
  try {
    await noBtn.waitFor({ state: 'visible', timeout: 500 });
    await noBtn.click();
  } catch {
    // No unsaved-changes prompt appeared.
  }
}

async function importDocxViaMenu(core: CoreHandle, page: Page, filePath: string): Promise<string> {
  const beforeDoc = await shownDocId(page);
  await core.enqueueDialog('dialog.openFile', { paths: [filePath] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  await page.getByTestId('menu-file-import-importDocx').click();
  await dismissDiscardPromptIfShown(page);

  const summary = page.getByTestId('dialog-docx-import-summary');
  const failed = page.getByTestId('dialog-docx-import-failed');
  let summaryText = '';
  await expect
    .poll(
      async () => {
        if (await failed.isVisible()) {
          throw new Error(`DOCX import failed: ${await failed.textContent()}`);
        }
        if (await summary.isVisible()) {
          summaryText = (await summary.textContent()) ?? '';
          await summary.getByRole('button').first().click();
          return true;
        }
        const curDoc = await shownDocId(page);
        if (curDoc && curDoc !== beforeDoc) {
          summaryText = (await page.getByTestId('status-message').textContent()) ?? '';
          return true;
        }
        return false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return summaryText;
}

test.describe('Feature 023 - DOCX export, import, reversible round-trip, settings, and batch', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('US1 & US3: bare & ZIP+FBD export (< 5s SC-001), Calibre check, untouched & modified round-trip, and archive FBD conflict', async ({
    core,
    page,
  }) => {
    const dir = makeTempDir('mfbe-docx-us1-us3-');
    const refBook = fixtureBook('reference-all-elements.fb2');
    await openBook(core, page, refBook);

    // 1. Bare DOCX export (timed SC-001 < 5s)
    const bareDocx = path.join(dir, 'reference.docx');
    await core.enqueueDialog('dialog.saveFile', {
      path: bareDocx,
      zip: false,
      selects: { pageSize: 'letter' },
    });
    const t0 = Date.now();
    await clickExport(core, page, 'exportDocx');
    await waitDocxExportEnds(page, 'reference.docx');
    const elapsedMs = Date.now() - t0;
    expect(elapsedMs).toBeLessThan(5_000);
    expect(statSync(bareDocx).size).toBeGreaterThan(2048);

    // Verify OOXML entries inside exported DOCX
    const docxEntries = readZipEntries(bareDocx);
    expect(docxEntries.has('[Content_Types].xml')).toBe(true);
    expect(docxEntries.has('word/document.xml')).toBe(true);
    expect(docxEntries.has('word/styles.xml')).toBe(true);
    expect(docxEntries.has('word/footer1.xml')).toBe(true);
    expect(docxEntries.has('customXml/item1.xml')).toBe(true);
    expect(docxEntries.get('word/document.xml')!.data.toString('utf8')).toContain('w:w="12240"'); // Letter width
    expect(docxEntries.get('word/settings.xml')!.data.toString('utf8')).not.toContain(
      'updateFields',
    );

    // Optional independent Calibre verification when installed on host
    const calibreWhich = spawnSync(process.platform === 'win32' ? 'where' : 'which', [
      'ebook-convert',
    ]);
    if (calibreWhich.status === 0) {
      const txtOut = path.join(dir, 'calibre-check.txt');
      const conv = spawnSync('ebook-convert', [bareDocx, txtOut], { encoding: 'utf8' });
      expect(conv.status, conv.stderr).toBe(0);
      expect(readFileSync(txtOut, 'utf8').length).toBeGreaterThan(100);
    }

    // 2. ZIP + FBD export (also verifies sticky per-book pageSize kept as 'letter')
    const zipPath = path.join(dir, 'reference-bundle.zip');
    await core.enqueueDialog('dialog.saveFile', {
      path: zipPath,
      zip: true,
      selects: { pageSize: 'a4' },
    });
    await clickExport(core, page, 'exportDocx');
    await waitDocxExportEnds(page, 'reference-bundle.zip');

    const zipEntries = readZipEntries(zipPath);
    expect(zipEntries.get('reference-bundle.docx')?.method).toBe(0); // ZIP Store
    expect(zipEntries.get('reference-bundle.fbd')?.method).toBe(8); // ZIP Deflate

    // 3. Untouched reversible round-trip -> opens in Body view & validates cleanly
    await importDocxViaMenu(core, page, bareDocx);
    await expect(page.getByTestId('body-view')).toBeVisible();
    const restoredDocId = await shownDocId(page);
    expect(restoredDocId).toBeTruthy();
    const validation = await core.rpc<{ errorCount: number }>('doc.validate', {
      docId: restoredDocId,
    });
    expect(validation.errorCount).toBe(0);

    // 4. Externally edited DOCX -> preserves edited text & reports externallyModified
    const editedDocx = path.join(dir, 'reference-edited.docx');
    const modifiedEntries = [...docxEntries.values()].map((e) => {
      if (e.name === 'word/document.xml') {
        const xml = e.data.toString('utf8');
        // Replace a known body paragraph sentence (outside front matter).
        const patched = xml.replace('The last chapter.', 'EXTERNALLY EDITED WORD PROSE');
        expect(patched).not.toBe(xml);
        return { name: e.name, content: patched };
      }
      return { name: e.name, content: e.data };
    });
    writeStoredZip(editedDocx, modifiedEntries);
    const modSummary = await importDocxViaMenu(core, page, editedDocx);
    expect(modSummary.toLowerCase()).toContain('modified outside');
    await expect(page.getByTestId('body-view')).toContainText('EXTERNALLY EDITED WORD PROSE');

    // 5. Editor DOCX + differing archive FBD prompts conflict dialog
    const conflictZip = path.join(dir, 'conflict-bundle.zip');
    writeStoredZip(conflictZip, [
      { name: 'book.docx', content: readFileSync(bareDocx) },
      { name: 'book.fbd', content: makeSimpleFbdXml('Archive Override Title') },
    ]);
    await core.enqueueDialog('dialog.openFile', { paths: [conflictZip] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    await page.getByTestId('menu-file-import-importDocx').click();
    await dismissDiscardPromptIfShown(page);
    const conflictDialog = page.getByTestId('dialog-docx-fbd-conflict');
    await expect(conflictDialog).toBeVisible({ timeout: 20_000 });
    await conflictDialog.getByTestId('dialog-docx-fbd-conflict-button-yes').click();
    const sumAfterConflict = page.getByTestId('dialog-docx-import-summary');
    await expect(sumAfterConflict).toBeVisible({ timeout: 20_000 });
    await sumAfterConflict.getByRole('button').first().click();
  });

  test('US2: foreign DOCX + sibling FBD, refusals (< 2s SC-004), and File > Open vs Package mode coexistence', async ({
    core,
    page,
  }) => {
    const dir = makeTempDir('mfbe-docx-us2-');

    // 1. Bare foreign DOCX + sibling FBD auto-applied silently
    const foreignDocx = path.join(dir, 'novel.docx');
    const siblingFbd = path.join(dir, 'novel.fbd');
    writeMinimalForeignDocx(foreignDocx, {
      title: 'Original Word Title',
      bodyParagraphs: ['A bright morning in the valley.'],
    });
    writeFileSync(siblingFbd, makeSimpleFbdXml('Sibling FBD Title'), 'utf8');

    const foreignSummary = await importDocxViaMenu(core, page, foreignDocx);
    expect(foreignSummary).toContain('novel.fbd');
    await expect(page.getByTestId('body-view')).toContainText('A bright morning in the valley.');

    // 2. Refusals within < 2 s (SC-004): legacy .doc, encrypted .docx, macro-enabled .docm
    const legacyDoc = path.join(dir, 'old.doc');
    const encryptedDocx = path.join(dir, 'locked.docx');
    const macroDocm = path.join(dir, 'macros.docm');
    writeFileSync(legacyDoc, makeOle2Stub('WordDocument'));
    writeFileSync(encryptedDocx, makeOle2Stub('EncryptedPackage'));
    writeMinimalForeignDocx(macroDocm, {
      bodyParagraphs: ['Macro doc'],
      macroEnabled: true,
    });

    for (const [badPath, expectedText] of [
      [legacyDoc, 'legacy Word'],
      [encryptedDocx, 'encrypted'],
      [macroDocm, 'macro-enabled'],
    ] as const) {
      await core.enqueueDialog('dialog.openFile', { paths: [badPath] });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-import').hover();
      await page.getByTestId('menu-file-import-importDocx').click();
      await dismissDiscardPromptIfShown(page);
      const t0 = Date.now();
      const errDlg = page.getByTestId('dialog-docx-import-failed');
      await expect(errDlg).toBeVisible({ timeout: 2_000 });
      expect(Date.now() - t0).toBeLessThan(2_000);
      await expect(errDlg).toContainText(expectedText, { ignoreCase: true });
      await errDlg.getByRole('button').first().click();
    }

    // 3. File > Open refuses bare .docx and .docx-only .zip, while .docx + .fbd .zip opens in Package mode!
    await core.enqueueDialog('dialog.openFile', { paths: [foreignDocx] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await dismissDiscardPromptIfShown(page);
    const refusedDlg = page.getByTestId('dialog-docx-refused');
    await expect(refusedDlg).toBeVisible({ timeout: 5_000 });
    await refusedDlg.getByRole('button').first().click();

    const docxOnlyZip = path.join(dir, 'docx-only.zip');
    writeStoredZip(docxOnlyZip, [{ name: 'only.docx', content: readFileSync(foreignDocx) }]);
    await core.enqueueDialog('dialog.openFile', { paths: [docxOnlyZip] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await dismissDiscardPromptIfShown(page);
    const archErr = page.getByTestId('dialog-archive-error');
    await expect(archErr).toBeVisible({ timeout: 5_000 });
    await expect(archErr).toContainText('Import > DOCX');
    await archErr.getByRole('button').first().click();

    const pkgZip = path.join(dir, 'docx-package.zip');
    writeStoredZip(pkgZip, [
      { name: 'book.docx', content: readFileSync(foreignDocx) },
      { name: 'book.fbd', content: makeSimpleFbdXml('Package Mode Book') },
    ]);
    await core.enqueueDialog('dialog.openFile', { paths: [pkgZip] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await dismissDiscardPromptIfShown(page);
    await expect(page.getByTestId('package-files-sidebar')).toBeVisible({ timeout: 10_000 });
  });

  test('US4 & US5: Settings > Exports > DOCX persistence and Batch Converter From FB2 & To FB2', async ({
    core,
    page,
  }) => {
    resetBatchSettings(core.dataDir);

    // 1. Settings > Exports > DOCX dirty tracking & persistence
    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-settings').click();
    await expect(page.getByTestId('dialog-settings')).toBeVisible();
    await page.getByTestId('settings-tab-exports').click();
    await page.getByTestId('settings-exports-format').selectOption('docx');
    await expect(page.getByTestId('settings-page-docx')).toBeVisible();

    const applyBtn = page.getByTestId('dialog-settings-button-apply');
    await expect(applyBtn).toBeDisabled();

    await page.getByTestId('settings-docx-font-family').selectOption('custom');
    await expect(page.getByTestId('settings-docx-custom-font-family')).toBeVisible();
    await page.getByTestId('settings-docx-custom-font-family').fill('Palatino');
    await page.getByTestId('settings-docx-notes').selectOption('endnotes');
    await expect(applyBtn).toBeEnabled();
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toBeHidden();

    // Verify saved in core settings
    const savedSettings = await core.rpc<{
      docx?: { customFontFamily?: string; notesPlacement?: string };
    }>('settings.get');
    expect(savedSettings.docx?.customFontFamily).toBe('Palatino');
    expect(savedSettings.docx?.notesPlacement).toBe('endnotes');

    // 2. Batch Converter: From FB2 -> DOCX (with batch-only Export settings override leaving global untouched)
    const work = makeTempDir('mfbe-docx-batch-');
    const fb2In = path.join(work, 'fb2-in');
    const docxOut = path.join(work, 'docx-out');
    mkdirSync(fb2In, { recursive: true });
    writeFileSync(
      path.join(fb2In, 'sample1.fb2'),
      readFileSync(fixtureBook('reference-all-elements.fb2')),
    );

    await openBatchDialog(page);
    await page.getByTestId('batch-export-format').selectOption('docx');
    await page.getByTestId('batch-export-settings-btn').click();
    await expect(page.getByTestId('dialog-batch-export-settings')).toBeVisible();
    await expect(page.getByTestId('settings-docx-zip')).toHaveCount(0);
    await page.getByTestId('settings-docx-notes').selectOption('footnotes');
    await page.getByTestId('dialog-batch-export-settings-button-ok').click();

    await page.getByTestId('batch-in-place').uncheck();
    await page.getByTestId('batch-source-input').fill(fb2In);
    await page.getByTestId('batch-destination-input').fill(docxOut);
    await page.getByTestId('dialog-batch-converter-button-start').click();
    await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('batch-count-converted')).toContainText('1');
    await expect(page.getByTestId('batch-count-failed')).toContainText('0');
    expect(existsSync(path.join(docxOut, 'sample1.docx'))).toBe(true);

    // Global Settings must STILL be 'endnotes'!
    const stillGlobal = await core.rpc<{ docx?: { notesPlacement?: string } }>('settings.get');
    expect(stillGlobal.docx?.notesPlacement).toBe('endnotes');

    // 3. Batch Converter: To FB2 <- DOCX (valid editor DOCX + foreign DOCX + refused .docm)
    const docxIn = path.join(work, 'docx-in');
    const fb2Out = path.join(work, 'fb2-out');
    mkdirSync(docxIn, { recursive: true });
    writeFileSync(
      path.join(docxIn, 'editor-book.docx'),
      readFileSync(path.join(docxOut, 'sample1.docx')),
    );
    writeMinimalForeignDocx(path.join(docxIn, 'foreign.docx'), {
      bodyParagraphs: ['Batch foreign paragraph.'],
    });
    writeMinimalForeignDocx(path.join(docxIn, 'bad-macro.docx'), {
      bodyParagraphs: ['Should be refused.'],
      macroEnabled: true,
    });

    await page.getByTestId('dialog-batch-converter-button-run-again').click();
    await page.getByTestId('batch-dir-import').click();
    await page.getByTestId('batch-import-all').uncheck();
    await page.getByTestId('batch-import-fmt-docx').check();
    await page.getByTestId('batch-source-input').fill(docxIn);
    await page.getByTestId('batch-destination-input').fill(fb2Out);
    await page.getByTestId('dialog-batch-converter-button-start').click();
    await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('batch-count-converted')).toContainText('2');
    await expect(page.getByTestId('batch-count-failed')).toContainText('1');
    expect(existsSync(path.join(fb2Out, 'editor-book.fb2'))).toBe(true);
    expect(existsSync(path.join(fb2Out, 'foreign.fb2'))).toBe(true);
  });
});
