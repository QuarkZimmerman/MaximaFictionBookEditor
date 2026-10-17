/**
 * User Story 1 - Open, review and save a book without loss (T039).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`) or the
 * dependency-free stand-in (`MFBE_CORE_BIN=tests/e2e/fixtures/fake-core.mjs`); skipped in the
 * core-less mode and when the core does not implement `doc.*` yet. Native dialogs are answered
 * from the queue (`test.enqueueDialog`); the failed-save case uses `test.injectFault`.
 *
 * Scenarios (spec.md US1):
 *  1. windows-1251 FB2 2.0 book -> Save As UTF-8 -> validates, same text/structure/binaries
 *  2. "Keep encoding" -> Save keeps windows-1251 (and the encoding chooser preselects it)
 *  3. malformed XML -> error with line/column, Source-only mode, Body switch refused, fixable
 *  4. unsaved changes -> "Save changes to X?" on New / Open / Exit, answers honoured
 *  5. external change -> "has been changed by another application" prompt, reload on Yes
 *  6. failed save -> error message, original bytes intact, document still modified
 *
 * The interface texts the journey waits for come from the catalogues in the language the page
 * shows (fixtures/i18n.ts): the `chromium-ru` and `chromium-uk` projects run the same journey
 * with `?lang=ru` and `?lang=uk` (feature 002 FR-091, feature 003 FR-005).
 */

import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  expect,
  fixtureBook,
  test,
  waitForBook,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import { pagePattern, pageText, untitledTitle } from './fixtures/i18n';
import type { Page } from '@playwright/test';
import { MOD } from './fixtures/keys';

interface DocumentJson {
  docId: string;
  sourceEncoding: string;
  schemaHint: string;
  bodies: unknown[];
  binaries: { id: string; contentType: string; size: number }[];
  description: { titleInfo: { bookTitle: string; authors: unknown[]; genres: unknown[] } };
}

interface ValidationJson {
  errorCount: number;
  warningCount: number;
  issues: unknown[];
}

const APP_TITLE = 'Maxima Fiction Book Editor';

/**
 * A valid FB2 2.0 book in windows-1251 (xlink prefix, 2.0-era layout) generated into `dir`,
 * with a JPEG binary when the image fixture exists. Generated rather than taken from
 * `tests/fixtures/books/legacy-cp1251.fb2`, whose text-only <annotation> is deliberately
 * invalid against 2.1 and therefore triggers the save-anyway prompt.
 */
function legacyBook(dir: string): string {
  const file = path.join(dir, 'legacy-cp1251.fb2');
  if (existsSync(file)) return file;
  const image = path.resolve(path.dirname(fixtureBook('x')), '..', 'images', 'tiny.jpg');
  const binary = existsSync(image) ? readFileSync(image).toString('base64') : null;
  const xml = `<?xml version="1.0" encoding="windows-1251"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:xlink="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>prose_classic</genre>
<author><first-name>Антон</first-name><middle-name>Павлович</middle-name><last-name>Чехов</last-name></author>
<book-title>Старая книга</book-title>
<annotation><p>Аннотация старой книги.</p></annotation>
<date value="1890-01-01">1890</date>
${binary ? '<coverpage><image xlink:href="#cover.jpg"/></coverpage>\n' : ''}<lang>ru</lang>
</title-info>
<document-info>
<author><nickname>maker</nickname></author>
<program-used>FB Tools 2.0</program-used>
<date value="2005-03-01">1 марта 2005</date>
<id>legacy-0001</id>
<version>1.1</version>
</document-info>
</description>
<body>
<title><p>Старая книга</p></title>
<section id="s1">
<title><p>Глава первая</p></title>
<p>Первый абзац с <strong>жирным</strong> и <emphasis>курсивом</emphasis>, а также сноска<a xlink:href="#n_1" type="note">[1]</a>.</p>
<empty-line/>
<p>Второй абзац: «ёлка», «Ёж», тире — и кавычки.</p>
</section>
<section>
<title><p>Глава вторая</p></title>
<section><p>Вложенный раздел без заголовка.</p></section>
</section>
</body>
<body name="notes">
<title><p>Примечания</p></title>
<section id="n_1"><title><p>1</p></title><p>Текст первой сноски.</p></section>
</body>
${binary ? `<binary id="cover.jpg" content-type="image/jpeg">${binary}</binary>\n` : ''}</FictionBook>
`;
  writeFileSync(file, encodeCp1251(xml));
  return file;
}

function malformedBook(dir: string): string {
  const fixture = fixtureBook('malformed.fb2');
  if (existsSync(fixture)) return fixture;
  const file = path.join(dir, 'malformed.fb2');
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
\t<description>
\t\t<title-info><genre>prose_contemporary</genre><author><first-name>A</first-name><last-name>B</last-name></author><book-title>Malformed</book-title><lang>en</lang></title-info>
\t\t<document-info><author><nickname>fixture</nickname></author><date value="2026-01-01">2026</date><id>fixture-malformed</id><version>1.0</version></document-info>
\t</description>
\t<body>
\t\t<section>
\t\t\t<p>This paragraph is never closed
\t\t</section>
\t</body>
</FictionBook>
`,
  );
  return file;
}

/** windows-1251 encoder for the generated fixture (ASCII, Cyrillic and common punctuation). */
function encodeCp1251(text: string): Buffer {
  const extra: Record<string, number> = {
    '\u0401': 0xa8,
    '\u0451': 0xb8,
    '\u00ab': 0xab,
    '\u00bb': 0xbb,
    '\u2014': 0x97,
    '\u2013': 0x96,
    '\u2026': 0x85,
    '\u2116': 0xb9,
    '\u00a0': 0xa0,
  };
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else if (code >= 0x410 && code <= 0x44f) out.push(code - 0x410 + 0xc0);
    else if (ch in extra) out.push(extra[ch]!);
    else out.push(0x3f);
  }
  return Buffer.from(out);
}

function decodeCp1251(bytes: Buffer): string {
  return new TextDecoder('windows-1251').decode(bytes);
}

/** Opens `file` through File > Open with the queued native dialog. */
async function openViaDialog(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
}

/** Decodes a fixture (windows-1251 or UTF-8 by its declaration) to a string. */
function readBookText(file: string): string {
  const bytes = readFileSync(file);
  const head = bytes.subarray(0, 200).toString('latin1');
  return /windows-1251/i.test(head) ? decodeCp1251(bytes) : bytes.toString('utf8');
}

/** Replaces the whole Source text with the given text (select all + insert). */
async function replaceSourceText(page: Page, text: string): Promise<void> {
  await page.getByTestId('view-source').click();
  await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
  const editor = page.getByTestId('source-editor');
  await editor.click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.insertText(text);
}

/**
 * Makes the document modified through the Source view: the first paragraph of `file` gets a
 * `[marker]` suffix, so the edit survives the save (unlike an XML comment).
 */
async function editInSource(page: Page, file: string, marker: string): Promise<void> {
  const edited = readBookText(file).replace('Первый абзац', `Первый абзац [${marker}]`);
  await replaceSourceText(page, edited);
  await expect(page).toHaveTitle(new RegExp(`\\* - ${APP_TITLE}$`));
}

async function supportsDocuments(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('doc.recent')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

/** Bodies with node ids removed: structural comparison of two documents. */
function stripNodeIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNodeIds);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'nodeId') continue;
      out[key] = stripNodeIds(inner);
    }
    return out;
  }
  return value;
}

test.describe('US1 - open, review and save a book without loss', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us1-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.* yet (US1)');
  });

  test('1. opens a windows-1251 FB2 2.0 book, shows it in all views and saves it as valid UTF-8', async ({
    core,
    page,
  }) => {
    const source = legacyBook(dir);
    const target = path.join(dir, 'scenario1-utf8.fb2');
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );

    await openViaDialog(core, page, source);
    await expect(page.getByTestId('body-view')).toBeVisible();
    await expect(page.getByTestId('body-editor')).toContainText('Старая книга');
    await expect(page.getByTestId('body-editor').locator('.fb-section').first()).toBeVisible();
    await expect(page).toHaveTitle(`legacy-cp1251.fb2 - ${APP_TITLE}`);

    // Description summary and Source text of the same document.
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('description-book-title')).toHaveValue('Старая книга');
    await expect(page.getByTestId('description-encoding')).toHaveText('windows-1251');
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    await expect(page.getByTestId('source-editor')).toContainText(
      '<book-title>Старая книга</book-title>',
    );
    await page.getByTestId('view-body').click();
    await expect(page.getByTestId('body-view')).toBeVisible();

    // Save As with UTF-8 chosen in the (queued) native dialog.
    await core.enqueueDialog('dialog.saveFile', { path: target, encoding: 'utf-8' });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-saveAs').click();
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.savedNoErrors'),
    );
    await expect(page).toHaveTitle(`scenario1-utf8.fb2 - ${APP_TITLE}`);

    const bytes = readFileSync(target);
    const text = bytes.toString('utf8');
    expect(text).toMatch(/^<\?xml version="1.0" encoding="utf-8"\?>/i);
    expect(text).toContain('Старая книга');
    expect(text).toContain('xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"');

    // The saved file validates and is structurally identical to the original.
    const saved = await core.rpcJob<{ document: DocumentJson }>('doc.open', { path: target });
    const report = await core.rpcJob<ValidationJson>('doc.validate', {
      docId: saved.document.docId,
      document: saved.document,
    });
    expect(report.errorCount, JSON.stringify(report.issues)).toBe(0);
    const original = await core.rpcJob<{ document: DocumentJson }>('doc.open', { path: source });
    expect(saved.document.sourceEncoding).toBe('utf-8');
    expect(stripNodeIds(saved.document.bodies)).toEqual(stripNodeIds(original.document.bodies));
    expect(saved.document.description.titleInfo.bookTitle).toBe(
      original.document.description.titleInfo.bookTitle,
    );
    expect(saved.document.binaries.map((b) => [b.id, b.contentType, b.size])).toEqual(
      original.document.binaries.map((b) => [b.id, b.contentType, b.size]),
    );
    await core.rpc('doc.close', { docId: saved.document.docId });
    await core.rpc('doc.close', { docId: original.document.docId });
  });

  test('2. "Keep encoding" saves in the original encoding and preselects it in the chooser', async ({
    core,
    page,
  }) => {
    const copy = path.join(dir, 'scenario2-keep.fb2');
    copyFileSync(legacyBook(dir), copy);
    await core.rpc('settings.set', { patch: { other: { keepEncoding: true } } });
    try {
      await core.openApp(page);
      await expect(page.getByTestId('status-message')).toHaveText(
        await pageText(page, 'status.ready'),
      );
      await openViaDialog(core, page, copy);
      await waitForBook(page, copy);

      // Plain Save: no dialog, the file stays windows-1251.
      await page.getByTestId('toolbar-file.save').click();
      await expect(page.getByTestId('status-message')).toHaveText(
        await pageText(page, 'status.savedNoErrors'),
      );
      const savedBytes = readFileSync(copy);
      expect(savedBytes.toString('latin1')).toMatch(/encoding="windows-1251"/i);
      expect(decodeCp1251(savedBytes)).toContain('Старая книга');

      // Save As without an encoding from the native dialog: the chooser proposes windows-1251.
      const target = path.join(dir, 'scenario2-saveas.fb2');
      await core.enqueueDialog('dialog.saveFile', { path: target });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-saveAs').click();
      const chooser = page.getByTestId('dialog-encoding');
      await expect(chooser).toBeVisible();
      await expect(page.getByTestId('dialog-encoding-select')).toHaveValue('windows-1251');
      await page.getByTestId('dialog-encoding-button-ok').click();
      await expect(chooser).toBeHidden();
      // The status text is the same as after the plain Save above: wait for the new file.
      await expect(page).toHaveTitle(`scenario2-saveas.fb2 - ${APP_TITLE}`);
      await expect.poll(() => existsSync(target)).toBe(true);
      expect(readFileSync(target).toString('latin1')).toMatch(/encoding="windows-1251"/i);
    } finally {
      await core.rpc('settings.set', { patch: { other: { keepEncoding: false } } });
    }
  });

  test('3. a malformed file reports line/column, opens Source-only and refuses the Body view until fixed', async ({
    core,
    page,
  }) => {
    const file = malformedBook(dir);
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );

    await openViaDialog(core, page, file);
    const error = page.getByTestId('dialog-parse-error');
    await expect(error).toBeVisible();
    await expect(page.getByTestId('dialog-parse-error-text')).toHaveText(
      await pagePattern(page, 'msg.xmlParseError'),
    );
    await page.getByTestId('dialog-parse-error-button-ok').click();

    await expect(page.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('source-only-notice')).toBeVisible();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    await expect(page.getByTestId('source-editor')).toContainText('never closed');
    await expect(page).toHaveTitle(`malformed.fb2 - ${APP_TITLE}`);

    // Switching to Body is refused with the original message while the XML is malformed.
    await page.getByTestId('view-body').click();
    const badXml = page.getByTestId('dialog-bad-xml');
    await expect(badXml).toBeVisible();
    await expect(page.getByTestId('dialog-bad-xml-text')).toContainText(
      (await pageText(page, 'msg.badXml')).split('\n')[0]!,
    );
    await page.getByTestId('dialog-bad-xml-button-ok').click();
    await expect(page.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('source-parse-error')).toBeVisible();

    // Fix the text in the Source view: Body becomes available and shows the paragraph.
    const fixed = readFileSync(file, 'utf8').replace(
      'This paragraph is never closed',
      'This paragraph is now closed</p>',
    );
    await replaceSourceText(page, fixed);
    await page.getByTestId('view-body').click();
    await expect(page.getByTestId('body-view')).toBeVisible();
    await expect(page.getByTestId('body-editor')).toContainText('This paragraph is now closed');
    await expect(page.getByTestId('view-body')).toHaveAttribute('aria-selected', 'true');
  });

  test('3a. files that are not FictionBook documents are refused with a message and never opened', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );

    // Plain text, another XML vocabulary and binary content: one message each, no document.
    const notes = path.join(dir, 'notes.txt');
    writeFileSync(notes, 'Just a text file, not XML at all.\n');
    const html = path.join(dir, 'page.xml');
    writeFileSync(html, '<?xml version="1.0"?><html><body><p>FictionBook</p></body></html>');
    const binary = path.join(dir, 'image.bin');
    writeFileSync(binary, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]));
    for (const file of [notes, html, binary]) {
      await openViaDialog(core, page, file);
      const refused = page.getByTestId('dialog-not-fictionbook');
      await expect(refused).toBeVisible();
      await expect(page.getByTestId('dialog-not-fictionbook-text')).toHaveText(
        await pagePattern(page, 'msg.notFictionBook'),
      );
      await refused.getByTestId('dialog-not-fictionbook-button-ok').click();
      await expect(refused).toBeHidden();
      await expect(page.getByTestId('source-only-notice')).toHaveCount(0);
      await expect(page).toHaveTitle(APP_TITLE);
    }
    // The refused files are not remembered as recent files.
    await page.getByTestId('menu-file').click();
    await expect(page.getByTestId('menu-file-recent')).toBeVisible();
    await page.getByTestId('menu-file-recent').hover();
    await expect(page.getByTestId('menu-file-recent-popup')).not.toContainText('notes.txt');
    await page.keyboard.press('Escape');
  });

  test('4. unsaved changes prompt "Save changes to X?" on New, Open and Exit and honour the answer', async ({
    core,
    page,
  }) => {
    const copy = path.join(dir, 'scenario4-prompt.fb2');
    copyFileSync(legacyBook(dir), copy);
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    await openViaDialog(core, page, copy);
    await waitForBook(page, copy);
    await editInSource(page, copy, 'scenario four');

    // New -> Cancel keeps the document.
    await page.getByTestId('toolbar-file.new').click();
    const prompt = page.getByTestId('dialog-save-changes');
    await expect(prompt).toBeVisible();
    await expect(page.getByTestId('dialog-save-changes-text')).toHaveText(
      await pageText(page, 'msg.saveChanges', { name: 'scenario4-prompt.fb2' }),
    );
    await page.getByTestId('dialog-save-changes-button-cancel').click();
    await expect(prompt).toBeHidden();
    await expect(page).toHaveTitle(`scenario4-prompt.fb2* - ${APP_TITLE}`);

    // Exit -> Cancel keeps the application running with the document.
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-exit').click();
    await expect(prompt).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(prompt).toBeHidden();
    await expect(page).toHaveTitle(`scenario4-prompt.fb2* - ${APP_TITLE}`);

    // Open -> No discards the changes; the cancelled file dialog leaves no document.
    await core.enqueueDialog('dialog.openFile', { paths: [] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await expect(prompt).toBeVisible();
    await page.getByTestId('dialog-save-changes-button-no').click();
    await expect(prompt).toBeHidden();
    await expect(page).toHaveTitle(`scenario4-prompt.fb2* - ${APP_TITLE}`);
    expect(readFileSync(copy, 'latin1')).not.toContain('scenario four');

    // New -> Yes saves first (the comment lands in the file), then creates the blank document.
    await page.getByTestId('toolbar-file.new').click();
    await expect(prompt).toBeVisible();
    await page.getByTestId('dialog-save-changes-button-yes').click();
    await expect(prompt).toBeHidden();
    await expect(page).toHaveTitle(await untitledTitle(page));
    await expect(page.getByTestId('body-view')).toBeVisible();
    expect(readFileSync(copy, 'latin1')).toContain('scenario four');
  });

  test('5. a file changed by another application triggers the reload prompt', async ({
    core,
    page,
  }) => {
    const copy = path.join(dir, 'scenario5-external.fb2');
    copyFileSync(legacyBook(dir), copy);
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    await openViaDialog(core, page, copy);
    await waitForBook(page, copy);

    // Another program rewrites the file (new size + mtime) with a changed title.
    await page.waitForTimeout(1200);
    const changed = decodeCp1251(readFileSync(copy))
      .replaceAll('Старая книга', 'Новая книга')
      .replace('windows-1251', 'utf-8');
    writeFileSync(copy, Buffer.from(changed, 'utf8'));

    const prompt = page.getByTestId('dialog-file-changed');
    await expect(prompt).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('dialog-file-changed-text')).toContainText(
      (await pageText(page, 'msg.fileChanged', { name: 'scenario5-external.fb2' })).split('\n')[0]!,
    );
    await page.getByTestId('dialog-file-changed-button-yes').click();
    await expect(prompt).toBeHidden();
    await expect(page.getByTestId('body-editor')).toContainText('Новая книга');
    await expect(page).toHaveTitle(`scenario5-external.fb2 - ${APP_TITLE}`);
  });

  test('6. a save that fails midway reports the error and leaves the file and the document untouched', async ({
    core,
    page,
  }) => {
    const copy = path.join(dir, 'scenario6-fault.fb2');
    copyFileSync(legacyBook(dir), copy);
    const before = readFileSync(copy);
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    await openViaDialog(core, page, copy);
    await waitForBook(page, copy);
    await editInSource(page, copy, 'scenario six');

    await core.rpc('test.injectFault', { point: 'before_rename' });
    await page.getByTestId('toolbar-file.save').click();
    const failed = page.getByTestId('dialog-save-failed');
    await expect(failed).toBeVisible();
    await expect(page.getByTestId('dialog-save-failed-text')).toHaveText(
      await pagePattern(page, 'msg.saveFailed'),
    );
    await page.getByTestId('dialog-save-failed-button-ok').click();

    expect(readFileSync(copy).equals(before)).toBe(true);
    await expect(page).toHaveTitle(`scenario6-fault.fb2* - ${APP_TITLE}`);

    // Without the fault the same save succeeds.
    await core.rpc('test.injectFault', { point: 'none' });
    await page.getByTestId('toolbar-file.save').click();
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.savedNoErrors'),
    );
    await expect(page).toHaveTitle(`scenario6-fault.fb2 - ${APP_TITLE}`);
    expect(readFileSync(copy).equals(before)).toBe(false);
  });

  test('Recent Files lists opened books and reopens them; Validate shows the panel', async ({
    core,
    page,
  }) => {
    const copy = path.join(dir, 'scenario7-recent.fb2');
    copyFileSync(legacyBook(dir), copy);
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    await openViaDialog(core, page, copy);
    await waitForBook(page, copy);

    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-validate').click();
    const panel = page.getByTestId('validation-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('validation-summary')).toContainText(
      await pageText(page, 'status.noErrors'),
    );
    await page.getByTestId('validation-close').click();
    await expect(panel).toBeHidden();

    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-recent').hover();
    const popup = page.getByTestId('menu-file-recent-popup');
    await expect(popup).toBeVisible();
    await expect(popup.getByTestId('menu-file-recent-recent1')).toContainText(
      'scenario7-recent.fb2',
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });
});
