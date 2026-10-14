/**
 * User Story 4 - Edit the XML source and validate (T078).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in the core-less mode. Native dialogs are answered from the queue (`test.enqueueDialog`).
 *
 * Scenarios (spec.md US4):
 *  1. Validate lists each problem with line, column and message; a clean document shows
 *     "No errors found."
 *  2. malformed XML in the Source view: switching to Body is refused with the FBE message
 *  3. Go to matching tag moves between the paired opening/closing tags
 *  4. Source settings (wrap, highlighting, EOL/white-space marks, line numbers, matched tags)
 *     apply immediately
 *  5. collapse/expand level 1-9 fold/unfold the XML nesting levels
 *  6. Save with validation errors warns ("Validation failed ... save anyway?") and saves only on
 *     confirmation
 *  plus: Go to wrong tag positions the cursor on the first error, the fix is picked up by the
 *  Body view, the Insert key switches to overtype mode.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, fixtureBook, test, type CoreHandle, type RpcCallError } from './fixtures/core';
import type { Page } from '@playwright/test';
import { MOD } from './fixtures/keys';

const APP_TITLE = 'Maxima Fiction Book Editor';

/** A well-formed FB2 book with one schema error (unknown element) and one dangling link. */
function invalidBook(dir: string): string {
  const file = path.join(dir, 'invalid.fb2');
  if (existsSync(file)) return file;
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
\t<description>
\t\t<title-info>
\t\t\t<genre>prose_classic</genre>
\t\t\t<author><first-name>A</first-name><last-name>B</last-name></author>
\t\t\t<book-title>Invalid book</book-title>
\t\t\t<lang>en</lang>
\t\t</title-info>
\t\t<document-info>
\t\t\t<author><nickname>fixture</nickname></author>
\t\t\t<date value="2026-01-01">2026</date>
\t\t\t<id>fixture-invalid</id>
\t\t\t<version>1.0</version>
\t\t</document-info>
\t</description>
\t<body>
\t\t<section>
\t\t\t<title><p>Chapter</p></title>
\t\t\t<p>Good paragraph.</p>
\t\t\t<wrongtag>
\t\t\t\tThis element is not allowed here.
\t\t\t</wrongtag>
\t\t\t<p>Another <a l:href="#missing">dangling</a> paragraph.</p>
\t\t</section>
\t</body>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

/** The same book without the problems. */
function fixedText(text: string): string {
  return text
    .replace(
      /<wrongtag>\s*This element is not allowed here\.\s*<\/wrongtag>/,
      '<p>Fixed element.</p>',
    )
    .replace('<a l:href="#missing">dangling</a>', 'plain');
}

/** A valid book with a JPEG cover (binary placeholders in the Source view), or null without the image. */
function bookWithBinary(dir: string): string | null {
  const image = path.resolve(path.dirname(fixtureBook('x')), '..', 'images', 'tiny.jpg');
  if (!existsSync(image)) return null;
  const file = path.join(dir, 'with-binary.fb2');
  if (existsSync(file)) return file;
  const base64 = readFileSync(image).toString('base64');
  const text = fixedText(readFileSync(invalidBook(dir), 'utf8'))
    .replace(
      '<lang>en</lang>',
      '<coverpage><image l:href="#cover.jpg"/></coverpage>\n\t\t\t<lang>en</lang>',
    )
    .replace(
      '</FictionBook>',
      `\t<binary id="cover.jpg" content-type="image/jpeg">${base64}</binary>\n</FictionBook>`,
    );
  writeFileSync(file, text, 'utf8');
  return file;
}

async function supportsDocuments(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('doc.recent')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

async function openViaDialog(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
}

async function openInvalidBook(core: CoreHandle, page: Page, dir: string): Promise<string> {
  const file = invalidBook(dir);
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await openViaDialog(core, page, file);
  await expect(page.getByTestId('body-view')).toBeVisible();
  await expect(page).toHaveTitle(`invalid.fb2 - ${APP_TITLE}`);
  return file;
}

async function showSource(page: Page): Promise<void> {
  await page.getByTestId('view-source').click();
  await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
}

/** Replaces the whole Source text with the given text (select all + insert). */
async function replaceSourceText(page: Page, text: string): Promise<void> {
  await showSource(page);
  const editor = page.getByTestId('source-editor');
  await editor.click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.insertText(text);
}

/**
 * The text the Source view shows for `file`: the core's serialisation with elided binaries
 * (CodeMirror renders only the visible lines, so the DOM cannot provide the whole text).
 */
async function serialisedText(core: CoreHandle, file: string): Promise<string> {
  const opened = await core.rpcJob<{ document: { docId: string } }>('doc.open', { path: file });
  try {
    const { text } = await core.rpc<{ text: string }>('doc.toXml', {
      docId: opened.document.docId,
      document: opened.document,
      elideBinaries: true,
    });
    return text;
  } finally {
    await core.rpc('doc.close', { docId: opened.document.docId });
  }
}

async function validate(page: Page): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-validate').click();
  await expect(page.getByTestId('validation-panel')).toBeVisible();
}

const activeLine = (page: Page) => page.locator('.mfbe-source-editor .cm-activeLine').first();

test.describe('US4 - edit the XML source and validate', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us4-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.* yet');
  });

  test('1. Validate lists line/column/message, Go to wrong tag positions the cursor, a fixed document is clean', async ({
    core,
    page,
  }) => {
    const file = await openInvalidBook(core, page, dir);

    // Validate from the Body view: the non-modal panel lists the problems.
    await validate(page);
    await expect(page.getByTestId('status-message')).toHaveText('1 error found.');
    await expect(page.getByTestId('validation-summary')).toContainText('1 error found.');
    const errorRow = page.locator('[data-testid^="validation-issue-"][data-severity="error"]');
    await expect(errorRow).toHaveCount(1);
    await expect(errorRow).toContainText('Error');
    await expect(errorRow).toContainText('wrongtag');
    const line = Number(await errorRow.getAttribute('data-line'));
    expect(line).toBeGreaterThan(0);
    expect(Number(await errorRow.getAttribute('data-column'))).toBeGreaterThanOrEqual(0);
    await expect(errorRow.locator('.mfbe-validation-line')).toHaveText(String(line));
    // the dangling link is a warning (FR-012)
    await expect(
      page.locator('[data-testid^="validation-issue-"][data-severity="warning"]'),
    ).toContainText('#missing');

    // Edit > Go to wrong tag (from the Body view): the Source view opens on the bad element.
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-gotoWrongTag').click();
    await expect(page.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    await expect(activeLine(page)).toContainText('<wrongtag>');
    await expect(page.locator('.mfbe-source-target-line')).toHaveCount(1);

    // Double-clicking the issue in the panel navigates there as well (line highlighted).
    await page.locator('.mfbe-source-editor .cm-content').click();
    await page.keyboard.press(`${MOD}+End`);
    await errorRow.dblclick();
    await expect(activeLine(page)).toContainText('<wrongtag>');

    // Fix the problems in the Source view and validate again: clean.
    const current = await serialisedText(core, file);
    expect(current).toContain('<wrongtag>');
    await replaceSourceText(page, fixedText(current));
    await expect(page).toHaveTitle(`invalid.fb2* - ${APP_TITLE}`);
    await validate(page);
    await expect(page.getByTestId('validation-empty')).toHaveText('No errors found.');
    await expect(page.getByTestId('status-message')).toHaveText('No errors found.');

    // Go to wrong tag with a clean document reports the same.
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-gotoWrongTag').click();
    await expect(page.getByTestId('status-message')).toHaveText('No errors found.');

    // The Body view shows the fix and the document can be saved.
    await page.getByTestId('view-body').click();
    await expect(page.getByTestId('body-view')).toBeVisible();
    await expect(page.getByTestId('body-editor')).toContainText('Fixed element.');
    const target = path.join(dir, 'scenario1-fixed.fb2');
    await core.enqueueDialog('dialog.saveFile', { path: target, encoding: 'utf-8' });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-saveAs').click();
    await expect(page.getByTestId('status-message')).toHaveText(
      'Document saved - No errors found.',
    );
    await expect.poll(() => existsSync(target)).toBe(true);
    const saved = readFileSync(target, 'utf8');
    expect(saved).toContain('Fixed element.');
    expect(saved).not.toContain('wrongtag');
  });

  test('2. malformed XML blocks the switch to Body until it is corrected; Go to wrong tag finds the parse error', async ({
    core,
    page,
  }) => {
    const file = await openInvalidBook(core, page, dir);
    await showSource(page);
    const original = await serialisedText(core, file);
    // Break the XML: the closing tag of the good paragraph disappears.
    await replaceSourceText(page, original.replace('Good paragraph.</p>', 'Good paragraph.'));

    await page.getByTestId('view-body').click();
    const badXml = page.getByTestId('dialog-bad-xml');
    await expect(badXml).toBeVisible();
    await expect(page.getByTestId('dialog-bad-xml-text')).toContainText(
      'use "Validate" and "Go to wrong tag" commands',
    );
    await page.getByTestId('dialog-bad-xml-button-ok').click();
    await expect(page.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('source-parse-error')).toBeVisible();
    await expect(page.getByTestId('source-parse-error')).toContainText(/line \d+, column \d+/);

    // Validate reports the parse error with its position.
    await validate(page);
    const notWellFormed = page.locator('[data-testid^="validation-issue-"]').first();
    await expect(notWellFormed).toHaveAttribute('data-severity', 'error');
    await expect(notWellFormed).toContainText('XML is not well-formed');
    expect(Number(await notWellFormed.getAttribute('data-line'))).toBeGreaterThan(0);

    // Go to wrong tag re-parses the text and puts the cursor on the parse error.
    await page.locator('.mfbe-source-editor .cm-content').click();
    await page.keyboard.press(`${MOD}+Home`);
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-gotoWrongTag').click();
    await expect(page.locator('.mfbe-source-target-line')).toHaveCount(1);
    await expect(page.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');

    // Repair: the Body view is available again.
    await replaceSourceText(page, original);
    await page.getByTestId('view-body').click();
    await expect(page.getByTestId('body-view')).toBeVisible();
    await expect(page.getByTestId('body-editor')).toContainText('Good paragraph.');
  });

  test('3. Go to matching tag moves between the opening and closing tag; the pair is highlighted', async ({
    core,
    page,
  }) => {
    await openInvalidBook(core, page, dir);
    await showSource(page);
    // Put the cursor on <wrongtag> (multi-line element) through Go to wrong tag.
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-gotoWrongTag').click();
    await expect(activeLine(page)).toContainText('<wrongtag>');
    // Syntax highlighting splits a tag into several spans: compare the joined text.
    const highlighted = page.locator('.mfbe-source-editor .mfbe-source-tag-match');
    const highlightedText = async () => (await highlighted.allTextContents()).join('');
    await expect.poll(highlightedText).toBe('<wrongtag></wrongtag>');

    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-gotoMatchTag').click();
    await expect(activeLine(page)).toContainText('</wrongtag>');
    await expect(activeLine(page)).not.toContainText('<wrongtag>');
    // and back (hotkey of the original: Alt+Shift+;)
    await page.getByTestId('source-goto-match-tag').click();
    await expect(activeLine(page)).toContainText('<wrongtag>');

    // Matched-tag highlighting is a setting.
    await core.rpc('settings.set', { patch: { view: { sourceMatchTags: false } } });
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-match-tags', 'false');
    await expect(highlighted).toHaveCount(0);
    await core.rpc('settings.set', { patch: { view: { sourceMatchTags: true } } });
    await expect.poll(highlightedText).toBe('<wrongtag></wrongtag>');
  });

  test('4. Source settings apply immediately: line numbers, wrap, EOL and white-space marks, highlighting, font', async ({
    core,
    page,
  }) => {
    await openInvalidBook(core, page, dir);
    await showSource(page);
    const view = page.getByTestId('source-view');
    const lineNumbers = page.locator('.mfbe-source-editor .cm-lineNumbers');
    const eolMarks = page.locator('.mfbe-source-editor .mfbe-source-eol');
    const spaceMarks = page.locator('.mfbe-source-editor .cm-highlightTab');
    const highlightedTag = page.locator('.mfbe-source-editor .cm-line [class*="ͼ"]');

    await expect(lineNumbers).toBeVisible();
    await expect(eolMarks).toHaveCount(0);
    await expect(spaceMarks).toHaveCount(0);
    expect(await highlightedTag.count()).toBeGreaterThan(0);
    await expect(view).toHaveAttribute('data-wrap', 'true');

    try {
      await core.rpc('settings.set', {
        patch: {
          view: {
            sourceLineNumbers: false,
            sourceWrap: false,
            sourceShowEol: true,
            sourceShowWhitespace: true,
            sourceSyntaxHighlight: false,
            sourceFont: 'Courier New, 11',
          },
        },
      });
      await expect(view).toHaveAttribute('data-line-numbers', 'false');
      await expect(view).toHaveAttribute('data-wrap', 'false');
      await expect(view).toHaveAttribute('data-show-eol', 'true');
      await expect(view).toHaveAttribute('data-show-whitespace', 'true');
      await expect(view).toHaveAttribute('data-highlight', 'false');
      await expect(lineNumbers).toHaveCount(0);
      expect(await eolMarks.count()).toBeGreaterThan(0);
      expect(await spaceMarks.count()).toBeGreaterThan(0);
      await expect(highlightedTag).toHaveCount(0);
      await expect(page.locator('.mfbe-source-editor .cm-content')).not.toHaveClass(
        /cm-lineWrapping/,
      );
      const font = await page.locator('.mfbe-source-editor .cm-editor').evaluate((node) => {
        const style = node.ownerDocument.defaultView!.getComputedStyle(node);
        return { family: style.fontFamily, size: style.fontSize };
      });
      expect(font.family).toContain('Courier New');
      expect(font.size).toBe('11px');
    } finally {
      await core.rpc('settings.set', {
        patch: {
          view: {
            sourceLineNumbers: true,
            sourceWrap: true,
            sourceShowEol: false,
            sourceShowWhitespace: false,
            sourceSyntaxHighlight: true,
            sourceFont: '',
          },
        },
      });
    }
    await expect(lineNumbers).toBeVisible();
    await expect(eolMarks).toHaveCount(0);
    await expect(page.locator('.mfbe-source-editor .cm-content')).toHaveClass(/cm-lineWrapping/);
  });

  test('5. collapse/expand level commands fold and unfold the XML nesting levels', async ({
    core,
    page,
  }) => {
    await openInvalidBook(core, page, dir);
    await showSource(page);
    const placeholders = page.locator('.mfbe-source-editor .cm-foldPlaceholder');
    await expect(placeholders).toHaveCount(0);

    // Level 2 = the children of the root element: <description> and <body>.
    await page.getByTestId('source-fold-level').selectOption('2');
    await page.getByTestId('source-fold-collapse').click();
    await expect(placeholders).toHaveCount(2);
    await expect(page.locator('.mfbe-source-editor .cm-content')).not.toContainText(
      'Good paragraph.',
    );
    // Level 3 adds <title-info>, <document-info> and <section>.
    await page.getByTestId('source-fold-level').selectOption('3');
    await page.getByTestId('source-fold-collapse').click();
    await expect(placeholders).toHaveCount(2); // still hidden inside the level-2 folds
    await page.getByTestId('source-fold-level').selectOption('2');
    await page.getByTestId('source-fold-expand').click();
    await expect(placeholders).toHaveCount(3);
    await page.getByTestId('source-fold-level').selectOption('3');
    await page.getByTestId('source-fold-expand').click();
    await expect(placeholders).toHaveCount(0);
    await expect(page.locator('.mfbe-source-editor .cm-content')).toContainText('Good paragraph.');

    // Level 1 = the root element: the whole document collapses to one line.
    await page.getByTestId('source-fold-level').selectOption('1');
    await page.getByTestId('source-fold-collapse').click();
    await expect(placeholders).toHaveCount(1);
    await page.getByTestId('source-fold-expand').click();
    await expect(placeholders).toHaveCount(0);
  });

  test('6. saving a document with validation errors asks first and saves only on Yes', async ({
    core,
    page,
  }) => {
    await openInvalidBook(core, page, dir);
    const target = path.join(dir, 'scenario6-invalid-saved.fb2');

    // No: nothing is written.
    await core.enqueueDialog('dialog.saveFile', { path: target, encoding: 'utf-8' });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-saveAs').click();
    const prompt = page.getByTestId('dialog-validation-failed');
    await expect(prompt).toBeVisible();
    await expect(page.getByTestId('dialog-validation-failed-text')).toContainText(
      'Do you still want to save the file?',
    );
    await expect(page.getByTestId('dialog-validation-failed-text')).toContainText(
      'WARNING: Invalid files can be improperly displayed',
    );
    await page.getByTestId('dialog-validation-failed-button-no').click();
    await expect(prompt).toBeHidden();
    expect(existsSync(target)).toBe(false);
    await expect(page).toHaveTitle(`invalid.fb2 - ${APP_TITLE}`);

    // Yes: written despite the errors, the status reports them.
    await core.enqueueDialog('dialog.saveFile', { path: target, encoding: 'utf-8' });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-saveAs').click();
    await expect(prompt).toBeVisible();
    await page.getByTestId('dialog-validation-failed-button-yes').click();
    await expect(prompt).toBeHidden();
    await expect(page.getByTestId('status-message')).toHaveText('1 error found.');
    await expect(page).toHaveTitle(`scenario6-invalid-saved.fb2 - ${APP_TITLE}`);
    expect(readFileSync(target, 'utf8')).toContain('<wrongtag>');
  });

  test('7. binary placeholders are inert widgets and survive the Source round trip', async ({
    core,
    page,
  }) => {
    const file = bookWithBinary(dir);
    test.skip(!file, 'tests/fixtures/images/tiny.jpg is missing');
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
    await openViaDialog(core, page, file!);
    await expect(page.getByTestId('body-view')).toBeVisible();
    await showSource(page);

    // The binary sits at the end of the document: scroll there (only visible lines are drawn).
    await page.locator('.mfbe-source-editor .cm-content').click();
    await page.keyboard.press(`${MOD}+End`);
    const placeholder = page.getByTestId('source-binary-placeholder');
    await expect(placeholder).toHaveCount(1);
    await expect(placeholder).toContainText('bytes');
    expect(Number(await placeholder.getAttribute('data-size'))).toBeGreaterThan(0);
    await expect(page.locator('.mfbe-source-editor .cm-content')).toContainText(
      '<binary id="cover.jpg" content-type="image/jpeg">',
    );
    const text = await serialisedText(core, file!);
    expect(text).toContain('<binary id="cover.jpg" content-type="image/jpeg">\u2026');
    expect(text).not.toMatch(/\/9j\//); // no base64 in the Source view

    // An edit elsewhere keeps the binary: the saved file carries the real data again.
    await replaceSourceText(page, text.replace('Fixed element.', 'Fixed element, edited.'));
    const target = path.join(dir, 'scenario7-binary.fb2');
    await core.enqueueDialog('dialog.saveFile', { path: target, encoding: 'utf-8' });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-saveAs').click();
    await expect(page.getByTestId('status-message')).toHaveText(
      'Document saved - No errors found.',
    );
    const saved = readFileSync(target, 'utf8');
    expect(saved).toContain('Fixed element, edited.');
    expect(saved).toMatch(/<binary id="cover.jpg" content-type="image\/jpeg">\s*\/9j\//);
    expect(saved).not.toContain('bytes\u2026');
  });

  test('8. Insert toggles overtype mode (INS/OVR)', async ({ core, page }) => {
    await openInvalidBook(core, page, dir);
    await showSource(page);
    const insMode = page.getByTestId('status-insmode');
    await expect(insMode).toHaveText('INS');
    const content = page.locator('.mfbe-source-editor .cm-content');
    await content.click();
    await page.keyboard.press(`${MOD}+Home`);
    await page.keyboard.press('Insert');
    await expect(insMode).toHaveText('OVR');
    await expect(insMode).toHaveAttribute('data-mode', 'overwrite');
    // The first line is the XML declaration: typing replaces "<?xml" character by character.
    await page.keyboard.type('<?XML');
    await expect(activeLine(page)).toContainText('<?XML version=');
    await page.keyboard.press('Insert');
    await expect(insMode).toHaveText('INS');
    await page.keyboard.type('!');
    await expect(activeLine(page)).toContainText('<?XML! version=');
    await expect(page).toHaveTitle(`invalid.fb2* - ${APP_TITLE}`);
  });
});
