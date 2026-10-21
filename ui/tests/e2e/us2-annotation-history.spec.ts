/**
 * Feature 004, User Story 2 - Annotation and history are back at the top of the Body view
 * (T020; spec FR-010 to FR-015, SC-002).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`);
 * skipped in core-less mode. The scenarios:
 *
 *  1. `modern-utf8.fb2` shows `body-block-annotation`, then `body-block-history`, then the
 *     first body; each block is framed (a non-zero left border or a background differing from
 *     the editor's, in the light and in the dark theme) and captioned through `::before` in
 *     English, Russian and Ukrainian; the tree lists the two rows above the body in every view;
 *  2. a book without the elements shows one empty paragraph per block and Save writes no
 *     element; `empty-annotation-history.fb2` saved unedited keeps `<annotation/>` and
 *     `<history xml:lang="ru"/>`; typed into and emptied, the next save has no element;
 *  3. one datum, two editors: paragraphs typed in the block appear in `description-annotation`
 *     and an edit there shows in the block; a script's `mfbe.doc.setDescription` updates it;
 *     Undo after a block edit and then a Description field edit reverts the most recent one
 *     and shows its view;
 *  4. the caret in a block offers the annotation's paragraph kinds only, every section command
 *     is disabled, a pasted section is flattened, the status bar names the block's element;
 *  5. tree rows: View scrolls to the block and places the caret, the caret selects the row,
 *     Move / Merge / Delete are disabled, View Source lands on the element;
 *  6. Find finds text in both blocks and the body, Replace changes a history paragraph (the
 *     Description field shows the replacement), Tools > Words counts an annotation word, a
 *     misspelt word in the history block is marked and gets suggestions;
 *  7. Select All + Delete across the boundary is refused while Copy works, a cross-boundary Cut
 *     copies and does not delete, cutting a block's last paragraph leaves one empty paragraph;
 *  8. `descriptor.fbd` (no body) shows both blocks over an empty body area.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import {
  expect,
  fixtureBook,
  test,
  waitForBook,
  withUiLang,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import { pageAnyPattern, pageText, UI_LANGS, uiText, type UiLang } from './fixtures/i18n';
import { LINE_END, LINE_START, MOD, REPLACE } from './fixtures/keys';

const ANNOTATION_ROW = 'tree-row-desc:annotation';
const HISTORY_ROW = 'tree-row-desc:history';

interface ScriptHooks {
  refresh(): Promise<void>;
  run(idOrDir: string): Promise<{ status: string; error?: { message: string } }>;
}

declare const window: { __mfbeTest?: { scripts?: ScriptHooks } };

async function supportsDocuments(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('doc.recent')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

async function supportsSpelling(core: CoreHandle): Promise<boolean> {
  return core
    .rpc('spell.dictionaries')
    .then((list) => Array.isArray(list) && list.length >= 2)
    .catch(() => false);
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/** Opens `file` through the queued native dialog; the Body editor is ready afterwards. */
async function openBook(core: CoreHandle, page: Page, file: string): Promise<Locator> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await menu(page, 'file', 'open');
  await waitForBook(page, file);
  const editor = page.getByTestId('body-editor');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  return editor;
}

async function openApp(core: CoreHandle, page: Page, lang?: UiLang): Promise<void> {
  if (lang) {
    await page.goto(withUiLang(core.baseURL, lang));
    await page.getByTestId('app-root').waitFor();
  } else {
    await core.openApp(page);
  }
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
}

const annotationBlock = (page: Page) => page.getByTestId('body-block-annotation');
const historyBlock = (page: Page) => page.getByTestId('body-block-history');

/**
 * Clicks into an element and lets the editor read the new caret (ProseMirror picks the browser
 * selection up asynchronously).
 */
async function clickInto(page: Page, target: Locator, expectedPath?: RegExp | string) {
  await target.click({ position: { x: 8, y: 8 } });
  if (expectedPath) await expect(page.getByTestId('status-path')).toHaveText(expectedPath);
  await page.waitForTimeout(80);
}

/** Save As to `file` through the queued native dialog; returns the written text. */
async function saveAs(core: CoreHandle, page: Page, file: string): Promise<string> {
  await core.enqueueDialog('dialog.saveFile', { path: file, encoding: 'utf-8' });
  await menu(page, 'file', 'saveAs');
  const prompt = page.getByTestId('dialog-validation-failed');
  const saved = await pageAnyPattern(page, 'status.savedNoErrors', 'msg.errorsFound');
  await expect
    .poll(
      async () =>
        (await prompt.count()) > 0 ||
        saved.test(await page.getByTestId('status-message').innerText()),
    )
    .toBe(true);
  if ((await prompt.count()) > 0)
    await page.getByTestId('dialog-validation-failed-button-yes').click();
  await expect(page.getByTestId('status-message')).toContainText(saved);
  await expect(page).toHaveTitle(
    new RegExp(`^${path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} - `),
  );
  return readFileSync(file, 'utf8');
}

/** The `annotation` / `history` element of a saved file, or null when it is not written. */
function element(xml: string, name: 'annotation' | 'history'): string | null {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</${name}>)`);
  const match = re.exec(xml.slice(0, xml.indexOf('<body')));
  return match ? match[0] : null;
}

interface Frame {
  borderLeftWidth: string;
  background: string;
  editorBackground: string;
  caption: string;
}

/** Browser-side snippet (the e2e tsconfig has no DOM lib, hence a string). */
const FRAME_OF = `((kind) => {
  const block = document.querySelector('[data-testid="body-block-' + kind + '"]');
  const editor = document.querySelector('[data-testid="body-editor"]');
  const style = getComputedStyle(block);
  return {
    borderLeftWidth: style.borderLeftWidth,
    background: style.backgroundColor,
    editorBackground: getComputedStyle(editor).backgroundColor,
    caption: getComputedStyle(block, '::before').content,
  };
})`;

async function frameOf(page: Page, kind: 'annotation' | 'history'): Promise<Frame> {
  return page.evaluate<Frame>(`${FRAME_OF}(${JSON.stringify(kind)})`);
}

function expectFramed(frame: Frame, what: string): void {
  const width = Number.parseFloat(frame.borderLeftWidth);
  const framed = width > 0 || frame.background !== frame.editorBackground;
  expect(framed, `${what}: border ${frame.borderLeftWidth}, background ${frame.background}`).toBe(
    true,
  );
}

/** Browser-side snippet: the node names of the annotation block's child nodes. */
const BLOCK_CHILD_NODES = `(() => {
  const block = document.querySelector('[data-testid="body-block-annotation"]');
  return Array.from(block.childNodes).map((node) => node.nodeName);
})()`;

/** Browser-side snippet: the kinds of the editor's top-level children (no DOM lib in e2e). */
const TOP_LEVEL_KINDS = `(() => {
  const editor = document.querySelector('[data-testid="body-editor"]');
  return Array.from(editor.children).map((child) => {
    const block = child.getAttribute('data-block');
    if (block) return block;
    return child.classList.contains('fb-body') ? 'body' : child.tagName.toLowerCase();
  });
})()`;

/** Document order of the editor's top-level children (`annotation`, `history`, `body`...). */
async function topLevelKinds(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(TOP_LEVEL_KINDS);
}

/** The text on the system clipboard (the test grants the clipboard permissions). */
async function clipboardText(page: Page): Promise<string> {
  return page.evaluate<string>('navigator.clipboard.readText()');
}

/** Lets the editor pick up a caret moved with the keyboard (ProseMirror reads it asynchronously). */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(80);
}

/** Text currently selected in the Body editor (independent of the DOM focus). */
async function selectedText(page: Page): Promise<string> {
  return (await page.getByTestId('body-view').getAttribute('data-selected-text')) ?? '';
}

/** Selects the text from the caret's block start to `target`'s end (Shift+click). */
async function shiftClickInto(page: Page, target: Locator): Promise<void> {
  await page.keyboard.down('Shift');
  await target.click({ position: { x: 8, y: 8 } });
  await page.keyboard.up('Shift');
  await page.waitForTimeout(80);
}

const PASTE_SECTION = `(() => {
  const payload = {
    format: 'mfbe-fb2',
    version: 1,
    slice: {
      content: [
        {
          type: 'section',
          content: [
            { type: 'title', content: [{ type: 'p', content: [{ type: 'text', text: 'Pasted title' }] }] },
            { type: 'p', content: [{ type: 'text', text: 'Pasted one' }] },
            { type: 'p', content: [{ type: 'text', text: 'Pasted two' }] },
          ],
        },
      ],
      openStart: 0,
      openEnd: 0,
    },
  };
  const data = new DataTransfer();
  data.setData('application/x-mfbe-fb2+json', JSON.stringify(payload));
  data.setData('text/plain', 'Pasted title\\nPasted one\\nPasted two');
  const target = document.querySelector('[data-testid="body-editor"]');
  target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
})()`;

test.describe('US2 (004) - annotation and history at the top of the Body view', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-004-us2-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.* yet');
  });

  test('1. the blocks come first, framed and captioned in en / ru / uk, light and dark; the tree lists them in every view', async ({
    core,
    page,
  }) => {
    for (const lang of UI_LANGS) {
      await openApp(core, page, lang);
      const editor = await openBook(core, page, fixtureBook('modern-utf8.fb2'));
      expect((await topLevelKinds(page)).slice(0, 3)).toEqual(['annotation', 'history', 'body']);
      await expect(annotationBlock(page)).toContainText('Второй абзац аннотации.');
      await expect(annotationBlock(page).locator('em')).toHaveText('курсивом');
      await expect(historyBlock(page)).toContainText('v2.1 — вычитка');
      const annotation = await frameOf(page, 'annotation');
      const history = await frameOf(page, 'history');
      expectFramed(annotation, `annotation (${lang}, light)`);
      expectFramed(history, `history (${lang}, light)`);
      expect(annotation.caption).toBe(JSON.stringify(uiText(lang, 'tree.node.annotation')));
      expect(history.caption).toBe(JSON.stringify(uiText(lang, 'tree.node.history')));
      // The caption is drawn, not typed: the block's DOM holds its paragraphs alone (no text
      // node before them) and its text is exactly the paragraphs' text.
      expect(await page.evaluate<string[]>(BLOCK_CHILD_NODES)).toEqual(['P', 'P', 'P']);
      expect((await annotationBlock(page).innerText()).replace(/\s*\n\s*/g, '\n')).toBe(
        'Аннотация с курсивом.\nВторой абзац аннотации.',
      );
      await expect(editor.locator('.fb-body')).toHaveCount(2);

      // The tree rows above the body node(s) in that order, in every view.
      for (const view of ['body', 'description', 'source', 'body'] as const) {
        await page.getByTestId(`view-${view}`).click();
        const rows = page.getByTestId('tree-rows').locator('[data-testid^="tree-row-"]');
        await expect(rows.nth(0)).toHaveAttribute('data-testid', ANNOTATION_ROW);
        await expect(rows.nth(1)).toHaveAttribute('data-testid', HISTORY_ROW);
        await expect(rows.nth(2)).toHaveAttribute('data-kind', 'body');
        await expect(page.getByTestId(ANNOTATION_ROW)).toHaveAttribute(
          'data-row-kind',
          'annotationBlock',
        );
        await expect(page.getByTestId(HISTORY_ROW)).toHaveAttribute(
          'data-row-kind',
          'historyBlock',
        );
        await expect(page.getByTestId(ANNOTATION_ROW)).toHaveText(
          uiText(lang, 'tree.node.annotation'),
        );
        await expect(page.getByTestId(HISTORY_ROW)).toHaveText(uiText(lang, 'tree.node.history'));
      }
      await expect(page.getByTestId('body-editor')).toBeVisible();
    }

    // Dark theme: still set off from the book text.
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(core, page, 'en');
    await openBook(core, page, fixtureBook('modern-utf8.fb2'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expectFramed(await frameOf(page, 'annotation'), 'annotation (dark)');
    expectFramed(await frameOf(page, 'history'), 'history (dark)');
    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('2. absent elements show an empty paragraph and are not written; present-but-empty ones are kept as read until edited', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    // A book without an annotation or history: one empty paragraph per block, nothing saved.
    await openBook(core, page, fixtureBook('koi8r.fb2'));
    await expect(annotationBlock(page).locator('> p')).toHaveCount(1);
    await expect(annotationBlock(page)).toHaveText('');
    await expect(historyBlock(page).locator('> p')).toHaveCount(1);
    await expect(historyBlock(page)).toHaveText('');
    let xml = await saveAs(core, page, path.join(dir, 'absent.fb2'));
    expect(element(xml, 'annotation')).toBeNull();
    expect(element(xml, 'history')).toBeNull();

    // Present but empty: shown with one empty paragraph, written back as read.
    await openBook(core, page, fixtureBook('empty-annotation-history.fb2'));
    await expect(annotationBlock(page).locator('> p')).toHaveCount(1);
    await expect(historyBlock(page).locator('> p')).toHaveCount(1);
    xml = await saveAs(core, page, path.join(dir, 'empty-kept.fb2'));
    expect(element(xml, 'annotation')).toBe('<annotation/>');
    expect(element(xml, 'history')).toBe('<history xml:lang="ru"/>');

    // Typed into and emptied again: the next save writes no annotation; the history, never
    // edited, is still written as read.
    await clickInto(
      page,
      annotationBlock(page).locator('> p').first(),
      'title-info/annotation[1]/p[1]',
    );
    await page.keyboard.type('Temporary');
    await expect(annotationBlock(page)).toHaveText('Temporary');
    for (let i = 0; i < 'Temporary'.length; i += 1) await page.keyboard.press('Backspace');
    await expect(annotationBlock(page)).toHaveText('');
    await expect(annotationBlock(page).locator('> p')).toHaveCount(1);
    xml = await saveAs(core, page, path.join(dir, 'empty-emptied.fb2'));
    expect(element(xml, 'annotation')).toBeNull();
    expect(element(xml, 'history')).toBe('<history xml:lang="ru"/>');
  });

  test('3. the block and the Description field edit one datum; a script and Undo follow it', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await openBook(core, page, fixtureBook('koi8r.fb2'));

    // Two paragraphs typed in the block appear in the Description field.
    await clickInto(
      page,
      annotationBlock(page).locator('> p').first(),
      'title-info/annotation[1]/p[1]',
    );
    await page.keyboard.type('First paragraph');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second paragraph');
    await expect(annotationBlock(page).locator('> p')).toHaveCount(2);
    await expect(page.getByTestId('status-path')).toHaveText('title-info/annotation[1]/p[2]');
    await page.getByTestId('view-description').click();
    const field = page.getByTestId('description-annotation');
    await expect(field.locator('p')).toHaveCount(2);
    await expect(field.locator('p').nth(0)).toHaveText('First paragraph');
    await expect(field.locator('p').nth(1)).toHaveText('Second paragraph');

    // An edit in the field shows in the block.
    await field.locator('p').nth(1).click();
    await page.keyboard.press(LINE_END);
    await settle(page);
    await page.keyboard.type(' (edited)');
    await expect(field.locator('p').nth(1)).toHaveText('Second paragraph (edited)');
    await page.getByTestId('view-body').click();
    await expect(annotationBlock(page).locator('> p').nth(1)).toHaveText(
      'Second paragraph (edited)',
    );
    await expect(annotationBlock(page).locator('> p')).toHaveCount(2);

    // A script changing the annotation through the script interface updates the block.
    const scriptDir = path.join(core.dataDir!, 'scripts', '90_US2Blocks', '01_SetAnnotation');
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(
      path.join(scriptDir, 'script.json'),
      JSON.stringify({
        manifestVersion: 1,
        id: 'mfbe.us2.setAnnotation',
        name: { en: 'Set annotation (US2)' },
        kind: 'menu',
      }),
    );
    writeFileSync(
      path.join(scriptDir, 'index.js'),
      [
        'export default async function run() {',
        '  const document = await mfbe.doc.get();',
        '  const description = document.description;',
        '  description.titleInfo.annotation = {',
        "    type: 'annotation',",
        '    attrs: {},',
        "    content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text: 'Annotation set by a script' }] }],",
        '  };',
        '  await mfbe.doc.setDescription(description);',
        '}',
        '',
      ].join('\n'),
    );
    await page.evaluate(() => window.__mfbeTest!.scripts!.refresh());
    const result = await page.evaluate(() =>
      window.__mfbeTest!.scripts!.run('mfbe.us2.setAnnotation'),
    );
    expect(result.status, result.error?.message).toBe('done');
    await expect(annotationBlock(page)).toHaveText('Annotation set by a script');
    await expect(annotationBlock(page).locator('> p')).toHaveCount(1);
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('description-annotation')).toHaveText(
      'Annotation set by a script',
    );
    await page.getByTestId('view-body').click();

    // Undo after a block edit and then a Description field edit: the most recent edit is
    // undone first and its view shown, then the block edit in the Body view.
    await clickInto(
      page,
      historyBlock(page).locator('> p').first(),
      'document-info/history[1]/p[1]',
    );
    await page.keyboard.type('History line');
    await expect(historyBlock(page)).toHaveText('History line');
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('description-history')).toHaveText('History line');
    const keywords = page.getByTestId('description-keywords');
    await keywords.click();
    await keywords.fill('undo-me');
    await keywords.blur();
    await expect(keywords).toHaveValue('undo-me');
    await page.getByTestId('view-body').click();
    await expect(page.getByTestId('body-editor')).toBeVisible();
    await menu(page, 'edit', 'undo');
    await expect(page.getByTestId('description-keywords')).toHaveValue('');
    await expect(page.getByTestId('description-history')).toHaveText('History line');
    await menu(page, 'edit', 'undo');
    await expect(page.getByTestId('body-editor')).toBeVisible();
    await expect(historyBlock(page)).toHaveText('');
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('description-history')).toHaveText('');
  });

  test('4. inside a block only the annotation content is offered, section commands are disabled, a pasted section is flattened', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await openBook(core, page, fixtureBook('modern-utf8.fb2'));
    await clickInto(
      page,
      annotationBlock(page).locator('> p').first(),
      'title-info/annotation[1]/p[1]',
    );

    const disabled = /mfbe-menu-item-disabled/;
    await page.getByTestId('menu-add').click();
    for (const item of ['title', 'epigraph', 'annotation', 'textAuthor', 'image', 'sectionImage']) {
      await expect(page.getByTestId(`menu-add-${item}`), `Add > ${item}`).toHaveClass(disabled);
    }
    for (const item of ['poem', 'cite', 'table']) {
      await expect(page.getByTestId(`menu-add-${item}`), `Add > ${item}`).not.toHaveClass(disabled);
    }
    await page.keyboard.press('Escape');
    await page.getByTestId('menu-style').click();
    await expect(page.getByTestId('menu-style-subtitle')).not.toHaveClass(disabled);
    await expect(page.getByTestId('menu-style-normal')).not.toHaveClass(disabled);
    await expect(page.getByTestId('menu-style-textAuthor')).toHaveClass(disabled);
    await page.keyboard.press('Escape');
    await page.getByTestId('menu-edit').click();
    for (const item of ['clone', 'split', 'merge', 'removeOuter']) {
      await expect(page.getByTestId(`menu-edit-${item}`), `Edit > ${item}`).toHaveClass(disabled);
    }
    await page.keyboard.press('Escape');

    // Subtitle and empty line inside the block.
    await clickInto(
      page,
      annotationBlock(page).locator('> p').last(),
      'title-info/annotation[1]/p[2]',
    );
    await page.keyboard.press(LINE_END);
    await settle(page);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Block subtitle');
    await menu(page, 'style', 'subtitle');
    await expect(annotationBlock(page).locator('> p.fb-subtitle')).toHaveText('Block subtitle');
    await expect(page.getByTestId('status-path')).toHaveText(
      'title-info/annotation[1]/subtitle[1]',
    );
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(annotationBlock(page).locator('> p.fb-empty-line')).toHaveCount(2);

    // A pasted section is flattened to paragraphs (no section structure inside a block).
    await page.keyboard.type('x');
    await page.evaluate(PASTE_SECTION);
    await expect(annotationBlock(page).locator('.fb-section')).toHaveCount(0);
    await expect(annotationBlock(page).locator('.fb-title')).toHaveCount(0);
    await expect(annotationBlock(page).locator('> p', { hasText: 'Pasted one' })).toHaveCount(1);
    await expect(annotationBlock(page).locator('> p', { hasText: 'Pasted two' })).toHaveCount(1);
    await expect(annotationBlock(page)).toContainText('Pasted title');
    expect((await topLevelKinds(page)).slice(0, 3)).toEqual(['annotation', 'history', 'body']);
  });

  test('5. tree rows: View and the caret select both ways, Move / Merge / Delete are disabled, View Source lands on the element', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await openBook(core, page, fixtureBook('modern-utf8.fb2'));

    // Clicking "History" places the caret in the block.
    await page.getByTestId(HISTORY_ROW).click();
    await expect(page.getByTestId(HISTORY_ROW)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('status-path')).toHaveText('document-info/history[1]/p[1]');
    await expect(historyBlock(page)).toBeInViewport();
    // Enter opens it in the Body view with the focus there.
    await page.getByTestId('tree-content').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('body-editor')).toBeFocused();
    await expect(page.getByTestId('status-path')).toHaveText('document-info/history[1]/p[1]');

    // Move / Merge / Delete are unavailable for both rows, View and View Source work.
    for (const row of [HISTORY_ROW, ANNOTATION_ROW]) {
      await page.getByTestId(row).click();
      for (const button of ['right', 'right-smart', 'left', 'merge', 'delete']) {
        await expect(page.getByTestId(`tree-toolbar-${button}`), `${row} ${button}`).toBeDisabled();
      }
      await page.getByTestId(row).click({ button: 'right' });
      await expect(page.getByTestId('tree-menu')).toBeVisible();
      for (const item of ['moveRight', 'moveWithChildren', 'moveLeft', 'merge', 'delete']) {
        await expect(page.getByTestId(`tree-menu-${item}`)).toHaveAttribute(
          'aria-disabled',
          'true',
        );
      }
      await expect(page.getByTestId('tree-menu-view')).not.toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByTestId('tree-menu-viewSource')).not.toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await page.keyboard.press('Escape');
    }

    // Clicking into the annotation block selects its row.
    await clickInto(
      page,
      page.getByTestId('body-editor').locator('.fb-body .fb-section p.fb-p').first(),
    );
    await expect(page.getByTestId(ANNOTATION_ROW)).not.toHaveAttribute('data-selected', 'true');
    await clickInto(
      page,
      annotationBlock(page).locator('> p').first(),
      'title-info/annotation[1]/p[1]',
    );
    await expect(page.getByTestId(ANNOTATION_ROW)).toHaveAttribute('data-selected', 'true');
    await clickInto(
      page,
      historyBlock(page).locator('> p').last(),
      'document-info/history[1]/p[2]',
    );
    await expect(page.getByTestId(HISTORY_ROW)).toHaveAttribute('data-selected', 'true');

    // View Source lands on the element: the active line is the element's line of the source
    // text (the title-info annotation, not a section's one - it precedes the first <body>).
    const xml = await page.evaluate<string>('window.__mfbeTest.scripts.toXml()');
    const lineOf = (needle: string) => xml.slice(0, xml.indexOf(needle)).split('\n').length;
    expect(lineOf('<history')).toBeLessThan(lineOf('<body'));
    await page.getByTestId(HISTORY_ROW).click({ button: 'right' });
    await page.getByTestId('tree-menu-viewSource').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    const activeLine = page.locator('.mfbe-source-editor .cm-activeLine').first();
    const activeGutter = page.locator('.mfbe-source-editor .cm-activeLineGutter').first();
    await expect(activeLine).toContainText('<history');
    await expect(activeGutter).toHaveText(String(lineOf('<history')));
    await page.getByTestId(ANNOTATION_ROW).click({ button: 'right' });
    await page.getByTestId('tree-menu-viewSource').click();
    await expect(activeLine).toContainText('<annotation');
    await expect(activeGutter).toHaveText(String(lineOf('<annotation')));
    expect(lineOf('<annotation')).toBeLessThan(lineOf('<body'));
  });

  test('6. Find, Replace, Words and the spell checker cover the blocks', async ({ core, page }) => {
    await openApp(core, page);
    const editor = await openBook(core, page, fixtureBook('modern-utf8.fb2'));
    await clickInto(page, editor.locator('.fb-body .fb-section p.fb-p').first());

    // Find: a word of the annotation, one of the history, one of the body (wrapping).
    await page.keyboard.press(`${MOD}+f`);
    const find = page.getByTestId('dialog-find');
    await expect(find).toBeVisible();
    await page.getByTestId('dialog-find-query').fill('абзац аннотации');
    await page.getByTestId('dialog-find-button-findNext').click();
    await expect.poll(() => selectedText(page)).toBe('абзац аннотации');
    await expect(page.getByTestId('status-path')).toHaveText('title-info/annotation[1]/p[2]');
    await page.getByTestId('dialog-find-query').fill('вычитка');
    await page.getByTestId('dialog-find-button-findNext').click();
    await expect.poll(() => selectedText(page)).toBe('вычитка');
    await expect(page.getByTestId('status-path')).toHaveText('document-info/history[1]/p[2]');
    await page.getByTestId('dialog-find-query').fill('Глава 1');
    await page.getByTestId('dialog-find-button-findNext').click();
    await expect.poll(() => selectedText(page)).toBe('Глава 1');
    await expect(page.getByTestId('status-path')).toHaveText(
      /^body\[1\]\/section\[1\]\/title\[1\]/,
    );
    await page.getByTestId('dialog-find-button-cancel').click();

    // Replace a word of a history paragraph; the Description field shows the replacement.
    await page.keyboard.press(REPLACE);
    const replace = page.getByTestId('dialog-replace');
    await expect(replace).toBeVisible();
    await page.getByTestId('dialog-replace-query').fill('вычитка');
    await page.getByTestId('dialog-replace-with').fill('правка');
    await page.getByTestId('dialog-replace-button-findNext').click();
    await expect.poll(() => selectedText(page)).toBe('вычитка');
    await page.getByTestId('dialog-replace-button-replace').click();
    await expect(historyBlock(page)).toContainText('v2.1 — правка');
    // No further match: "Finished searching" is reported before the dialog can be closed.
    await expect(page.getByTestId('dialog-search-message')).toContainText(
      await pageText(page, 'msg.searchFinished', { text: 'вычитка' }),
    );
    await page.getByTestId('dialog-search-message-button-ok').click();
    await page.getByTestId('dialog-replace-button-cancel').click();
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('description-history')).toContainText('v2.1 — правка');
    await page.getByTestId('view-body').click();

    // Tools > Words counts the words of an annotation paragraph.
    await menu(page, 'tools', 'words');
    const words = page.getByTestId('dialog-words');
    await expect(words).toBeVisible();
    await expect(page.getByTestId('words-table')).toHaveAttribute('data-status', 'ready');
    const row = page.locator('[data-testid^="words-row-"][data-word="аннотации"]');
    await expect
      .poll(async () => {
        if ((await row.count()) > 0) return true;
        await page.evaluate(`(() => {
          const grid = document.querySelector('[data-testid="words-grid"]');
          if (grid) grid.scrollTop += grid.clientHeight;
        })()`);
        return false;
      })
      .toBe(true);
    const rowId = await row.getAttribute('data-testid');
    await expect(page.getByTestId(`${rowId}-count`)).toHaveText('1');
    await page.getByTestId('dialog-words-button-cancel').click();
    await expect(words).toHaveCount(0);

    // A misspelt word in the history block is marked and offered suggestions.
    test.skip(!(await supportsSpelling(core)), 'the core has no spell.* / dictionaries');
    await clickInto(
      page,
      historyBlock(page).locator('> p').first(),
      'document-info/history[1]/p[1]',
    );
    await page.keyboard.press(LINE_END);
    await settle(page);
    await page.keyboard.type(' ашыбка');
    const marked = historyBlock(page).locator('.mfbe-misspelled', { hasText: 'ашыбка' });
    await expect(marked).toBeVisible({ timeout: 3000 });
    await marked.click({ button: 'right' });
    const context = page.getByTestId('context-menu');
    await expect(context).toBeVisible();
    await expect(context.getByTestId('context-menu-spelling-0')).toBeVisible({ timeout: 3000 });
    const suggestion = (await context.getByTestId('context-menu-spelling-0').innerText()).trim();
    await context.getByTestId('context-menu-spelling-0').click();
    await expect(historyBlock(page)).toContainText(suggestion);
    await expect(historyBlock(page).locator('.mfbe-misspelled', { hasText: 'ашыбка' })).toHaveCount(
      0,
    );
  });

  test('7. a selection across a block boundary is copied but never deleted or cut; the last paragraph of a block survives a cut', async ({
    core,
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApp(core, page);
    const editor = await openBook(core, page, fixtureBook('modern-utf8.fb2'));
    const textBefore = await editor.innerText();
    const kinds = await topLevelKinds(page);

    // Select All, then Delete: refused; Copy works.
    await clickInto(page, editor.locator('.fb-body .fb-section p.fb-p').first());
    await page.keyboard.press(`${MOD}+a`);
    await expect.poll(() => selectedText(page)).toContain('вычитка');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);
    expect(await editor.innerText()).toBe(textBefore);
    expect(await topLevelKinds(page)).toEqual(kinds);
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.press(`${MOD}+c`);
    await expect.poll(() => clipboardText(page)).toContain('вычитка');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);
    expect(await editor.innerText()).toBe(textBefore);

    // Cut of a selection from the history block into the body: copied, not deleted.
    await clickInto(
      page,
      historyBlock(page).locator('> p').last(),
      'document-info/history[1]/p[2]',
    );
    await page.keyboard.press(LINE_START);
    await settle(page);
    await shiftClickInto(page, editor.locator('.fb-body > .fb-title p').first());
    await expect.poll(() => selectedText(page)).toContain('v2.1');
    const selected = await selectedText(page);
    await menu(page, 'edit', 'cut');
    await page.waitForTimeout(100);
    expect(await editor.innerText()).toBe(textBefore);
    await expect.poll(() => clipboardText(page)).toContain(selected.split('\n')[0]!.trim());
    await page.keyboard.press(`${MOD}+x`);
    await page.waitForTimeout(100);
    expect(await editor.innerText()).toBe(textBefore);
    expect(await topLevelKinds(page)).toEqual(kinds);
    // Nothing changed: the document is not marked modified (no `*` in the title).
    await expect(page).toHaveTitle(/^modern-utf8\.fb2 - /);

    // Cutting every paragraph of a block leaves one empty paragraph.
    await clickInto(
      page,
      historyBlock(page).locator('> p').first(),
      'document-info/history[1]/p[1]',
    );
    await page.keyboard.press(LINE_START);
    await settle(page);
    await shiftClickInto(page, historyBlock(page).locator('> p').last());
    await page.keyboard.press(`Shift+${LINE_END}`);
    // The editor reads the extended selection back from the DOM asynchronously: the cut must
    // act on a selection that already reaches the end of the last paragraph, not on the one
    // the Shift+click left (seen on the macOS runner: the first paragraph alone was cut).
    await expect.poll(() => selectedText(page)).toContain('v1.0');
    await expect.poll(() => selectedText(page)).toMatch(/вычитка\s*$/);
    await page.keyboard.press(`${MOD}+x`);
    await expect(historyBlock(page).locator('> p')).toHaveCount(1);
    await expect(historyBlock(page)).toHaveText('');
    await expect.poll(() => clipboardText(page)).toContain('v1.0');
    const xml = await saveAs(core, page, path.join(dir, 'cut-history.fb2'));
    expect(element(xml, 'history')).toBeNull();
    expect(element(xml, 'annotation')).toContain('Второй абзац аннотации.');
  });

  test('8. a descriptor without a body shows both blocks over an empty body area', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await openBook(core, page, fixtureBook('descriptor.fbd'));
    expect(await topLevelKinds(page)).toEqual(['annotation', 'history']);
    await expect(annotationBlock(page)).toHaveText('Файл-описание без тела.');
    await expect(historyBlock(page).locator('> p')).toHaveCount(1);
    await expect(historyBlock(page)).toHaveText('');
    await expect(page.getByTestId('body-editor').locator('.fb-body')).toHaveCount(0);
    const rows = page.getByTestId('tree-rows').locator('[data-testid^="tree-row-"]');
    await expect(rows).toHaveCount(2);
    await clickInto(
      page,
      annotationBlock(page).locator('> p').first(),
      'title-info/annotation[1]/p[1]',
    );
    await expect(page.getByTestId(ANNOTATION_ROW)).toHaveAttribute('data-selected', 'true');
  });
});
