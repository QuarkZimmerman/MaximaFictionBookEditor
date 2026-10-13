/**
 * User Story 6 - Check spelling in English and Russian (T085, UI part).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`) with its
 * bundled en_US / ru_RU dictionaries; skipped in core-less mode.
 *
 * Scenarios (spec.md US6):
 *  1. seeded Russian / English misspellings are underlined within one second (also while
 *     typing); the context menu offers suggestions and "Add to dictionary";
 *  2. the Spelling dialog shows Not In Dictionary / Change To / Suggestions and its buttons
 *     Ignore, Ignore All, Change, Change All, Add, Undo last act on the document; the end of the
 *     document reports "The spelling check is complete.";
 *  3. a `lang="ru"` document uses the Russian dictionary by default; enabling the English one as
 *     well stops flagging English words;
 *  4. a word added to the custom dictionary is persisted (`custom.dic` in the data directory)
 *     and accepted by a fresh `spell.check` of the core;
 *  plus the edge case: combining accents, hyphens and non-breaking spaces produce no false
 *  positives.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { expect, test, type CoreHandle, type RpcCallError } from './fixtures/core';

function book(lang: string, paragraphs: string[], id: string, title: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
\t<description>
\t\t<title-info>
\t\t\t<genre>prose_classic</genre>
\t\t\t<author><first-name>Spell</first-name><last-name>Fixture</last-name></author>
\t\t\t<book-title>Spelling ${lang}</book-title>
\t\t\t<annotation><p>Аннотацыя книги.</p></annotation>
\t\t\t<lang>${lang}</lang>
\t\t</title-info>
\t\t<document-info>
\t\t\t<author><nickname>fixture</nickname></author>
\t\t\t<date value="2026-01-01">2026</date>
\t\t\t<id>${id}</id>
\t\t\t<version>1.0</version>
\t\t</document-info>
\t</description>
\t<body>
\t\t<section>
\t\t\t<title><p>${title}</p></title>
${paragraphs.map((text) => `\t\t\t<p>${text}</p>`).join('\n')}
\t\t</section>
\t</body>
</FictionBook>
`;
}

/** Russian book: one misspelling, one English sentence, accents / hyphen / NBSP (no errors). */
const RU_PARAGRAPHS = [
  'Привет, мир! Это превет с ошибкой.',
  'Москва\u0301 \u2014 кто-то сказал: \u00abвот\u00a0так\u00bb, ещё раз.',
  'Hello world again.',
  'Слово ашыбка в конце.',
];
/** Every misspelling of the Russian book with the Russian dictionary alone. */
const RU_MISSPELLED = ['превет', 'Hello', 'world', 'again', 'ашыбка'];
const EN_PARAGRAPHS = ['This is a smal mistake in an English text.'];

async function supportsSpelling(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('spell.dictionaries')
    .then((list) => Array.isArray(list) && list.length >= 2)
    .catch((error: RpcCallError) => error.code !== -32601 && false);
}

async function openBook(core: CoreHandle, page: Page, file: string): Promise<Locator> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  const editor = page.getByTestId('body-editor');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  return editor;
}

const misspelled = (editor: Locator) => editor.locator('.mfbe-misspelled');

async function misspelledWords(editor: Locator): Promise<string[]> {
  return misspelled(editor).evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
}

test.describe('US6 - check spelling in English and Russian', () => {
  let dir: string;
  let ruBook: string;
  let enBook: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us6-'));
    ruBook = path.join(dir, 'russian.fb2');
    enBook = path.join(dir, 'english.fb2');
    writeFileSync(ruBook, book('ru', RU_PARAGRAPHS, 'spell-ru', 'Глава первая'), 'utf8');
    writeFileSync(enBook, book('en', EN_PARAGRAPHS, 'spell-en', 'Chapter one'), 'utf8');
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsSpelling(core)), 'the core has no spell.* / dictionaries');
    // Every scenario starts with an empty custom dictionary (the worker's core is shared).
    const words = await core.rpc<string[]>('spell.customWords');
    for (const word of words) await core.rpc('spell.removeWord', { word });
  });

  test('1. misspellings are underlined within a second; the context menu offers suggestions', async ({
    core,
    page,
  }) => {
    const editor = await openBook(core, page, ruBook);
    // Only "превет" and the English words of the third paragraph (Russian dictionary) are
    // flagged; the accent, the hyphenated word and the non-breaking space are not.
    await expect(misspelled(editor).first()).toBeVisible({ timeout: 1000 });
    await expect.poll(() => misspelledWords(editor)).toEqual(RU_MISSPELLED);

    // Typing a misspelled word marks it within a second.
    const first = editor.locator('.fb-section > p.fb-p').first();
    await first.click();
    await page.keyboard.press('End');
    const typedAt = Date.now();
    await page.keyboard.type(' ашипка');
    await expect(editor.locator('.mfbe-misspelled', { hasText: 'ашипка' })).toBeVisible({
      timeout: 1000,
    });
    expect(Date.now() - typedAt).toBeLessThan(1500);

    // Context menu on the misspelled word: suggestions + Ignore all + Add to dictionary.
    const target = editor.locator('.mfbe-misspelled', { hasText: 'превет' });
    await target.click({ button: 'right' });
    const menu = page.getByTestId('context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('context-menu-spelling-0')).toBeVisible({ timeout: 3000 });
    const suggestions = await menu
      .locator('[data-testid^="context-menu-spelling-"]')
      .evaluateAll((nodes) =>
        nodes
          .map((node) => node.getAttribute('data-testid') ?? '')
          .filter((id) => /context-menu-spelling-\d+$/.test(id)),
      );
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(10);
    await expect(menu.getByTestId('context-menu-spelling-ignore-all')).toHaveText('Ignore all');
    await expect(menu.getByTestId('context-menu-spelling-add')).toHaveText('Add to dictionary');
    const suggestion = (await menu.getByTestId('context-menu-spelling-0').innerText()).trim();
    await menu.getByTestId('context-menu-spelling-0').click();
    await expect(first).toContainText(suggestion);
    await expect(first).not.toContainText('превет');
    await expect.poll(() => misspelledWords(editor)).not.toContain('превет');

    // One undo step brings the misspelling back.
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-undo').click();
    await expect(first).toContainText('превет');

    // "Ignore all" removes the marks of that word for the session.
    await editor.locator('.mfbe-misspelled', { hasText: 'ашипка' }).click({ button: 'right' });
    await expect(page.getByTestId('context-menu-spelling-ignore-all')).toBeVisible();
    await page.getByTestId('context-menu-spelling-ignore-all').click();
    await expect.poll(() => misspelledWords(editor)).not.toContain('ашипка');

    // An English document uses the English dictionary.
    await core.enqueueDialog('dialog.openFile', { paths: [enBook] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await page.getByTestId('dialog-save-changes-button-no').click();
    await expect(page).toHaveTitle(/^english\.fb2/);
    await expect.poll(() => misspelledWords(editor), { timeout: 3000 }).toEqual(['smal']);
  });

  test('2. the Spelling dialog: Ignore, Ignore All, Change, Change All, Add, Undo last, completion', async ({
    core,
    page,
  }) => {
    const editor = await openBook(core, page, ruBook);
    await expect(misspelled(editor).first()).toBeVisible();
    // Add an extra occurrence of the misspelling for Change All.
    const first = editor.locator('.fb-section > p.fb-p').first();
    await first.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' превет');
    await expect(first).toContainText('превет с ошибкой. превет');

    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-spellcheck').click();
    const dialog = page.getByTestId('dialog-spelling');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('dialog-spelling-title')).toContainText('Spelling');
    const word = dialog.getByTestId('spelling-not-in-dictionary');
    const changeTo = dialog.getByTestId('spelling-change-to');

    // The description annotation comes first ("Аннотацыя"): Change to the first suggestion.
    await expect(word).toHaveValue('Аннотацыя');
    await expect(dialog.getByTestId('spelling-status')).toHaveText('In: annotation');
    await expect(dialog.getByTestId('spelling-suggestion-0')).toBeVisible();
    const annotationFix = await changeTo.inputValue();
    expect(annotationFix.length).toBeGreaterThan(0);
    await dialog.getByTestId('spelling-change').click();

    // Body: "превет" -> Change All replaces both occurrences.
    await expect(word).toHaveValue('превет');
    await expect(dialog.getByTestId('spelling-status')).toHaveText('In: body');
    await expect(changeTo).toHaveValue(/.+/);
    await changeTo.fill('привет');
    await dialog.getByTestId('spelling-change-all').click();
    await expect(first).toContainText('Это привет с ошибкой. привет');
    await expect(page.getByTestId('status-message')).toHaveText('2 occurrences replaced.');

    // English words in the Russian book: Ignore, Ignore All, Ignore; then Add the last word.
    await expect(word).toHaveValue('Hello');
    await dialog.getByTestId('spelling-ignore').click();
    await expect(word).toHaveValue('world');
    await dialog.getByTestId('spelling-ignore-all').click();
    await expect(word).toHaveValue('again');
    await dialog.getByTestId('spelling-ignore').click();
    await expect(word).toHaveValue('ашыбка');
    await dialog.getByTestId('spelling-add').click();

    // End of the document.
    const complete = page.getByTestId('spelling-complete');
    await expect(complete).toBeVisible();
    await expect(complete).toContainText('The spelling check is complete.');
    await complete.getByTestId('spelling-complete-button-ok').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => misspelledWords(editor)).toEqual(['Hello', 'again']);

    // Undo last: run the dialog again (F7), change a word, undo it inside the dialog.
    await first.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' ашипка');
    await page.keyboard.press('F7');
    await expect(dialog).toBeVisible();
    await expect(word).toHaveValue('ашипка');
    await expect(dialog.getByTestId('spelling-undo')).toBeDisabled();
    // Let the asynchronous suggestions settle before typing a correction of our own.
    await expect(
      dialog.getByTestId('spelling-suggestion-0').or(dialog.getByTestId('spelling-no-suggestions')),
    ).toBeVisible();
    await changeTo.fill('ошибка');
    await dialog.getByTestId('spelling-change').click();
    await expect(first).toContainText('ошибка');
    await expect(first).not.toContainText('ашипка');
    await expect(word).toHaveValue('Hello');
    await expect(dialog.getByTestId('spelling-undo')).toBeEnabled();
    await dialog.getByTestId('spelling-undo').click();
    await expect(word).toHaveValue('ашипка');
    await expect(first).toContainText('ашипка');
    await dialog.getByTestId('dialog-spelling-button-close').click();
    await expect(dialog).toHaveCount(0);
  });

  test('3. a Russian document uses ru_RU by default; both dictionaries accept English words', async ({
    core,
    page,
  }) => {
    const editor = await openBook(core, page, ruBook);
    await expect.poll(() => misspelledWords(editor)).toEqual(RU_MISSPELLED);
    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-spellcheck').click();
    const dialog = page.getByTestId('dialog-spelling');
    await expect(dialog.getByTestId('spelling-dictionary-ru_RU')).toBeChecked();
    await expect(dialog.getByTestId('spelling-dictionary-en_US')).not.toBeChecked();
    await dialog.getByTestId('spelling-dictionary-en_US').click();
    await expect(dialog.getByTestId('spelling-dictionary-en_US')).toBeChecked();
    await dialog.getByTestId('dialog-spelling-button-close').click();
    // Words valid in either dictionary are no longer flagged.
    await expect
      .poll(() => misspelledWords(editor), { timeout: 3000 })
      .toEqual(['превет', 'ашыбка']);
  });

  test('4. a word added to the dictionary is persisted and accepted by the core', async ({
    core,
    page,
  }) => {
    const editor = await openBook(core, page, ruBook);
    await expect(misspelled(editor).first()).toBeVisible();
    await editor.locator('.mfbe-misspelled', { hasText: 'превет' }).click({ button: 'right' });
    await expect(page.getByTestId('context-menu-spelling-add')).toBeVisible();
    await page.getByTestId('context-menu-spelling-add').click();
    await expect(page.getByTestId('status-message')).toContainText('превет');
    await expect.poll(() => misspelledWords(editor)).not.toContain('превет');

    // Persistent custom dictionary (custom.dic in the data directory) and a fresh core check.
    const { path: dictionaryPath } = await core.rpc<{ path: string }>(
      'spell.customDictionaryPath',
      {},
    );
    expect(dictionaryPath.startsWith(core.dataDir!)).toBe(true);
    await expect.poll(() => existsSync(dictionaryPath)).toBe(true);
    expect(readFileSync(dictionaryPath, 'utf8').split(/\r?\n/)).toContain('превет');
    const check = await core.rpc<{ misspelled: string[] }>('spell.check', {
      words: ['превет', 'ашипка'],
      langs: ['ru'],
    });
    expect(check.misspelled).toEqual(['ашипка']);
    const words = await core.rpc<string[]>('spell.customWords');
    expect(words).toContain('превет');
    // Clean up so the other scenarios of this worker start from an empty dictionary.
    await core.rpc('spell.removeWord', { word: 'превет' });
  });
});
