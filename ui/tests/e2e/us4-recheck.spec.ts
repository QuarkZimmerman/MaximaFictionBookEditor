/**
 * Feature 007, User Story 4 - the scripts converted from 2.7beta1, rechecked against 2.7.9,
 * keep their names' 2.7.9 wording and the user's settings for them (T072; FR-021, FR-026,
 * FR-028). Every expected value comes from the repository: the names from the packages'
 * `script.json`, the 2.7beta1 name from the package's own conversion header, the results from
 * the runs recorded under `tests/scripts/snapshots`. The settings are those of an earlier
 * version: a profile whose `hotkeys.json` and `settings.json` are written before its core
 * starts, in the form the core reads them (core/src/settings/hotkeys.cpp, the `session` block of
 * settings.json). The `chromium`, `chromium-ru` and `chromium-uk` projects run it with the
 * English, the Russian and the Ukrainian interface; each leg expects its own language. Needs the
 * real core (`MFBE_CORE_BIN`); skipped otherwise.
 *
 *  1. 2.7beta1's *Добавить сноску, оставшись на ее ссылке* (`02/add-footnote`) shows in the
 *     Scripts menu as 2.7.9's *Добавить примечание, остаться на его ссылке* - in the English and
 *     the Ukrainian interface under its names of those languages -, with the chord of the
 *     profile's `hotkeys.json` beside it, and no script of its group keeps the old name; the
 *     journey points at the group as the user does (`pointAtGroup`), so the group's scripts must
 *     be on screen.
 *  2. A `hotkeys.json` binding `script.02/add-footnote` still runs it: the chord gives the
 *     result of its recorded run.
 *  3. A Scripts toolbar layout holding moved scripts still shows their buttons, which run them:
 *     `16/previous-emphasis` (moved from `01_` to its 2.7.9 place `001_`, commit 325fb61) and
 *     `08/split-into-sections` (moved from group 08 to group 13), both with their ids kept.
 *  4. `session.lastScript` naming the renamed `02/add-footnote` keeps Last script enabled, and
 *     Last script runs it under its 2.7.9 name with the result of its recorded run.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import {
  expect,
  NodeRpcClient,
  startCoreWith,
  test,
  waitForBook,
  withUiLang,
} from './fixtures/core';
import { pageLang, pageText, type UiLang } from './fixtures/i18n';
import { label } from './fixtures/keys';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SCRIPTS = path.join(REPO_ROOT, 'scripts');
const SNAPSHOTS = path.join(REPO_ROOT, 'tests', 'scripts', 'snapshots');

/** The package renamed by 2.7.9 (*сноска* became *примечание*). */
const ADD_FOOTNOTE = '02_footnotes/01_add-footnote';
/** Moved to its 2.7.9 place in its group (`01_previous-emphasis`, commit 325fb61). */
const PREVIOUS_EMPHASIS = '16_find-formatting/001_previous-emphasis';
/** Moved to another group (`08_sections/02_split-into-sections`, 2.7.9's group 13). */
const SPLIT_INTO_SECTIONS = '13_subtitles/05_split-into-sections';

/** The user's chord in the profile's hotkeys.json, and the same chord as Playwright presses it. */
const CHORD = 'Ctrl+Shift+F9';
const CHORD_PRESS = 'Control+Shift+F9';

/* ------------------------------------------------------------------------ */
/* What the repository says                                                 */
/* ------------------------------------------------------------------------ */

type Names = Partial<Record<UiLang, string>> & { en: string };

interface Manifest {
  id: string;
  name: Names;
}

/** One recorded run of `snapshots/suite.json`. */
interface Recorded {
  snapshot: string;
  script: string;
  book: string;
  args: string[];
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** The manifest of the bundled package `<group>/<folder>`. */
function manifest(packagePath: string): Manifest {
  return readJson<Manifest>(path.join(SCRIPTS, packagePath, 'script.json'));
}

/** A name of a manifest in `lang`, English when it has none in that language (host.ts). */
function nameIn(names: Names, lang: UiLang): string {
  return names[lang] ?? names.en;
}

/** The group folder of a bundled package path. */
const groupOf = (packagePath: string) => packagePath.split('/')[0]!;

/**
 * The run of `02/add-footnote` recorded with the caret in the text of `conv-a-02.fb2`
 * (`snapshots/suite.json`): its book, its caret and its result.
 */
function recordedAddFootnote(): { book: string; caret: [string, number, number]; xml: string } {
  const run = readJson<Recorded[]>(path.join(SNAPSHOTS, 'suite.json')).find(
    (candidate) =>
      candidate.script === `scripts/${ADD_FOOTNOTE}` &&
      candidate.book === 'tests/scripts/fixtures/books/conv-a-02.fb2',
  );
  if (!run) throw new Error(`no recorded run of scripts/${ADD_FOOTNOTE} on conv-a-02.fb2`);
  // `--select <nodeId>:<from>:<to>` and nothing else: no dialog to answer.
  expect(run.args).toHaveLength(2);
  expect(run.args[0]).toBe('--select');
  const [nodeId, from, to] = run.args[1]!.split(':');
  return {
    book: path.join(REPO_ROOT, run.book),
    caret: [nodeId!, Number(from), Number(to)],
    xml: readFileSync(path.join(SNAPSHOTS, run.snapshot), 'utf8'),
  };
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
  select(nodeId: string, from?: number, to?: number): boolean;
}

declare const window: { __mfbeTest?: { scripts?: ScriptHooks } };

/** What a journey needs of a core: the stand-in of its native dialogs. */
interface DialogStandIn {
  enqueueDialog(method: string, result: unknown): Promise<void>;
}

/** A core of the test's own on a profile written before it starts. */
interface ProfileCore extends DialogStandIn {
  url: string;
  stop(): Promise<void>;
}

/**
 * Starts a core on a data folder of its own holding `hotkeys.json` and `settings.json` as an
 * earlier version of the editor left them; the folder goes with `stop()`.
 */
async function profileCore(files: { hotkeys?: object; settings?: object }): Promise<ProfileCore> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mfbe-us4-recheck-'));
  if (files.hotkeys) {
    writeFileSync(
      path.join(dataDir, 'hotkeys.json'),
      `${JSON.stringify(files.hotkeys, null, 2)}\n`,
    );
  }
  if (files.settings) {
    writeFileSync(
      path.join(dataDir, 'settings.json'),
      `${JSON.stringify(files.settings, null, 2)}\n`,
    );
  }
  let started: Awaited<ReturnType<typeof startCoreWith>>;
  try {
    started = await startCoreWith(process.env.MFBE_CORE_BIN!, dataDir, []);
  } catch (error) {
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }
  const url = new URL(started.url);
  const rpc = new NodeRpcClient(
    `ws://127.0.0.1:${url.port}/rpc?token=${url.searchParams.get('token') ?? ''}`,
  );
  return {
    url: started.url,
    enqueueDialog: async (method, result) => {
      await rpc.call('test.enqueueDialog', { method, result });
    },
    stop: async () => {
      rpc.close();
      await started.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Waits for the editor's start and the scripts `ids` in its catalogue; its language. */
async function ready(page: Page, ids: readonly string[]): Promise<UiLang> {
  await page.locator('[data-testid="app-root"][data-startup="ready"]').waitFor();
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

/** Opens the editor of a profile core in the leg's language. */
async function openProfile(
  page: Page,
  profile: ProfileCore,
  uiLang: UiLang | undefined,
  ids: readonly string[],
): Promise<UiLang> {
  await page.goto(withUiLang(profile.url, uiLang));
  return ready(page, ids);
}

/** File > Open with the core's stand-in for the Open dialog. */
async function openBook(page: Page, core: DialogStandIn, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
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

/** Closes the open menus (Escape closes one level: the open group first). */
async function closeMenus(page: Page): Promise<void> {
  const popups = page.locator('.mfbe-menu-popup');
  for (let level = 0; level < 3 && (await popups.count()) > 0; level += 1) {
    await page.keyboard.press('Escape');
  }
  await expect(popups).toHaveCount(0);
}

const runState = (page: Page) => page.evaluate(() => window.__mfbeTest?.scripts?.state() ?? null);

/** Waits for the run of `id` to have finished well; resolves with its state. */
async function runDone(page: Page, id: string): Promise<RunView> {
  await expect
    .poll(async () => {
      const state = await runState(page);
      return state ? { scriptId: state.scriptId, status: state.status } : null;
    })
    .toEqual({ scriptId: id, status: 'done' });
  return (await runState(page))!;
}

/** Puts the caret (or the selection) where the recorded run had it. */
async function select(page: Page, [nodeId, from, to]: [string, number, number]): Promise<void> {
  const selected = await page.evaluate(
    (caret) => window.__mfbeTest!.scripts!.select(caret.nodeId, caret.from, caret.to),
    { nodeId, from, to },
  );
  expect(selected, `${nodeId}:${from}:${to} selected`).toBe(true);
}

const toXml = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.toXml());

/** The script's own texts: Russian in the Russian interface, English otherwise (FR-026). */
function scriptTexts(lang: UiLang) {
  return (ru: string, en: string) => (lang === 'ru' ? ru : en);
}

test.beforeEach(async ({ core }) => {
  test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
});

test.describe('US4 (007) the rechecked scripts keep the user settings for them', () => {
  test('1. Добавить сноску, оставшись на ее ссылке shows under its 2.7.9 name Добавить примечание, остаться на его ссылке, with the user chord', async ({
    page,
    uiLang,
  }) => {
    const script = manifest(ADD_FOOTNOTE);
    const group = groupOf(ADD_FOOTNOTE);
    expect(script.id).toBe('02/add-footnote');
    expect(script.name.ru).toBe('Добавить примечание, остаться на его ссылке');
    // The 2.7beta1 name, from the package's own conversion header.
    const header = readFileSync(path.join(SCRIPTS, ADD_FOOTNOTE, 'index.js'), 'utf8');
    const old =
      /^\/\/ Converted from FictionBook Editor 2\.7: Scripts\/[^/]+\/\d+_(.+)\.js,$/m.exec(
        header,
      )?.[1];
    expect(old).toBe('Добавить сноску, оставшись на ее ссылке');
    const profile = await profileCore({
      hotkeys: { schemaVersion: 1, bindings: [{ command: `script.${script.id}`, keys: CHORD }] },
    });
    try {
      const lang = await openProfile(page, profile, uiLang, [script.id]);
      const submenu = await pointAtGroup(page, group);
      // The 2.7.9 name, with the user's chord beside it; no script of the group keeps the old
      // name.
      const item = page.getByTestId(`menu-scripts-${group}-${script.id}`);
      await expect(item.locator(':scope > .mfbe-menu-label')).toHaveText(nameIn(script.name, lang));
      await expect(item.locator(':scope > .mfbe-menu-hotkey')).toHaveText(label(CHORD));
      const names = await submenu
        .locator(':scope > [role="menuitem"] > .mfbe-menu-label')
        .allTextContents();
      expect(names).toContain(nameIn(script.name, lang));
      expect(names).not.toContain(old);
      await closeMenus(page);
    } finally {
      await profile.stop();
    }
  });

  test('2. a hotkeys.json binding script.02/add-footnote still runs it', async ({
    page,
    uiLang,
  }) => {
    const script = manifest(ADD_FOOTNOTE);
    const run = recordedAddFootnote();
    const profile = await profileCore({
      hotkeys: { schemaVersion: 1, bindings: [{ command: `script.${script.id}`, keys: CHORD }] },
    });
    try {
      const lang = await openProfile(page, profile, uiLang, [script.id]);
      // The chord runs it where the recorded run had the caret, with the recorded result.
      await openBook(page, profile, run.book);
      await select(page, run.caret);
      await page.keyboard.press(CHORD_PRESS);
      const state = await runDone(page, script.id);
      expect(state.name).toBe(nameIn(script.name, lang));
      expect(normaliseXml(await toXml(page))).toBe(normaliseXml(run.xml));
    } finally {
      await profile.stop();
    }
  });

  test('3. a Scripts toolbar layout holding moved scripts still shows their buttons, which run them', async ({
    page,
    uiLang,
  }) => {
    const previous = manifest(PREVIOUS_EMPHASIS);
    const split = manifest(SPLIT_INTO_SECTIONS);
    // Their ids are those of their 2.7beta1 places.
    expect(previous.id).toBe('16/previous-emphasis');
    expect(split.id).toBe('08/split-into-sections');
    const layout = ['scripts.last', `script.${previous.id}`, `script.${split.id}`];
    const profile = await profileCore({
      settings: { schemaVersion: 1, session: { toolbarLayouts: { scripts: layout } } },
    });
    try {
      const lang = await openProfile(page, profile, uiLang, [previous.id, split.id]);
      const L = scriptTexts(lang);
      const toolbar = page.getByTestId('toolbar-scripts');
      await expect
        .poll(() =>
          toolbar
            .locator('[data-toolbar-item]')
            .evaluateAll((items) => items.map((item) => item.getAttribute('data-toolbar-item'))),
        )
        .toEqual(layout);
      for (const script of [previous, split]) {
        const button = page.getByTestId(`scripts-toolbar-${script.id}`);
        await expect(button).toBeVisible();
        await expect(button).toBeEnabled();
        await expect(button).toHaveAttribute('data-command', `script.${script.id}`);
        await expect(button).toHaveAttribute('aria-label', nameIn(script.name, lang));
      }
      const banner = page.getByTestId('script-run-banner');

      // "Go to previous italics" on the start-up document, which has none: the script asks
      // whether to go on from the end; Cancel ends it.
      await page.getByTestId(`scripts-toolbar-${previous.id}`).click();
      const question = page.getByTestId('dialog-script-message');
      await expect(question.getByTestId('dialog-script-message-text')).toContainText(
        L('Достигнуто начало документа.', 'The beginning of the document has been reached.'),
      );
      await expect(banner).toHaveAttribute('data-script-id', previous.id);
      await question.getByTestId('dialog-script-message-button-cancel').click();
      await runDone(page, previous.id);

      // "Mark up section titles or subtitles found by a regular expression...": its form;
      // Cancel ends it.
      await page.getByTestId(`scripts-toolbar-${split.id}`).click();
      const form = page.getByTestId('dialog-script-form');
      await expect(form.getByTestId('dialog-script-form-title')).toContainText(
        L(
          'Разметить заголовки разделов либо подзаголовки, найденные по регэкспу',
          'Mark up section titles or subtitles found by a regular expression',
        ),
      );
      await expect(banner).toHaveAttribute('data-script-id', split.id);
      await form.getByTestId('dialog-script-form-button-cancel').click();
      await runDone(page, split.id);
    } finally {
      await profile.stop();
    }
  });

  test('4. session.lastScript naming the renamed script keeps Last script enabled; it runs that script', async ({
    page,
    uiLang,
  }) => {
    const script = manifest(ADD_FOOTNOTE);
    const run = recordedAddFootnote();
    const profile = await profileCore({
      settings: { schemaVersion: 1, session: { lastScript: script.id } },
    });
    try {
      const lang = await openProfile(page, profile, uiLang, [script.id]);
      const last = page.getByTestId('toolbar-scripts.last');
      await expect(last).toBeEnabled();
      await page.getByTestId('menu-scripts').click();
      await expect(page.getByTestId('menu-scripts-last')).toBeVisible();
      await expect(page.getByTestId('menu-scripts-last')).not.toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await closeMenus(page);

      // Last script runs the renamed script, under its 2.7.9 name, with the recorded result.
      await openBook(page, profile, run.book);
      await expect(last).toBeEnabled();
      await select(page, run.caret);
      await last.click();
      const state = await runDone(page, script.id);
      expect(state.name).toBe(nameIn(script.name, lang));
      expect(normaliseXml(await toXml(page))).toBe(normaliseXml(run.xml));
    } finally {
      await profile.stop();
    }
  });
});
