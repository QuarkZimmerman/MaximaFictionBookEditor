/**
 * Feature 007, User Story 3 - the scripts of FictionBook Editor 2.7.9 in the editor (T041;
 * FR-020 to FR-026, FR-040; contracts/script-api.md). The bundled packages of `scripts/` run in
 * the real UI on the reference books of `tests/scripts/fixtures/279`, started from the Scripts
 * menu. Every expected value comes from the repository: the menu's names from each group's
 * `group.json` and each package's `script.json`, the results from the runs recorded under
 * `tests/scripts/snapshots` (found through the group's `suite.json` by `"script"`, with their
 * answers and selections), the texts of the scripts' own dialogs from their sources. The
 * `chromium`, `chromium-ru` and `chromium-uk` projects run it with the English, the Russian and
 * the Ukrainian interface; each leg expects its own language. Needs the real core
 * (`MFBE_CORE_BIN`); skipped otherwise.
 *
 *  1. The Scripts menu shows the bundled groups - those of `scripts/*` with a `group.json` - in
 *     2.7.9's order, their folders' numeric order, under the names of their `group.json` in the
 *     interface language (FR-026).
 *  2. *Заголовки, подзаголовки, пустые строки* holds its 19 scripts, in their folders' order,
 *     under their names in the interface language; when the user points at the group, its
 *     scripts are on screen (the journey moves the pointer as the user does, see `pointAtGroup`).
 *  3. *Привести заголовки глав к виду 'Глава 1'* on `279/13/chapters.fb2` gives the titles and
 *     the document of its recorded run; its closing message is in the script's languages:
 *     Russian in the Russian interface, English in the English and the Ukrainian ones - the
 *     Ukrainian leg shows a converted script's dialog in English (FR-026's exception).
 *  4. *Общая статистика* puts its text on the clipboard and offers the Save dialog (the core's
 *     stand-in answers it): the clipboard holds the text of its recorded run, the file the same
 *     text in UTF-16 LE with a BOM, and the dialog proposed its name and title (FR-024).
 *  5. A combo, *Расформатировать все заголовки_Комбо* (it runs three other scripts through
 *     `mfbe.scripts.run`), gives the document of its recorded run as one undo step: one Undo
 *     restores the book, one Redo the result (FR-024, FR-025).
 *  6. *Показать все-все ссылки* opens a report window (`script-report-<n>`) with the list of its
 *     recorded run; the window stays after the run, and its Copy button puts that text on the
 *     clipboard (FR-024).
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserContext, Locator, Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle } from './fixtures/core';
import { pageLang, pageText, type UiLang } from './fixtures/i18n';
import { MOD } from './fixtures/keys';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SCRIPTS = path.join(REPO_ROOT, 'scripts');
const SNAPSHOTS = path.join(REPO_ROOT, 'tests', 'scripts', 'snapshots');

/* ------------------------------------------------------------------------ */
/* What the repository says                                                 */
/* ------------------------------------------------------------------------ */

type Names = Partial<Record<UiLang, string>> & { en: string };

interface Manifest {
  id: string;
  name: Names;
  kind?: 'menu' | 'tree';
}

interface BundledGroup {
  id: string;
  names: Names;
  /** The menu scripts of the group in 2.7.9's order. */
  scripts: Manifest[];
}

/** One recorded run of `snapshots/<suite>/suite.json`. */
interface Recorded {
  snapshot: string;
  script: string;
  book: string;
  args: string[];
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** 2.7.9's order of a group's or a script's folder: its number first, then its name. */
function byFolderNumber(a: string, b: string): number {
  const number = (folder: string) => Number(/^(\d+)_/.exec(folder)?.[1] ?? Number.MAX_VALUE);
  return number(a) - number(b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** The folders of `dir` that hold `file`, in 2.7.9's order. */
function foldersWith(dir: string, file: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, file)))
    .map((entry) => entry.name)
    .sort(byFolderNumber);
}

/** The bundled groups of the Scripts menu (those with a menu script), in 2.7.9's order. */
function bundledGroups(): BundledGroup[] {
  return foldersWith(SCRIPTS, 'group.json')
    .map((id) => ({
      id,
      names: readJson<{ names: Names }>(path.join(SCRIPTS, id, 'group.json')).names,
      scripts: foldersWith(path.join(SCRIPTS, id), 'script.json')
        .map((folder) => readJson<Manifest>(path.join(SCRIPTS, id, folder, 'script.json')))
        .filter((manifest) => (manifest.kind ?? 'menu') === 'menu'),
    }))
    .filter((group) => group.scripts.length > 0);
}

/** The manifest of the bundled package `<group>/<folder>`. */
function manifest(packagePath: string): Manifest {
  return readJson<Manifest>(path.join(SCRIPTS, packagePath, 'script.json'));
}

/** A name of a manifest in `lang`, English when it has none in that language (host.ts). */
function nameIn(names: Names, lang: UiLang): string {
  return names[lang] ?? names.en;
}

/** The run of `script` on `book` recorded in `snapshots/<suite>/suite.json`. */
function recorded(suite: string, script: string, book: string): Recorded {
  const entry = readJson<Recorded[]>(path.join(SNAPSHOTS, suite, 'suite.json')).find(
    (candidate) => candidate.script === script && candidate.book === book,
  );
  if (!entry) throw new Error(`no recorded run of ${script} on ${book} in ${suite}/suite.json`);
  return entry;
}

const snapshotText = (run: Recorded) => readFileSync(path.join(SNAPSHOTS, run.snapshot), 'utf8');

/** What the recorded run handed the user besides the document (`<snapshot>.outputs.json`). */
function recordedOutputs<T>(run: Recorded): T {
  return readJson<T>(path.join(SNAPSHOTS, run.snapshot.replace(/\.xml$/, '.outputs.json')));
}

/** The harness's normalisation (tests/scripts/run-script.mjs): volatile metadata elided. */
function normaliseXml(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/<program-used>[^<]*<\/program-used>/g, '<program-used>…</program-used>')
    .replace(/(<document-info>[\s\S]*?)<date[^>]*>[^<]*<\/date>/, '$1<date>…</date>')
    .replace(/(<document-info>[\s\S]*?)<id>[^<]*<\/id>/, '$1<id>…</id>')
    .replace(/(<binary\b[^>]*>)[\s\S]*?(<\/binary>)/g, '$1…$2')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

/** The text of an XML fragment: its tags left out, the predefined entities read. */
function xmlText(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** The titles of the main body's sections in an FB2 text, each as its paragraphs' texts. */
function sectionTitlesOf(xml: string): string[][] {
  const body = xml.slice(xml.indexOf('<body>'), xml.indexOf('</body>'));
  return [...body.matchAll(/<section[^>]*>\s*<title>([\s\S]*?)<\/title>/g)].map((match) =>
    [...match[1]!.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((p) => xmlText(p[1]!)),
  );
}

/* ------------------------------------------------------------------------ */
/* The editor                                                               */
/* ------------------------------------------------------------------------ */

interface RunView {
  scriptId: string;
  name: string;
  status: string;
}

/** Browser-side test hooks (`src/scripting/testHooks.ts`); the e2e tsconfig has no DOM lib. */
interface ScriptHooks {
  list(): { id: string }[];
  state(): RunView | null;
  toXml(): Promise<string>;
}

declare const window: { __mfbeTest?: { scripts?: ScriptHooks } };

interface DialogRequest {
  method: string;
  mode: string;
  title: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

/** Opens the editor; resolves with its language once the scripts `ids` are listed. */
async function openApp(page: Page, core: CoreHandle, ids: readonly string[]): Promise<UiLang> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
  await expect
    .poll(
      () =>
        page.evaluate((wanted) => {
          const listed = new Set((window.__mfbeTest?.scripts?.list() ?? []).map((s) => s.id));
          return wanted.every((id) => listed.has(id));
        }, ids),
      { timeout: 15_000 },
    )
    .toBe(true);
  return pageLang(page);
}

/** File > Open with the core's stand-in for the Open dialog. */
async function openBook(page: Page, core: CoreHandle, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

/** Opens the Scripts menu and the submenu of `group`. */
async function openGroup(page: Page, group: string): Promise<void> {
  await page.getByTestId('menu-scripts').click();
  await expect(page.getByTestId('menu-scripts-popup')).toBeVisible();
  await page.getByTestId(`menu-scripts-${group}`).hover();
  await expect(page.getByTestId(`menu-scripts-${group}-popup`)).toBeVisible();
}

/** Closes the open menus (Escape closes one level: the open group first). */
async function closeMenus(page: Page): Promise<void> {
  const popups = page.locator('.mfbe-menu-popup');
  for (let level = 0; level < 3 && (await popups.count()) > 0; level += 1) {
    await page.keyboard.press('Escape');
  }
  await expect(popups).toHaveCount(0);
}

/**
 * Opens the Scripts menu and moves the pointer from the menu's entry straight to `group`, as
 * the user does: over what lies between, with nothing scrolled for it (Playwright's own
 * pointer scrolls a hidden entry into view first). The group's submenu must open there and be
 * on screen - whole in the window, not hidden by the menu it opens from (popupFit.ts: a popup
 * is kept inside the window). The second check is soft, so the journey goes on to the menu's
 * entries when only the placement is wrong.
 */
async function pointAtGroup(page: Page, group: string): Promise<Locator> {
  await page.getByTestId('menu-scripts').click();
  await expect(page.getByTestId('menu-scripts-popup')).toBeVisible();
  const item = page.getByTestId(`menu-scripts-${group}`);
  await item.scrollIntoViewIfNeeded();
  const box = (await item.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  const submenu = page.getByTestId(`menu-scripts-${group}-popup`);
  await expect(submenu, `the submenu of ${group} opens where the pointer rests`).toBeVisible();
  await expect
    .soft(submenu, `the scripts of ${group} are on screen, not hidden by the Scripts menu`)
    .toBeInViewport({ ratio: 0.99 });
  return submenu;
}

/** Scripts > `group` > the script `id`, as the user starts it. */
async function runFromMenu(page: Page, group: string, id: string): Promise<void> {
  await openGroup(page, group);
  await page.getByTestId(`menu-scripts-${group}-${id}`).click();
  await expect(page.getByTestId('menu-scripts-popup')).toHaveCount(0);
}

const runState = (page: Page) =>
  page.evaluate(() => {
    const state = window.__mfbeTest?.scripts?.state();
    return state ? { scriptId: state.scriptId, status: state.status } : null;
  });

/** Waits for the run of `id` to have finished well. */
async function runDone(page: Page, id: string): Promise<void> {
  await expect
    .poll(() => runState(page), { timeout: 60_000 })
    .toEqual({ scriptId: id, status: 'done' });
}

const toXml = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.toXml());

const message = (page: Page) => page.getByTestId('dialog-script-message');
const messageText = (page: Page) => message(page).getByTestId('dialog-script-message-text');

/** Presses `button` of the script's message box once it says `text` (white space aside). */
async function answer(page: Page, text: string, button: string): Promise<void> {
  await expect(messageText(page)).toContainText(text);
  await message(page).getByTestId(`dialog-script-message-button-${button}`).click();
}

/** The titles of the main body's sections as the Body view shows them. */
function shownSectionTitles(page: Page): Promise<string[][]> {
  return page
    .getByTestId('body-editor')
    .locator('.fb-body')
    .first()
    .locator(':scope > .fb-section > .fb-title')
    .evaluateAll((titles) =>
      titles.map((title) =>
        [...title.querySelectorAll(':scope > p')].map((p) => (p.textContent ?? '') as string),
      ),
    );
}

async function grantClipboard(context: BrowserContext, core: CoreHandle): Promise<void> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(core.baseURL).origin,
  });
}

// The page's clipboard; a string, since the e2e tsconfig has no DOM lib.
const readClipboard = (page: Page) => page.evaluate<string>('navigator.clipboard.readText()');
const writeClipboard = (page: Page, text: string) =>
  page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(text)})`);

/** The script's own texts: Russian in the Russian interface, English otherwise (FR-026). */
function scriptTexts(lang: UiLang) {
  return (ru: string, en: string) => (lang === 'ru' ? ru : en);
}

test.beforeEach(async ({ core }) => {
  test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
});

test.describe('US3 (007) the scripts of FictionBook Editor 2.7.9', () => {
  test('1. the Scripts menu shows the bundled groups in 2.7.9 order under their names in the interface language (FR-026)', async ({
    core,
    page,
  }) => {
    // The bundled groups as they are: 2.7.9's, less those the requester removed (99, its
    // phrasetron), each under its folder's number.
    const groups = bundledGroups();
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((group) => /^\d+_/.test(group.id))).toBe(true);
    const lang = await openApp(
      page,
      core,
      groups.map((group) => group.scripts[0]!.id),
    );

    await page.getByTestId('menu-scripts').click();
    const popup = page.getByTestId('menu-scripts-popup');
    await expect(popup).toBeVisible();
    const shown = await popup
      .locator(':scope > [role="menuitem"][aria-haspopup="true"]')
      .evaluateAll((items) =>
        items.map((item) => ({
          id: (item.getAttribute('data-testid') ?? '').replace(/^menu-scripts-/, ''),
          name: (item.querySelector(':scope > .mfbe-menu-label')?.textContent ?? '') as string,
        })),
      );
    // The worker's earlier journeys may have added groups of their own (the user layer): the
    // bundled ones keep 2.7.9's order among them.
    const bundled = new Set(groups.map((group) => group.id));
    expect(shown.filter((item) => bundled.has(item.id))).toEqual(
      groups.map((group) => ({ id: group.id, name: nameIn(group.names, lang) })),
    );
    await closeMenus(page);
  });

  test('2. Заголовки, подзаголовки, пустые строки holds its 19 scripts in their folders order under their names', async ({
    core,
    page,
  }) => {
    const group = bundledGroups().find((candidate) => candidate.id === '13_subtitles')!;
    expect(group.names.ru).toBe('Заголовки, подзаголовки, пустые строки');
    expect(group.scripts).toHaveLength(19);
    const lang = await openApp(
      page,
      core,
      group.scripts.map((script) => script.id),
    );

    const submenu = await pointAtGroup(page, group.id);
    await expect(
      page.getByTestId(`menu-scripts-${group.id}`).locator(':scope > .mfbe-menu-label'),
    ).toHaveText(nameIn(group.names, lang));
    const items = await submenu.locator(':scope > [role="menuitem"]').evaluateAll((elements) =>
      elements.map((element) => ({
        testId: element.getAttribute('data-testid') ?? '',
        name: (element.querySelector(':scope > .mfbe-menu-label')?.textContent ?? '') as string,
      })),
    );
    expect(items).toEqual(
      group.scripts.map((script) => ({
        testId: `menu-scripts-${group.id}-${script.id}`,
        name: nameIn(script.name, lang),
      })),
    );
    await closeMenus(page);
  });

  test("3. Привести заголовки глав к виду 'Глава 1' gives the recorded titles; its message is in the script's languages, English in the Ukrainian interface (FR-026)", async ({
    core,
    page,
  }) => {
    const chapters = manifest('13_subtitles/30_chapter-titles');
    expect(chapters.name.ru).toBe("Привести заголовки глав к виду 'Глава 1'");
    const run = recorded(
      '13',
      'scripts/13_subtitles/30_chapter-titles',
      'tests/scripts/fixtures/279/13/chapters.fb2',
    );
    // The recorded run selects nothing and answers its one message with OK.
    expect(run.args).toEqual([]);
    const expected = snapshotText(run);
    const lang = await openApp(page, core, [chapters.id]);
    const L = scriptTexts(lang);
    await openBook(page, core, path.join(REPO_ROOT, run.book));
    expect(await shownSectionTitles(page)).not.toEqual(sectionTitlesOf(expected));

    await runFromMenu(page, '13_subtitles', chapters.id);
    // The closing message, in the script's own languages: the menu named the script in the
    // interface language, the dialog speaks Russian or English (FR-026's exception).
    await expect(messageText(page)).toContainText(
      L('–= Скрипт Sclex-а =–', '–= A script by Sclex =–'),
    );
    await expect(messageText(page)).toContainText(
      new RegExp(L('Произведено замен заголовков глав: \\d+', 'Chapter titles replaced: \\d+')),
    );
    if (lang !== 'ru') {
      await expect(messageText(page)).not.toContainText('Произведено');
      await expect(messageText(page)).not.toContainText('Скрипт');
    }
    await message(page).getByTestId('dialog-script-message-button-ok').click();
    await runDone(page, chapters.id);

    // The titles of the recorded run, shown in the Body view, and the whole document.
    await expect.poll(() => shownSectionTitles(page)).toEqual(sectionTitlesOf(expected));
    expect(normaliseXml(await toXml(page))).toBe(normaliseXml(expected));
  });

  test('4. Общая статистика puts its recorded text on the clipboard and saves it through the Save dialog in UTF-16 LE (FR-024)', async ({
    core,
    page,
    context,
  }) => {
    await grantClipboard(context, core);
    const statistics = manifest('10_statistics/07_general-statistics');
    expect(statistics.name.ru).toBe('Общая статистика');
    // The text the script puts on the clipboard is recorded by the test driver that runs it
    // and reads the clipboard back (tests/scripts/fixtures/279/10/chains/general-statistics),
    // after its first line "run() returned …" and with the run's time and the current date
    // and time as placeholders - in English, the language of the harness's interface.
    const chain = recorded(
      '10',
      'tests/scripts/fixtures/279/10/chains/general-statistics',
      'tests/scripts/fixtures/279/10/statistics.fb2',
    );
    const { clipboard: driverText } = recordedOutputs<{ clipboard: string }>(chain);
    expect(driverText).toMatch(/^run\(\) returned .*\n/);
    const recordedText = driverText.slice(driverText.indexOf('\n') + 1);
    const stable = (text: string) =>
      text
        .replace(/\r\n/g, '\n')
        .replace(/^(• (?:Время выполнения|Time)[ .]*\t).*$/m, '$1<время>')
        .replace(/^• \d{1,2}\.\d\d\.\d\d • \d{1,2}:\d\d:\d\d •$/m, '• <дата> • <время> •');

    const folder = mkdtempSync(path.join(tmpdir(), 'mfbe-us3-279-'));
    try {
      const lang = await openApp(page, core, [statistics.id]);
      const L = scriptTexts(lang);
      await openBook(page, core, path.join(REPO_ROOT, chain.book));
      await writeClipboard(page, 'us3-279: the clipboard before the run');
      const saved = path.join(folder, 'statistics.txt');
      await core.enqueueDialog('dialog.saveFile', { path: saved });
      const requestsBefore = (await core.rpc<DialogRequest[]>('test.dialogRequests')).length;

      await runFromMenu(page, '10_statistics', statistics.id);
      // The results, page by page (Yes shows the next one; on the last Yes closes them),
      // captioned with the script's name in the interface language, worded in the script's.
      await expect(message(page).locator('.mfbe-dialog-title-text')).toHaveText(
        nameIn(statistics.name, lang),
      );
      for (let shown = 1; shown <= 10; shown += 1) {
        await expect(messageText(page)).toContainText(L(`◊ Стр. ${shown}`, `◊ Page ${shown}`));
        const last = ((await messageText(page).textContent()) ?? '').includes(
          L('(последняя)', '(the last)'),
        );
        await message(page).getByTestId('dialog-script-message-button-yes').click();
        if (last) break;
      }
      // Its two questions: the clipboard, then the file.
      await answer(page, L('в буфер обмена?', 'to the clipboard?'), 'yes');
      await answer(
        page,
        L('в TXT-файл, в кодировке "UTF-16 LE"?', 'to a TXT file, in the "UTF-16 LE" encoding?'),
        'yes',
      );
      await runDone(page, statistics.id);

      // The clipboard: the recorded text in English (and so in the Ukrainian interface). In
      // Russian the same lines with the same numbers, under the script's Russian labels and
      // units (its `L(ru, en)` texts: «Строк», « Б» for « B», a decimal comma for KB and MB).
      const clipboard = await readClipboard(page);
      if (lang === 'ru') {
        const lines = stable(clipboard).split('\n');
        const recordedLines = recordedText.split('\n');
        expect(lines).toHaveLength(recordedLines.length);
        expect(lines[1]).toBe(
          recordedLines[1]!.replace('«General statistics»', '«Общая статистика»'),
        );
        expect(lines[6]).toMatch(/^Строк\s/);
        expect(recordedLines[6]).toMatch(/^Lines\s/);
        // The numbers of a line: those of its value (after its first tab), or of the whole
        // line when it has no value.
        const numbers = (line: string) =>
          (line.includes('\t') ? line.slice(line.indexOf('\t')) : line).match(/\d+/g) ?? [];
        expect(lines.map(numbers)).toEqual(recordedLines.map(numbers));
        expect(stable(clipboard)).not.toBe(recordedText);
      } else {
        expect(stable(clipboard)).toBe(recordedText);
      }

      // The Save dialog: one request, with the script's file name and title, for a TXT file.
      const requests = (await core.rpc<DialogRequest[]>('test.dialogRequests')).slice(
        requestsBefore,
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        method: 'dialog.saveFile',
        mode: 'save',
        title: nameIn(statistics.name, lang),
      });
      expect(requests[0]!.defaultPath).toMatch(
        new RegExp(`^${L('Общая статистика', 'General statistics')} \\(.+\\)\\.txt$`),
      );
      expect(requests[0]!.filters?.[0]?.extensions).toContain('txt');
      // The file: the clipboard's text, in UTF-16 little endian with a BOM.
      const bytes = readFileSync(saved);
      expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
      expect(bytes.subarray(2).toString('utf16le').replace(/\r\n/g, '\n')).toBe(
        clipboard.replace(/\r\n/g, '\n'),
      );
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test('5. a combo (Расформатировать все заголовки_Комбо) gives its recorded result as one undo step (FR-024, FR-025)', async ({
    core,
    page,
  }) => {
    const combo = manifest('13_subtitles/590_unformat-all-titles');
    expect(combo.name.ru).toBe('Расформатировать все заголовки_Комбо');
    const run = recorded(
      'chains',
      'scripts/13_subtitles/590_unformat-all-titles',
      'tests/scripts/fixtures/279/chains/titles.fb2',
    );
    // The recorded run answers the one message (no title left) with OK.
    expect(run.args).toEqual([]);
    const lang = await openApp(page, core, [combo.id]);
    const L = scriptTexts(lang);
    await openBook(page, core, path.join(REPO_ROOT, run.book));
    const before = await toXml(page);
    const undo = page.getByTestId('toolbar-edit.undo');
    const redo = page.getByTestId('toolbar-edit.redo');
    await expect(undo).toBeDisabled();

    await runFromMenu(page, '13_subtitles', combo.id);
    // The loop ends when "Выделить следующий заголовок" (16/next-title) finds no more titles.
    await answer(
      page,
      L(
        'До конца документа не нашлось ни одного заголовка.',
        'No title was found up to the end of the document.',
      ),
      'ok',
    );
    await runDone(page, combo.id);
    const after = await toXml(page);
    expect(normaliseXml(after)).toBe(normaliseXml(snapshotText(run)));

    // One Ctrl+Z restores the book, and nothing is left to undo; one Ctrl+Y the result.
    await expect(undo).toBeEnabled();
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => toXml(page)).toBe(before);
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
    await page.keyboard.press(`${MOD}+y`);
    await expect.poll(() => toXml(page)).toBe(after);
    await expect(redo).toBeDisabled();
    await expect(undo).toBeEnabled();
  });

  test('6. a report window opens with the recorded report, stays after the run, and Copy puts its text on the clipboard (FR-024)', async ({
    core,
    page,
    context,
  }) => {
    await grantClipboard(context, core);
    const links = manifest('10_statistics/02_show-all-links');
    expect(links.name.ru).toBe('Показать все-все ссылки');
    const run = recorded(
      '10',
      'scripts/10_statistics/02_show-all-links',
      'tests/scripts/fixtures/279/10/links.fb2',
    );
    expect(run.args).toEqual([]);
    const { reports } = recordedOutputs<{ reports: { title: string; text: string }[] }>(run);
    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    const lang = await openApp(page, core, [links.id]);
    // The report of the harness's English interface; the Russian one heads its two lists with
    // the script's Russian headings.
    const expectedText =
      lang === 'ru'
        ? report.text
            .replace('INTERNAL LINKS:', 'ВНУТРЕННИЕ ССЫЛКИ:')
            .replace('EXTERNAL LINKS:', 'ВНЕШНИЕ ССЫЛКИ:')
        : report.text;
    await openBook(page, core, path.join(REPO_ROOT, run.book));
    await writeClipboard(page, 'us3-279: the clipboard before the copy');

    await runFromMenu(page, '10_statistics', links.id);
    await runDone(page, links.id);
    const windows = page.locator('[data-testid^="script-report-"][role="dialog"]');
    await expect(windows).toHaveCount(1);
    const testId = (await windows.getAttribute('data-testid'))!;
    expect(testId).toMatch(/^script-report-\d+$/);
    const reportWindow = page.getByTestId(testId);
    // Modeless, and still open after the run.
    await expect(reportWindow).toBeVisible();
    await expect(reportWindow).toHaveAttribute('aria-modal', 'false');
    expect(await reportWindow.locator('.mfbe-dialog-title-text').textContent()).toBe(report.title);
    expect(await page.getByTestId(`${testId}-text`).textContent()).toBe(expectedText);

    const copy = page.getByTestId(`${testId}-button-copy`);
    await expect(copy).toHaveText(await pageText(page, 'scripting.report.copy'));
    await copy.click();
    await expect(page.getByTestId(`${testId}-status`)).toHaveText(
      await pageText(page, 'scripting.report.copied'),
    );
    expect(await readClipboard(page)).toBe(expectedText);
    await page.getByTestId(`${testId}-button-close`).click();
    await expect(reportWindow).toHaveCount(0);
  });
});
