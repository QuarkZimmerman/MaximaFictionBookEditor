/**
 * Feature 003, User Story 4 - More spelling dictionaries from a folder (T044; spec FR-030 to
 * FR-034, research R5).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`): the
 * dictionaries of `tests/fixtures/dictionaries/` are copied into the core's per-user folder
 * (`<dataDir>/dictionaries`) or a chosen folder, and the journeys check Settings > View and the
 * spell checking of a German book.
 *
 * Scenarios (spec US4):
 *  1. the spell-check settings offer the "Dictionaries folder" choice (default / chosen, "..."
 *     through `dialog.pickFolder`) and "Open dictionaries folder", which creates the per-user
 *     folder on demand (headless: the request is recorded, no failure message);
 *  2. pairs copied into the default folder are listed after Apply with tag and origin, the
 *     unusable files with the reason (partner missing, unsupported encoding, shadowed by the
 *     built-in dictionary); a German book is spell-checked with the new pair - misspelt words
 *     marked, suggestions offered, a word added to the custom dictionary accepted afterwards,
 *     the Spelling dialog working - and a `de-AT` book uses `de_DE` by language;
 *  3. the chosen-folder variant: the pair of the chosen folder is in effect (origin "chosen
 *     folder") and the per-user copy of the same tag is reported as shadowed by it;
 *  4. a chosen folder that no longer exists is reported and the default folder used.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle, type RpcCallError } from './fixtures/core';
import { pageText } from './fixtures/i18n';

const FIXTURES = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../tests/fixtures/dictionaries',
);

interface DictionaryReport {
  dictionaries: { tag: string; source: string; path: string }[];
  rejected: { path: string; reason: string; detail?: string }[];
  folders: { layer: string; path: string; exists: boolean; readable: boolean }[];
}

function book(lang: string, paragraphs: string[], id: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
\t<description>
\t\t<title-info>
\t\t\t<genre>prose_classic</genre>
\t\t\t<author><first-name>Spell</first-name><last-name>Fixture</last-name></author>
\t\t\t<book-title>Rechtschreibung ${lang}</book-title>
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
\t\t\t<title><p>Mädchen</p></title>
${paragraphs.map((text) => `\t\t\t<p>${text}</p>`).join('\n')}
\t\t</section>
\t</body>
</FictionBook>
`;
}

/**
 * The five words of the German fixture pair (`tests/fixtures/dictionaries/README.md`) plus two
 * misspellings (`Hauss`, `Büchr`) - the tiny dictionary knows nothing else, so every other word
 * would be flagged. The misspellings come first, high in the Body pane, where the context menu
 * has room below the pointer (like the Russian book of us6-spelling).
 */
const DE_PARAGRAPHS = ['Hauss Bücher Büchr', 'Haus Straße Bücher schön Mädchen'];
const DE_MISSPELLED = ['Hauss', 'Büchr'];

/** Copies the `.aff` / `.dic` fixtures named by `tags` (all of them by default) into `folder`. */
function copyDictionaries(folder: string, tags?: string[]): void {
  mkdirSync(folder, { recursive: true });
  for (const file of readdirSync(FIXTURES)) {
    if (!/\.(aff|dic)$/.test(file)) continue;
    if (tags && !tags.includes(file.replace(/\.(aff|dic)$/, ''))) continue;
    copyFileSync(path.join(FIXTURES, file), path.join(folder, file));
  }
}

async function supportsReport(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('spell.dictionaryReport')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601 && false);
}

async function resetSettings(core: CoreHandle): Promise<void> {
  await core.rpc('settings.set', { patch: { other: { dictionariesFolder: '' } } });
}

/** Empties the core's per-user dictionaries folder and its custom dictionary. */
async function cleanUserData(core: CoreHandle): Promise<void> {
  const folder = path.join(core.dataDir!, 'dictionaries');
  rmSync(folder, { recursive: true, force: true });
  const words = await core.rpc<string[]>('spell.customWords');
  for (const word of words) await core.rpc('spell.removeWord', { word });
  await resetSettings(core);
  await core.rpc('spell.dictionaryReport');
}

async function openApp(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
}

async function openSettingsView(page: Page): Promise<void> {
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-settings').click();
  await expect(page.getByTestId('dialog-settings')).toBeVisible();
  await expect(page.getByTestId('settings-page-view')).toBeVisible();
}

async function openBook(core: CoreHandle, page: Page, file: string): Promise<Locator> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  const editor = page.getByTestId('body-editor');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  return editor;
}

const misspelled = (editor: Locator) => editor.locator('.mfbe-misspelled');

async function misspelledWords(editor: Locator): Promise<string[]> {
  return misspelled(editor).evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
}

/** Tag and origin of every entry of the dictionaries list, as shown. */
async function listedDictionaries(page: Page): Promise<{ tag: string; origin: string }[]> {
  return page
    .getByTestId('settings-view-dictionaries-list')
    .locator('li')
    .evaluateAll((items) =>
      items.map((item) => ({
        tag: item.querySelector('[data-role="tag"]')?.textContent ?? '',
        origin: item.querySelector('[data-role="origin"]')?.textContent ?? '',
      })),
    );
}

test.describe('US4 - more spelling dictionaries from a folder', () => {
  // The Body context menu is positioned absolutely inside the document; when it does not fit
  // below the pointer of a 720 px window, focusing it scrolls the document and the menu
  // closes itself (a menu bug independent of this story, see us6-spelling scenario 1). A
  // taller window keeps the suggestions step about dictionaries.
  test.use({ viewport: { width: 1280, height: 960 } });

  let dir: string;
  let deBook: string;
  let atBook: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us4-'));
    deBook = path.join(dir, 'german.fb2');
    atBook = path.join(dir, 'austrian.fb2');
    writeFileSync(deBook, book('de', DE_PARAGRAPHS, 'spell-de'), 'utf8');
    writeFileSync(atBook, book('de-AT', DE_PARAGRAPHS, 'spell-de-at'), 'utf8');
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsReport(core)), 'the core has no spell.dictionaryReport');
    await cleanUserData(core);
  });

  test.afterEach(async ({ core }) => {
    if (core.hasCore) await cleanUserData(core).catch(() => {});
  });

  test('1. the Dictionaries folder choice, "..." and "Open dictionaries folder" (created on demand)', async ({
    core,
    page,
  }) => {
    const userFolder = path.join(core.dataDir!, 'dictionaries');
    expect(existsSync(userFolder)).toBe(false);
    await openApp(core, page);
    await openSettingsView(page);

    // The row: default folder chosen, the path field and "..." disabled until "chosen folder".
    const useDefault = page.getByTestId('settings-view-dictionaries-default');
    const useCustom = page.getByTestId('settings-view-dictionaries-custom');
    const pathField = page.getByTestId('settings-view-dictionaries-path');
    const browse = page.getByTestId('settings-view-dictionaries-browse');
    const open = page.getByTestId('settings-view-dictionaries-open');
    await expect(useDefault).toBeChecked();
    await expect(useCustom).not.toBeChecked();
    await expect(pathField).toBeDisabled();
    await expect(browse).toBeDisabled();
    await expect(open).toBeEnabled();
    await expect(open).toHaveText(
      await pageText(page, 'dialog.settings.view.openDictionariesFolder'),
    );

    // The built-in dictionaries are listed with their origin; nothing is rejected.
    await expect(page.getByTestId('settings-view-dictionary-en_US')).toBeVisible();
    const listed = await listedDictionaries(page);
    expect(listed.map((d) => d.tag)).toEqual(['en_US', 'ru_RU', 'uk_UA']);
    const builtIn = await pageText(page, 'dialog.about.dictionarySource.bundled');
    expect(listed.map((d) => d.origin)).toEqual([builtIn, builtIn, builtIn]);
    await expect(page.getByTestId('settings-view-dictionaries-rejected')).toHaveCount(0);

    // "Open dictionaries folder": the per-user folder is created and opened (headless: the
    // request is recorded by the test provider; no failure message appears).
    await open.click();
    await expect.poll(() => existsSync(userFolder)).toBe(true);
    await expect(page.getByTestId('dialog-folder-failed')).toHaveCount(0);
    await expect(page.getByTestId('dialog-folder-unavailable')).toHaveCount(0);

    // "Chosen folder" + "..." picks a folder through the native folder dialog.
    const chosen = path.join(dir, 'chosen-1');
    mkdirSync(chosen, { recursive: true });
    await useCustom.click();
    await expect(useCustom).toBeChecked();
    await expect(pathField).toBeEnabled();
    await expect(browse).toBeEnabled();
    const before = (await core.rpc<unknown[]>('test.dialogRequests')).length;
    await core.enqueueDialog('dialog.pickFolder', { path: chosen });
    await browse.click();
    await expect(pathField).toHaveValue(chosen);
    const requests = await core.rpc<{ method: string; title: string }[]>('test.dialogRequests');
    expect(requests.length).toBeGreaterThan(before);
    const request = requests[requests.length - 1]!;
    expect(request.method).toBe('dialog.pickFolder');
    expect(request.title).toBe(
      await pageText(page, 'dialog.settings.view.chooseDictionariesFolder'),
    );

    // Back to the default folder: the path is cleared; Cancel keeps the stored setting.
    await useDefault.click();
    await expect(pathField).toBeDisabled();
    await expect(pathField).toHaveValue('');
    await page.getByTestId('dialog-settings-button-cancel').click();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    const settings = await core.rpc<{ other: { dictionariesFolder: string } }>('settings.get');
    expect(settings.other.dictionariesFolder).toBe('');
  });

  test('2. pairs copied into the default folder: listed with origin and rejections after Apply; a German book is checked', async ({
    core,
    page,
  }) => {
    const userFolder = path.join(core.dataDir!, 'dictionaries');
    await openApp(core, page);
    await openSettingsView(page);
    await expect(page.getByTestId('settings-view-dictionary-uk_UA')).toBeVisible();
    await expect(page.getByTestId('settings-view-dictionary-de_DE')).toHaveCount(0);

    // The user copies the fixtures into the folder "Open dictionaries folder" showed, then
    // applies the settings: the list shows the new pairs and the rejected files.
    copyDictionaries(userFolder);
    await page.getByTestId('dialog-settings-button-apply').click();
    await expect(page.getByTestId('settings-view-dictionary-de_DE')).toBeVisible();
    const listed = await listedDictionaries(page);
    const builtIn = await pageText(page, 'dialog.about.dictionarySource.bundled');
    const userLabel = await pageText(page, 'dialog.about.dictionarySource.user');
    expect(listed).toEqual([
      { tag: 'en_US', origin: builtIn },
      { tag: 'ru_RU', origin: builtIn },
      { tag: 'uk_UA', origin: builtIn },
      { tag: 'de_DE', origin: userLabel },
      { tag: 'pl_PL', origin: userLabel },
    ]);
    const rejected = page.getByTestId('settings-view-dictionaries-rejected');
    await expect(rejected).toBeVisible();
    const rejectedText = await rejected.locator('li').allInnerTexts();
    expect(rejectedText).toHaveLength(3);
    const byFile = (name: string) => rejectedText.find((text) => text.includes(name)) ?? '';
    expect(byFile('cs_CZ.aff')).toContain(await pageText(page, 'spell.rejected.partnerMissing'));
    expect(byFile('xx_XX.aff')).toContain(
      await pageText(page, 'spell.rejected.unsupportedEncoding'),
    );
    expect(byFile('xx_XX.aff')).toContain('X-UNKNOWN');
    expect(byFile('ru_RU.aff')).toContain(
      await pageText(page, 'spell.rejected.shadowedBy.bundled'),
    );
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);

    // The German book is spell-checked with the new pair, like a built-in one: misspellings
    // marked within a second, suggestions in the context menu.
    const editor = await openBook(core, page, deBook);
    await expect(misspelled(editor).first()).toBeVisible({ timeout: 1000 });
    await expect.poll(() => misspelledWords(editor)).toEqual(DE_MISSPELLED);
    // The caret goes to the word first, as a user's click does.
    const target = editor.locator('.mfbe-misspelled', { hasText: 'Hauss' });
    await target.click();
    await target.click({ button: 'right' });
    const menu = page.getByTestId('context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('context-menu-spelling-0')).toBeVisible({ timeout: 3000 });
    const suggestions = await menu
      .locator('[data-testid^="context-menu-spelling-"]')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) =>
            /context-menu-spelling-\d+$/.test(node.getAttribute('data-testid') ?? ''),
          )
          .map((node) => (node.textContent ?? '').trim()),
      );
    expect(suggestions).toContain('Haus');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // The Spelling dialog works with it: the German dictionary is the one checked, Change
    // replaces the first misspelling, Add puts the second one into the custom dictionary.
    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-spellcheck').click();
    const dialog = page.getByTestId('dialog-spelling');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('spelling-dictionary-de_DE')).toBeChecked();
    await expect(dialog.getByTestId('spelling-dictionary-en_US')).not.toBeChecked();
    const word = dialog.getByTestId('spelling-not-in-dictionary');
    await expect(word).toHaveValue('Hauss');
    await expect(dialog.getByTestId('spelling-suggestion-0')).toBeVisible();
    await dialog.getByTestId('spelling-change-to').fill('Haus');
    await dialog.getByTestId('spelling-change').click();
    await expect(word).toHaveValue('Büchr');
    await dialog.getByTestId('spelling-add').click();
    const complete = page.getByTestId('spelling-complete');
    await expect(complete).toBeVisible();
    await complete.getByTestId('spelling-complete-button-ok').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => misspelledWords(editor)).toEqual([]);
    // The added word is in the custom dictionary and accepted by the core itself.
    expect(await core.rpc<string[]>('spell.customWords')).toEqual(['Büchr']);
    const check = await core.rpc<{ misspelled: string[]; langs: string[] }>('spell.check', {
      words: ['Büchr', 'Hauss'],
      langs: ['de'],
    });
    expect(check).toEqual({ misspelled: ['Hauss'], langs: ['de_DE'] });

    // A book in Austrian German (`de-AT`) uses de_DE by language.
    await core.enqueueDialog('dialog.openFile', { paths: [atBook] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await page.getByTestId('dialog-save-changes-button-no').click();
    await waitForBook(page, atBook);
    await expect.poll(() => misspelledWords(editor), { timeout: 3000 }).toEqual(['Hauss']);
    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-spellcheck').click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('spelling-dictionary-de_DE')).toBeChecked();
    await dialog.getByTestId('dialog-spelling-button-close').click();
    await expect(dialog).toHaveCount(0);
  });

  test('3. a chosen folder: its pair is in effect, the per-user copy of the same tag is shadowed by it', async ({
    core,
    page,
  }) => {
    const userFolder = path.join(core.dataDir!, 'dictionaries');
    const chosen = path.join(dir, 'chosen-3');
    rmSync(chosen, { recursive: true, force: true });
    copyDictionaries(chosen, ['de_DE', 'pl_PL']);
    copyDictionaries(userFolder, ['de_DE']);
    await openApp(core, page);
    await openSettingsView(page);
    // Before: the per-user German pair.
    await expect(page.getByTestId('settings-view-dictionary-de_DE')).toContainText(
      await pageText(page, 'dialog.about.dictionarySource.user'),
    );

    await page.getByTestId('settings-view-dictionaries-custom').click();
    await core.enqueueDialog('dialog.pickFolder', { path: chosen });
    await page.getByTestId('settings-view-dictionaries-browse').click();
    await expect(page.getByTestId('settings-view-dictionaries-path')).toHaveValue(chosen);
    await page.getByTestId('dialog-settings-button-apply').click();

    const chosenLabel = await pageText(page, 'dialog.about.dictionarySource.settings');
    await expect(page.getByTestId('settings-view-dictionary-pl_PL')).toContainText(chosenLabel);
    await expect(page.getByTestId('settings-view-dictionary-de_DE')).toContainText(chosenLabel);
    const rejected = page.getByTestId('settings-view-dictionaries-rejected');
    await expect(rejected).toBeVisible();
    await expect(rejected.locator('li')).toHaveCount(1);
    await expect(rejected.locator('li').first()).toContainText(path.join(userFolder, 'de_DE.aff'));
    await expect(rejected.locator('li').first()).toContainText(
      await pageText(page, 'spell.rejected.shadowedBy.settings'),
    );
    await expect(page.getByTestId('settings-view-dictionaries-folder-problem')).toHaveCount(0);

    // The core agrees: the setting is stored and the chosen pair is the effective de_DE.
    const settings = await core.rpc<{ other: { dictionariesFolder: string } }>('settings.get');
    expect(settings.other.dictionariesFolder).toBe(chosen);
    const report = await core.rpc<DictionaryReport>('spell.dictionaryReport');
    const de = report.dictionaries.find((d) => d.tag === 'de_DE');
    expect(de).toMatchObject({ source: 'settings', path: path.join(chosen, 'de_DE.aff') });
    expect(report.rejected).toEqual([
      { path: path.join(userFolder, 'de_DE.aff'), reason: 'shadowed', detail: 'settings' },
    ]);
    expect(report.folders[0]).toMatchObject({ layer: 'settings', path: chosen, exists: true });
    await page.getByTestId('dialog-settings-button-cancel').click();
    rmSync(chosen, { recursive: true, force: true });
  });

  test('4. a chosen folder that no longer exists is reported and the default folder used', async ({
    core,
    page,
  }) => {
    const userFolder = path.join(core.dataDir!, 'dictionaries');
    copyDictionaries(userFolder, ['de_DE']);
    const gone = path.join(dir, 'gone');
    rmSync(gone, { recursive: true, force: true });
    await core.rpc('settings.set', { patch: { other: { dictionariesFolder: gone } } });
    await openApp(core, page);
    await openSettingsView(page);

    await expect(page.getByTestId('settings-view-dictionaries-custom')).toBeChecked();
    await expect(page.getByTestId('settings-view-dictionaries-path')).toHaveValue(gone);
    const problem = page.getByTestId('settings-view-dictionaries-folder-problem');
    await expect(problem).toBeVisible();
    await expect(problem).toHaveText(
      await pageText(page, 'dialog.settings.view.dictionariesFolderMissing', { path: gone }),
    );
    // The default folder is used: the per-user pair is in effect.
    await expect(page.getByTestId('settings-view-dictionary-de_DE')).toContainText(
      await pageText(page, 'dialog.about.dictionarySource.user'),
    );
    const report = await core.rpc<DictionaryReport>('spell.dictionaryReport');
    expect(report.folders[0]).toMatchObject({ layer: 'settings', path: gone, exists: false });
    expect(report.dictionaries.find((d) => d.tag === 'de_DE')?.source).toBe('user');

    // Back to the default folder: the problem note goes away after Apply.
    await page.getByTestId('settings-view-dictionaries-default').click();
    await page.getByTestId('dialog-settings-button-apply').click();
    await expect(problem).toHaveCount(0);
    await expect(page.getByTestId('settings-view-dictionary-de_DE')).toBeVisible();
    await page.getByTestId('dialog-settings-button-cancel').click();
  });
});
