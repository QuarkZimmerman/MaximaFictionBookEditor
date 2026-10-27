/**
 * User Story 9 (feature 005) - switch the assistant off completely (T063; quickstart §9), as
 * amended by the requester on 2026-10-23 after the rc.1 smoke test (T100; FR-040, FR-096): the
 * View entry, its hotkey and the toolbar button stay in every mode - they show and hide the
 * panel -, the panel's visibility is a session key (`session.aiPanelVisible`, open at the first
 * start and restored at every start) and a visible panel while Disabled is **inert**: every
 * control disabled and greyed, no conversation, a centred notice with a link to Settings → AI
 * assistant; nothing of the `ai-assistant` chunk is loaded while disabled.
 *
 * Needs the real core (`MFBE_CORE_BIN`); skipped in core-less mode. The stand-in service
 * (`fixtures/ai-standin.mjs`, loopback only) is the only service the editor could reach: the
 * free entry `ovhcloud` is redirected to it by a user list file and the custom target names it
 * directly, so a request the journeys do not expect would be recorded there (and answered 500)
 * instead of leaving the machine; `recordOutside` aborts anything else.
 *
 * Scenarios (spec.md US9; FR-020, FR-096 to FR-098, FR-104, SC-013):
 *  1+4. from `custom` with the panel restored open and live: Settings → Disabled → OK → the
 *     context-menu entry and the Ask hotkey are gone at once, the visible panel turns inert,
 *     the registry holds the live `ai.toggle`, the inert stub of `ai.ask` and no `ai.cancel`;
 *     the View entry, the button and the toggle hotkey stay and hide / show the inert panel
 *     without loading anything; Disabled → Free → OK makes the visible panel live again
 *     without a restart; the XML, the modified state and the undo history are untouched
 *     throughout (FR-095, FR-096, FR-097)
 *  3. Disabled chosen while a request runs: `dialog-ai-stop-confirm` before anything is
 *     applied - No keeps the settings dialog open and the request running, Yes cancels it,
 *     turns the assistant off (the panel inert) and de-registers it (FR-093, FR-097). The page
 *     is reached through the panel's settings link: the run lock of the request blocks the
 *     Tools menu's Settings entry like every other command (feature 003 FR-011, feature 005
 *     FR-022)
 *  2. the silence proof (SC-013), run twice - with `free` and the panel hidden (the assistant
 *     off), then with `disabled` and the panel open (inert): a whole editing session (open,
 *     type, save, a script on a selection, the spelling check, Source and back, Settings
 *     opened and closed) makes no request of the feature (the stand-in's record and
 *     `test.aiRequests()` empty), loads nothing of the `ai-assistant` chunk (every `/assets/`
 *     request is one of the main bundle's files - the set the `00-smoke` journey loads) and
 *     shows exactly the View entry and the button while off, and those plus the inert panel
 *     with its notice while disabled (FR-094, FR-096)
 *  5. a second core on the data directory with Disabled saved starts disabled from the first
 *     paint (no element of the live assistant ever appears - FR-098), and so does a third core
 *     on a copy of the directory (the portable move)
 *  - FR-096 (requester, 2026-10-22): with Disabled saved the settings page offers Test
 *    connection only while the page's radio is a service; the test then goes to the selected
 *    model, exactly once; Cancel leaves settings.json byte-identical and sends nothing more.
 *  US11 sc.5 (feature 006): a book with tables and a block of cells, and none of the
 *    assistant's table additions - the editing session runs a table command on a block of
 *    two cells with Undo and Redo, the table's context menu offers no Ask entry, no chunk asset
 *    loads (so no code of read_table, edit_table, the passage, tableWarning or cells exists in
 *    the page) and, Disabled, `__mfbeTest.ai.state().catalogue` is false (U24)
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Browser, Locator, Page } from '@playwright/test';

import {
  expect,
  fixtureBook,
  NodeRpcClient,
  recordOutside,
  startCoreWith,
  test,
  waitForBook,
  withUiLang,
  type AiRequestRecord,
  type CoreHandle,
  type StandinHandle,
} from './fixtures/core';
import { pageText, type UiLang } from './fixtures/i18n';
import { LINE_END, LINE_START, MOD, SELECT_TO_LINE_END } from './fixtures/keys';

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/ai-services/', import.meta.url));
const BOOK = fixtureBook('modern-utf8.fb2');
const SELECTION_BOOK = fixtureBook('ai-selection.fb2');

interface AiCommandSnapshot {
  id: string;
  visible: boolean;
  enabled: boolean;
  stub: boolean;
}

/**
 * The registry as US9 expects it while the assistant is disabled: the live `ai.toggle` (it
 * shows and hides the inert panel), the inert stub of `ai.ask`, no `ai.cancel`.
 */
const DISABLED_COMMANDS: AiCommandSnapshot[] = [
  { id: 'ai.toggle', visible: true, enabled: true, stub: false },
  { id: 'ai.ask', visible: false, enabled: false, stub: true },
];

/** The three live commands while the assistant is off (the panel hidden). */
const OFF_COMMANDS: AiCommandSnapshot[] = [
  { id: 'ai.toggle', visible: true, enabled: true, stub: false },
  { id: 'ai.ask', visible: false, enabled: false, stub: false },
  { id: 'ai.cancel', visible: true, enabled: false, stub: false },
];

/** The three live commands while the assistant is on (the panel visible and live). */
const ON_COMMANDS: AiCommandSnapshot[] = [
  { id: 'ai.toggle', visible: true, enabled: true, stub: false },
  { id: 'ai.ask', visible: true, enabled: true, stub: false },
  { id: 'ai.cancel', visible: true, enabled: false, stub: false },
];

/**
 * Test ids of the live assistant's elements: never attached while it is disabled (FR-096) or
 * off (FR-094) - the context-menu entries, the live panel's content, the popup, the notice.
 */
const LIVE_TEST_IDS = [
  'context-menu-ai.ask',
  'source-context-menu-ai.ask',
  'ai-panel-content',
  'ai-messages',
  'ai-activity',
  'ai-empty',
  'ai-settings-link',
  'ai-stop',
  'dialog-ai-ask',
  'dialog-ai-notice',
];

/** What remains while disabled: the entry, the button and - when visible - the inert panel. */
const SHELL_TEST_IDS = [
  'toolbar-ai.toggle',
  'menu-view-toggle',
  'ai-panel',
  'ai-splitter',
  'ai-panel-disabled',
  'ai-panel-disabled-notice',
  'ai-panel-disabled-settings',
];

const FEATURE_TEST_IDS = [...LIVE_TEST_IDS, ...SHELL_TEST_IDS];

/**
 * Watches the DOM from the first script of the page: every element of the feature that is
 * ever attached is recorded, so "no flash of the entry at start-up" (FR-098) is a fact about
 * the whole page life, not about the moment an assertion looked.
 */
async function watchForFeatureElements(page: Page): Promise<void> {
  // A script text: the e2e tsconfig has no DOM library.
  const selector = FEATURE_TEST_IDS.map((id) => `[data-testid="${id}"]`).join(',');
  await page.addInitScript(`(() => {
    const seen = [];
    window.__us9Seen = seen;
    const selector = ${JSON.stringify(selector)};
    const check = (node) => {
      if (!(node instanceof Element)) return;
      if (node.matches(selector)) seen.push(node.getAttribute('data-testid'));
      for (const inner of node.querySelectorAll(selector)) seen.push(inner.getAttribute('data-testid'));
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(check);
    });
    // The document itself: the init script may run before its root element exists.
    observer.observe(document, { childList: true, subtree: true });
  })();`);
}

const featureElementsSeen = (page: Page) =>
  page.evaluate<string[]>('(window.__us9Seen ?? []).slice()');

/** The live assistant's elements the watcher saw (expected empty while off or disabled). */
async function liveElementsSeen(page: Page): Promise<string[]> {
  return (await featureElementsSeen(page)).filter((id) => LIVE_TEST_IDS.includes(id));
}

const aiCommands = (page: Page) =>
  page.evaluate<AiCommandSnapshot[]>('window.__mfbeTest.ai.commands()');
const aiStatus = (page: Page) => page.evaluate<string>('window.__mfbeTest.ai.status()');
const assistantOn = (page: Page) => page.evaluate<boolean>('window.__mfbeTest.ai.on');
const panelVisible = (page: Page) => page.evaluate<boolean>('window.__mfbeTest.ai.state().visible');
const aiHooksInstalled = (page: Page) =>
  page.evaluate<boolean>('typeof window.__mfbeTest?.ai?.commands === "function"');
const documentXml = (page: Page) => page.evaluate<string>('window.__mfbeTest.scripts.toXml()');
const lastRequestState = (page: Page) =>
  page.evaluate<string | null>('window.__mfbeTest.ai.lastRequest()?.state ?? null');
const isModified = (page: Page) => page.title().then((title) => /\* - /.test(title));

/** The `/assets/` files the page requested, by their path. */
function recordAssets(page: Page): string[] {
  const assets: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes('/assets/')) assets.push(url.pathname);
  });
  return assets;
}

/** Uncaught page errors and console errors (the journeys expect none from inert hotkeys). */
function recordErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/** Only the main bundle's files were loaded - never the `ai-assistant` chunk (SC-013). */
function expectMainBundleOnly(assets: string[]): void {
  expect(assets.length).toBeGreaterThan(0);
  for (const asset of assets) {
    expect(asset, `an asset outside the main bundle was requested: ${asset}`).toMatch(
      /\/assets\/index-[^/]+\.(js|css)$/,
    );
    expect(asset).not.toMatch(/ai-assistant-.*\.js$/);
  }
}

async function openApp(page: Page, core: CoreHandle): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
}

async function openBook(page: Page, core: CoreHandle, book: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

async function configureCustomTarget(core: CoreHandle, standin: StandinHandle): Promise<void> {
  await core.rpc('settings.set', {
    patch: {
      ai: {
        mode: 'custom',
        custom: { address: `${standin.url}/v1`, key: '', model: 'standin-chat' },
      },
    },
  });
}

/** The user list file redirecting the bundled `ovhcloud` entry to the stand-in. */
function writeStandinOverride(dataDir: string, standinPort: number): void {
  const text = readFileSync(path.join(FIXTURES, 'user-override.json'), 'utf8').replace(
    /127\.0\.0\.1:8787/g,
    `127.0.0.1:${standinPort}`,
  );
  writeFileSync(path.join(dataDir, 'ai-services.json'), text);
}

function removeStandinOverride(dataDir: string): void {
  rmSync(path.join(dataDir, 'ai-services.json'), { force: true });
}

/** Tools > Settings > the AI assistant page (the list arrived). */
async function openAiSettings(page: Page): Promise<Locator> {
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-settings').click();
  await expect(page.getByTestId('dialog-settings')).toBeVisible();
  await page.getByTestId('settings-tab-ai').click();
  const aiPage = page.getByTestId('settings-page-ai');
  await expect(aiPage).toBeVisible();
  await expect(page.getByTestId('settings-ai-service').locator('option').first()).toBeAttached();
  return aiPage;
}

/** Settings → AI → the given mode → OK (the dialog closes unless a hook keeps it open). */
async function chooseModeAndOk(page: Page, mode: 'free' | 'custom' | 'disabled'): Promise<void> {
  await openAiSettings(page);
  await page.getByTestId(`settings-ai-mode-${mode}`).check();
  await page.getByTestId('dialog-settings-button-ok').click();
}

/** Whether the View menu offers "AI Assistant" (closed again afterwards). */
async function viewMenuOffersAssistant(page: Page): Promise<boolean> {
  await page.getByTestId('menu-view').click();
  await expect(page.getByTestId('menu-view-popup')).toBeVisible();
  // The entry follows the Document Tree toggle; the popup is complete once that one is there.
  await expect(page.getByTestId('menu-view-tree')).toBeVisible();
  const offered = (await page.getByTestId('menu-view-toggle').count()) > 0;
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu-view-popup')).toBeHidden();
  return offered;
}

/**
 * Right-click on a Body paragraph (the editor itself when no text is named): whether the menu
 * has "Ask AI..." (closed afterwards).
 */
async function bodyMenuOffersAsk(page: Page, text?: string): Promise<boolean> {
  const editor = page.getByTestId('body-editor');
  const target = text === undefined ? editor : editor.locator('p.fb-p', { hasText: text }).first();
  // The caret first: the menu closes on any scroll, and a paragraph far down the book is
  // scrolled into view by the selection change the click makes.
  await target.click();
  await page.waitForTimeout(100);
  await target.click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  const offered = (await page.getByTestId('context-menu-ai.ask').count()) > 0;
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  return offered;
}

/** Right-click in the Source view: whether its menu has an AI entry (closed afterwards). */
async function sourceMenuOffersAsk(page: Page): Promise<boolean> {
  await page.getByTestId('view-source').click();
  await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('source-editor').click({ button: 'right' });
  const menu = page.getByTestId('source-context-menu');
  await expect(menu).toBeVisible();
  const offered = (await page.getByTestId('source-context-menu-ai.ask').count()) > 0;
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.getByTestId('view-body').click();
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
  return offered;
}

/** The Ask hotkey changes nothing: no popup, no request (a short wait lets a wrong one show). */
async function expectAskHotkeyInert(page: Page): Promise<void> {
  await page.getByTestId('body-editor').click();
  await page.keyboard.press(`${MOD}+k`);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('dialog-ai-ask')).toHaveCount(0);
  await expect(page.getByTestId('script-run-banner')).toHaveCount(0);
}

/**
 * The inert panel of FR-096: the pane marked inert, every control disabled, no conversation,
 * the centred notice with the link to the settings page; nothing of the live panel.
 */
async function expectInertPanel(page: Page): Promise<void> {
  const panel = page.getByTestId('ai-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-ai-inert', 'true');
  await expect(page.getByTestId('ai-splitter')).toBeVisible();
  const inert = page.getByTestId('ai-panel-disabled');
  await expect(inert).toBeVisible();
  await expect(inert).toHaveAttribute('data-inert', 'true');
  for (const id of ['ai-input', 'ai-send', 'ai-clear', 'ai-undo']) {
    await expect(inert.getByTestId(id), id).toBeDisabled();
  }
  await expect(page.getByTestId('ai-panel-disabled-notice')).toHaveText(
    (await pageText(page, 'ai.panel.disabledNotice')) +
      (await pageText(page, 'ai.panel.disabledSettingsLink')),
  );
  await expect(page.getByTestId('ai-panel-disabled-settings')).toBeEnabled();
  await expect(page.getByTestId('ai-panel-content')).toHaveCount(0);
  await expect(page.getByTestId('ai-messages')).toHaveCount(0);
  await expect(page.getByTestId('ai-settings-link')).toHaveCount(0);
  expect(await panelVisible(page)).toBe(true);
  expect(await assistantOn(page)).toBe(false);
}

/**
 * The toggle hotkey hides the inert panel and shows it again - nothing becomes live, no
 * request, no chunk (the caller checks the assets); the panel is left visible.
 */
async function expectToggleHotkeyShowsAndHidesTheInertPanel(page: Page): Promise<void> {
  await page.getByTestId('body-editor').click();
  await page.keyboard.press(`${MOD}+Shift+A`);
  await expect(page.getByTestId('ai-panel')).toHaveCount(0);
  await expect(page.getByTestId('ai-splitter')).toHaveCount(0);
  expect(await panelVisible(page)).toBe(false);
  expect(await aiCommands(page)).toEqual(DISABLED_COMMANDS);
  await page.keyboard.press(`${MOD}+Shift+A`);
  await expectInertPanel(page);
}

/**
 * Everything of scenario 1 as amended: the View entry, the toolbar button and the toggle
 * hotkey (showing and hiding the inert panel), the inert panel itself, and the settings page -
 * nothing of the live assistant (FR-096).
 */
async function expectDisabledState(page: Page, paragraph: string): Promise<void> {
  await expect(page.getByTestId('toolbar-ai.toggle')).toBeVisible();
  expect(await viewMenuOffersAssistant(page)).toBe(true);
  await expectInertPanel(page);
  await expectToggleHotkeyShowsAndHidesTheInertPanel(page);
  await expectAskHotkeyInert(page);
  expect(await bodyMenuOffersAsk(page, paragraph)).toBe(false);
  expect(await sourceMenuOffersAsk(page)).toBe(false);
  expect(await aiStatus(page)).toBe('disabled');
  expect(await aiCommands(page)).toEqual(DISABLED_COMMANDS);
  expect(await assistantOn(page)).toBe(false);
  // The settings page still exists, with Disabled chosen; the notice's link opens it there.
  await page.getByTestId('ai-panel-disabled-settings').click();
  await expect(page.getByTestId('dialog-settings')).toBeVisible();
  await expect(page.getByTestId('settings-page-ai')).toBeVisible();
  await expect(page.getByTestId('settings-ai-mode-disabled')).toBeChecked();
  await page.getByTestId('dialog-settings-button-cancel').click();
  await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
}

/**
 * The editing session of SC-013: open `modern-utf8.fb2`, type in a paragraph, Save As (the
 * dialog queued), a script on a selection, the spelling check, Source and back, Settings
 * opened and closed. Returns the saved file's path.
 */
async function editingSession(page: Page, core: CoreHandle, dir: string): Promise<string> {
  await openBook(page, core, BOOK);
  const editor = page.getByTestId('body-editor');

  // Type in a paragraph.
  const paragraph = editor.locator('p.fb-p', { hasText: 'Последний абзац главы.' }).first();
  await paragraph.click();
  await page.keyboard.press(LINE_END);
  await page.keyboard.type(' Добавленные слова.');
  await expect(paragraph).toContainText('Добавленные слова.');
  await expect.poll(() => isModified(page)).toBe(true);

  // File > Save As with the native dialog queued (UTF-8, so no encoding window follows).
  const saved = path.join(dir, `session-${crypto.randomUUID().slice(0, 8)}.fb2`);
  await core.enqueueDialog('dialog.saveFile', { path: saved, encoding: 'utf-8' });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-saveAs').click();
  await waitForBook(page, saved);
  await expect.poll(() => isModified(page)).toBe(false);

  // A bundled script on a selection: Scripts > Small editing tasks > Remove spaces.
  await paragraph.click();
  await page.keyboard.press(LINE_START);
  await page.keyboard.press(SELECT_TO_LINE_END);
  await page.getByTestId('menu-scripts').click();
  const group = page.getByTestId('menu-scripts-18_editing');
  await expect(group).toBeVisible();
  await group.hover();
  await page.getByTestId('menu-scripts-18_editing-18/remove-spaces').click();
  await expect
    .poll(() => page.evaluate<string>('window.__mfbeTest.scripts.state()?.status ?? "none"'))
    .toBe('done');
  await expect(page.getByTestId('script-run-banner')).toHaveCount(0);
  // The paragraph's text changed: found by its new text.
  await expect(
    editor.locator('p.fb-p', { hasText: 'Последнийабзацглавы.Добавленныеслова.' }),
  ).toHaveCount(1);

  // The spelling check (Tools > Spelling, the flow of us6-spelling): the first stop or the
  // completion message, then closed.
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-spellcheck').click();
  const spelling = page.getByTestId('dialog-spelling');
  await expect(spelling).toBeVisible();
  const complete = page.getByTestId('spelling-complete');
  await expect(
    spelling.getByTestId('spelling-not-in-dictionary').or(complete).first(),
  ).toBeVisible();
  if ((await complete.count()) > 0) {
    await complete.getByTestId('spelling-complete-button-ok').click();
  } else {
    await spelling.getByTestId('spelling-ignore').click();
    await spelling.getByTestId('dialog-spelling-button-close').click();
  }
  await expect(spelling).toHaveCount(0);
  await expect(complete).toHaveCount(0);

  // A table step (feature 006, US11 sc.5): the book holds tables - a block of two cells of
  // table t1 (a click and a Shift+click), Edit → Table structure → Insert row below on it (two
  // rows), Undo, Redo and Undo again (SC-007, U22); a right-click in a cell shows the table
  // section and no Ask entry. Nothing of the assistant's table additions loads.
  const t1 = editor.locator('[data-testid="body-table"][data-id="t1"]');
  const cellOne = t1.locator('td.fb-td').filter({ hasText: /^1$/ });
  const cellThree = t1.locator('td.fb-td').filter({ hasText: /^3$/ });
  await cellOne.scrollIntoViewIfNeeded();
  await cellOne.click();
  await cellThree.click({ modifiers: ['Shift'] });
  await expect(t1.locator('.mfbe-cell-selected')).toHaveCount(2);
  const tableBefore = await documentXml(page);
  await page.getByTestId('menu-edit').click();
  await page.getByTestId('menu-edit-tableStructure').click();
  const insertBelow = page.getByTestId('menu-edit-tableStructure-insertRowBelow');
  await expect(insertBelow).not.toHaveAttribute('aria-disabled');
  await insertBelow.click();
  await expect(t1.locator('tr')).toHaveCount(5);
  const tableAfter = await documentXml(page);
  for (const [item, expected] of [
    ['undo', tableBefore],
    ['redo', tableAfter],
    ['undo', tableBefore],
  ] as const) {
    await page.getByTestId('menu-edit').click();
    await page.getByTestId(`menu-edit-${item}`).click();
    await expect.poll(() => documentXml(page)).toBe(expected);
  }
  await expect(t1.locator('tr')).toHaveCount(3);
  await cellOne.click();
  await page.waitForTimeout(100);
  await cellOne.click({ button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await expect(page.getByTestId('context-menu-tableStructure')).toBeVisible();
  await expect(page.getByTestId('context-menu-ai.ask')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('context-menu')).toHaveCount(0);

  // Source and back.
  await page.getByTestId('view-source').click();
  await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('source-editor')).toBeVisible();
  // (The Source editor renders its viewport only; the edit is checked on the document.)
  expect(await documentXml(page)).toContain('Добавленныеслова');
  await page.getByTestId('view-body').click();
  await expect(editor).toHaveAttribute('contenteditable', 'true');

  // Settings opened and closed (the AI page included).
  await openAiSettings(page);
  await page.getByTestId('dialog-settings-button-cancel').click();
  await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
  return saved;
}

/* ------------------------------------------------------------------------ */
/* The journeys on the worker's core                                        */
/* ------------------------------------------------------------------------ */

test.describe('US9 (005) - switch the assistant off completely', () => {
  let outside: string[] = [];
  let dir = '';

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us9-ai-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core, standin, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    outside = await recordOutside(context);
    await standin.reset();
    await core.resetAiRequests();
    await core.setAiResolve([]);
    // The AI settings back to their defaults and the panel open, as a first start has it (the
    // visibility is a session key the journeys hide and show).
    await core.rpc('settings.set', { patch: { ai: null, session: { aiPanelVisible: true } } });
    // The free entry reaches the stand-in, never a real service (FR-102).
    writeStandinOverride(core.dataDir!, standin.port);
    await core.rpc('ai.reloadServices');
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    expect(outside).toEqual([]);
    removeStandinOverride(core.dataDir!);
    await core
      .rpc('settings.set', { patch: { ai: null, session: { aiPanelVisible: true } } })
      .catch(() => {});
    await core.rpc('ai.reloadServices').catch(() => {});
  });

  test('1+4. Disabled at OK removes the context entry and the Ask hotkey at once and turns the visible panel inert - the entry, the button and the toggle hotkey stay; Free again makes the panel live without a restart; nothing of the document changed', async ({
    core,
    page,
    standin,
  }) => {
    const errors = recordErrors(page);
    await configureCustomTarget(core, standin);
    await openApp(page, core);
    await openBook(page, core, SELECTION_BOOK);
    const xmlBefore = await documentXml(page);
    const paragraph = 'Поезд пришёл';

    // Restored open and live (FR-040 as amended): the panel with its content, the entry, the
    // button, the three live commands, the context entry; nothing sent, locked or changed.
    await expect(page.getByTestId('ai-panel')).toBeVisible();
    await expect(page.getByTestId('ai-panel-content')).toBeVisible();
    await expect(page.getByTestId('ai-empty')).toBeVisible();
    await expect(page.getByTestId('toolbar-ai.toggle')).toBeVisible();
    expect(await viewMenuOffersAssistant(page)).toBe(true);
    expect(await aiStatus(page)).toBe('registered');
    expect(await assistantOn(page)).toBe(true);
    expect(await aiCommands(page)).toEqual(ON_COMMANDS);
    expect(await bodyMenuOffersAsk(page, paragraph)).toBe(true);
    expect(await isModified(page)).toBe(false);

    // Scenario 1: Disabled at OK - idle, so no question - and the panel turns inert at once,
    // the live traces gone, the entry and the button kept.
    await chooseModeAndOk(page, 'disabled');
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    await expect(page.getByTestId('dialog-ai-stop-confirm')).toHaveCount(0);
    await expectDisabledState(page, paragraph);
    expect(await documentXml(page)).toBe(xmlBefore);
    expect(await isModified(page)).toBe(false);
    await expect(page.getByTestId('toolbar-edit.undo')).toBeDisabled(); // FR-095: no undo step

    // Scenario 4: Free at OK - the visible panel is live again at once (no restart), the
    // entry and the button as before, nothing else changed.
    await chooseModeAndOk(page, 'free');
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    await expect(page.getByTestId('toolbar-ai.toggle')).toBeVisible();
    expect(await viewMenuOffersAssistant(page)).toBe(true);
    await expect(page.getByTestId('ai-panel')).toBeVisible();
    await expect(page.getByTestId('ai-panel')).not.toHaveAttribute('data-ai-inert', 'true');
    await expect(page.getByTestId('ai-panel-content')).toBeVisible();
    await expect(page.getByTestId('ai-empty')).toBeVisible();
    await expect(page.getByTestId('ai-panel-disabled')).toHaveCount(0);
    expect(await assistantOn(page)).toBe(true);
    expect(await aiStatus(page)).toBe('registered');
    expect(await aiCommands(page)).toEqual(ON_COMMANDS);
    expect(await bodyMenuOffersAsk(page, paragraph)).toBe(true);
    expect(await documentXml(page)).toBe(xmlBefore);
    expect(await isModified(page)).toBe(false);
    await expect(page.getByTestId('toolbar-edit.undo')).toBeDisabled();
    // The toggle hotkey hides the live panel (the assistant off, FR-092) and shows it again.
    await page.getByTestId('body-editor').click();
    await page.keyboard.press(`${MOD}+Shift+A`);
    await expect(page.getByTestId('ai-panel')).toHaveCount(0);
    expect(await assistantOn(page)).toBe(false);
    expect(await aiCommands(page)).toEqual(OFF_COMMANDS);
    expect(await bodyMenuOffersAsk(page, paragraph)).toBe(false); // off: no context entry
    await page.keyboard.press(`${MOD}+Shift+A`);
    await expect(page.getByTestId('ai-panel')).toBeVisible();
    await expect(page.getByTestId('ai-empty')).toBeVisible();
    expect(await assistantOn(page)).toBe(true);

    // Nothing was ever sent, nothing went wrong.
    expect(await standin.requests()).toEqual([]);
    expect(await core.aiRequests()).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('3. Disabled at OK while a request runs asks first: No keeps the dialog and the request, Yes cancels, turns off and disables', async ({
    core,
    page,
    standin,
  }) => {
    await configureCustomTarget(core, standin);
    await openApp(page, core);
    await openBook(page, core, SELECTION_BOOK);
    const xmlBefore = await documentXml(page);
    // The panel restored open and live (FR-040 as amended).
    await expect(page.getByTestId('ai-panel')).toBeVisible();
    await expect(page.getByTestId('ai-panel-content')).toBeVisible();

    // A held exchange: the request runs while the settings dialog is used.
    await standin.scenario({ text: 'late', delayMs: 20_000 });
    await page.getByTestId('ai-input').fill('Rename the chapters');
    await page.getByTestId('ai-input').press('Enter');
    await expect(page.getByTestId('ai-stop')).toBeVisible();
    await expect(page.getByTestId('script-run-banner')).toBeVisible();

    // While the request holds the run lock the Tools menu's Settings entry is blocked like
    // every other command (feature 003 FR-011, feature 005 FR-022); the panel's own settings
    // link is the way to the page then.
    await page.getByTestId('menu-tools').click();
    await expect(page.getByTestId('menu-tools-settings')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await page.getByTestId('ai-settings-link').click();
    await expect(page.getByTestId('dialog-settings')).toBeVisible();
    await expect(page.getByTestId('settings-page-ai')).toBeVisible();
    await expect(page.getByTestId('ai-stop')).toBeAttached(); // still running
    // Disabled at OK → the question first; No: the dialog stays open, nothing applied, the
    // request goes on.
    await page.getByTestId('settings-ai-mode-disabled').check();
    await page.getByTestId('dialog-settings-button-ok').click();
    const confirm = page.getByTestId('dialog-ai-stop-confirm');
    await expect(confirm).toBeVisible();
    await page.getByTestId('dialog-ai-stop-confirm-button-no').click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByTestId('dialog-settings')).toBeVisible();
    await expect(page.getByTestId('settings-ai-mode-disabled')).toBeChecked();
    await expect(page.getByTestId('ai-stop')).toBeAttached();
    await expect(page.getByTestId('script-run-banner')).toBeAttached();
    expect(await aiStatus(page)).toBe('registered');
    expect(await assistantOn(page)).toBe(true);
    expect((await core.rpc<{ ai: { mode: string } }>('settings.get')).ai.mode).toBe('custom');

    // OK again, Yes: cancelled, the panel inert, the assistant off and disabled, the XML as
    // it was, the dialog closed.
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(confirm).toBeVisible();
    await page.getByTestId('dialog-ai-stop-confirm-button-yes').click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    await expect(page.getByTestId('ai-panel')).toHaveAttribute('data-ai-inert', 'true');
    await expect(page.getByTestId('ai-panel-content')).toHaveCount(0);
    await expect(page.getByTestId('script-run-banner')).toHaveCount(0);
    await expect.poll(() => lastRequestState(page)).toBe('cancelled');
    await expect
      .poll(async () => (await core.aiRequests()).map((r: AiRequestRecord) => r.outcome))
      .toEqual(['cancelled']);
    expect((await core.rpc<{ ai: { mode: string } }>('settings.get')).ai.mode).toBe('disabled');
    expect(await documentXml(page)).toBe(xmlBefore);
    expect(await isModified(page)).toBe(false);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    await expectDisabledState(page, 'Поезд пришёл');
    // The one request the journey made is the cancelled one; nothing after the turn-off.
    await page.waitForTimeout(1000);
    expect(await standin.requests()).toHaveLength(1);
    expect(await core.aiRequests()).toHaveLength(1);
  });

  test('2. silence (SC-013) with the assistant off (the panel hidden): a whole editing session makes no request and loads no chunk; the View entry and the button are the only traces', async ({
    core,
    page,
    standin,
  }) => {
    // Off = a service chosen and the panel hidden, as a session that closed it restores it.
    await core.rpc('settings.set', {
      patch: {
        ai: { mode: 'free', freeServiceId: 'ovhcloud' },
        session: { aiPanelVisible: false },
      },
    });
    await watchForFeatureElements(page);
    const assets = recordAssets(page);
    const errors = recordErrors(page);
    await openApp(page, core);
    await editingSession(page, core, dir);

    // Off: exactly the View entry and the button; no panel, popup or context entry.
    await expect(page.getByTestId('toolbar-ai.toggle')).toBeVisible();
    expect(await viewMenuOffersAssistant(page)).toBe(true);
    expect(await bodyMenuOffersAsk(page, 'Последний')).toBe(false);
    expect(await sourceMenuOffersAsk(page)).toBe(false);
    await expect(page.getByTestId('ai-panel')).toHaveCount(0);
    await expect(page.getByTestId('dialog-ai-ask')).toHaveCount(0);
    expect(await assistantOn(page)).toBe(false);
    expect(await panelVisible(page)).toBe(false);
    expect(await aiStatus(page)).toBe('registered');
    expect(await aiCommands(page)).toEqual(OFF_COMMANDS);

    // Silence: no request of the feature, nothing of its chunk.
    expect(await standin.requests()).toEqual([]);
    expect(await core.aiRequests()).toEqual([]);
    expectMainBundleOnly(assets);
    expect(errors).toEqual([]);
    // The watcher of the disabled run below does see what appears: the button and the entry
    // were the only elements of the feature on this page.
    expect(new Set(await featureElementsSeen(page))).toEqual(
      new Set(['toolbar-ai.toggle', 'menu-view-toggle']),
    );
  });

  test('2. silence (SC-013) with Disabled saved and the panel open: the same session with the inert panel, nothing of the live assistant, no chunk', async ({
    core,
    page,
    standin,
  }) => {
    await core.rpc('settings.set', { patch: { ai: { mode: 'disabled' } } });
    await watchForFeatureElements(page);
    const assets = recordAssets(page);
    const errors = recordErrors(page);
    await openApp(page, core);
    // Honoured before anything of the feature renders (FR-098): the live toggle and the stub
    // of ai.ask from the first moment the hooks exist, the inert panel from the first paint.
    await expect.poll(() => aiHooksInstalled(page)).toBe(true);
    await expect.poll(() => aiStatus(page)).toBe('disabled');
    expect(await aiCommands(page)).toEqual(DISABLED_COMMANDS);
    await expectInertPanel(page);
    await editingSession(page, core, dir);

    await expectDisabledState(page, 'Последний');
    expect(await page.evaluate<boolean>('window.__mfbeTest.ai.state().catalogue')).toBe(false);
    expect(await standin.requests()).toEqual([]);
    expect(await core.aiRequests()).toEqual([]);
    expectMainBundleOnly(assets);
    expect(await liveElementsSeen(page)).toEqual([]);
    expect(new Set(await featureElementsSeen(page))).toEqual(new Set(SHELL_TEST_IDS));
    expect(errors).toEqual([]);
  });

  test('the settings page with Disabled saved: no Test connection with the Disabled radio; a service chosen on the page tests the selected model once; Cancel leaves settings.json byte-identical', async ({
    core,
    page,
    standin,
  }) => {
    await core.rpc('settings.set', { patch: { ai: { mode: 'disabled' } } });
    await openApp(page, core);
    await expect.poll(() => aiStatus(page)).toBe('disabled');
    const settingsFile = path.join(core.dataDir!, 'settings.json');
    await core.rpc('settings.get'); // the write of the seed is through
    const bytesBefore = readFileSync(settingsFile);

    await openAiSettings(page);
    await expect(page.getByTestId('settings-ai-mode-disabled')).toBeChecked();
    await expect(page.getByTestId('settings-ai-test')).toHaveCount(0);
    await expect(page.getByTestId('settings-ai-fetch-models')).toHaveCount(0);

    // The page's choice is a service again: Test connection appears and goes to the selected
    // model - the free entry's (redirected to the stand-in) - exactly once.
    await page.getByTestId('settings-ai-mode-free').check();
    await expect(page.getByTestId('settings-ai-service')).toHaveValue('ovhcloud');
    const testButton = page.getByTestId('settings-ai-test');
    await expect(testButton).toBeVisible();
    await standin.scenario({ text: 'OK' });
    await testButton.click();
    const status = page.getByTestId('settings-ai-status');
    await expect(status).toHaveAttribute('data-status', 'verified', { timeout: 15_000 });
    const requests = await standin.requests();
    expect(requests).toHaveLength(1);
    expect((requests[0]!.body as { model: string }).model).toBe('standin-chat');
    const recorded = await core.aiRequests();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      method: 'ai.test',
      targetKind: 'free',
      serviceId: 'ovhcloud',
      outcome: 'ok',
    });

    // My own service and key with the stand-in's address: the test targets that model (the
    // custom target's test arrives with US8 - until then the button is disabled for it and
    // this part is left out, noted in the report).
    await page.getByTestId('settings-ai-mode-custom').check();
    await page.getByTestId('settings-ai-address').fill(`${standin.url}/v1`);
    await page.getByTestId('settings-ai-model').fill('standin-mini');
    let expectedRequests = 1;
    if (await testButton.isEnabled()) {
      await standin.scenario({ text: 'OK' });
      await testButton.click();
      await expect(status).toHaveAttribute('data-status', 'verified', { timeout: 15_000 });
      expectedRequests = 2;
      const custom = await standin.requests();
      expect(custom).toHaveLength(2);
      expect((custom[1]!.body as { model: string }).model).toBe('standin-mini');
      expect((await core.aiRequests())[1]).toMatchObject({
        method: 'ai.test',
        targetKind: 'custom',
        outcome: 'ok',
      });
    } else {
      test.info().annotations.push({
        type: 'note',
        description: 'Test connection for the custom target is US8 (T086): not exercised yet',
      });
    }
    // Back to Disabled on the page: the buttons go.
    await page.getByTestId('settings-ai-mode-disabled').check();
    await expect(page.getByTestId('settings-ai-test')).toHaveCount(0);

    // Cancel: nothing saved, nothing more sent, the assistant still disabled.
    await page.getByTestId('dialog-settings-button-cancel').click();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(readFileSync(settingsFile).equals(bytesBefore)).toBe(true);
    expect(await standin.requests()).toHaveLength(expectedRequests);
    expect(await core.aiRequests()).toHaveLength(expectedRequests);
    expect(await aiStatus(page)).toBe('disabled');
    expect(await aiCommands(page)).toEqual(DISABLED_COMMANDS);
    await expect(page.getByTestId('toolbar-ai.toggle')).toBeVisible();
    await expect(page.getByTestId('ai-panel')).toHaveAttribute('data-ai-inert', 'true');
  });
});

/* ------------------------------------------------------------------------ */
/* Restart and the portable move: cores of their own                         */
/* ------------------------------------------------------------------------ */

test.describe('US9 (005) - Disabled survives a restart and a portable move', () => {
  let dir = '';

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us9-restart-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  /** A core on `dataDir` and a watched page on it; the caller stops both. */
  async function coreAndPage(
    browser: Browser,
    dataDir: string,
    uiLang: UiLang | undefined,
  ): Promise<{
    page: Page;
    rpc: NodeRpcClient;
    assets: string[];
    errors: string[];
    stop: () => Promise<void>;
  }> {
    const started = await startCoreWith(process.env.MFBE_CORE_BIN!, dataDir, []);
    const context = await browser.newContext();
    const page = await context.newPage();
    await watchForFeatureElements(page);
    const assets = recordAssets(page);
    const errors = recordErrors(page);
    await page.goto(withUiLang(started.url, uiLang));
    await page.getByTestId('app-root').waitFor();
    const parsed = new URL(started.url);
    const rpc = new NodeRpcClient(
      `ws://127.0.0.1:${parsed.port}/rpc?token=${parsed.searchParams.get('token') ?? ''}`,
    );
    return {
      page,
      rpc,
      assets,
      errors,
      stop: async () => {
        rpc.close();
        await context.close();
        await started.stop();
      },
    };
  }

  /**
   * Scenario 1 on a freshly started core: disabled from the first paint, no flash of the live
   * assistant; the panel restored open and inert, the entry and the button present.
   */
  async function expectDisabledFromTheFirstPaint(
    page: Page,
    assets: string[],
    errors: string[],
  ): Promise<void> {
    await expect(page.getByTestId('toolbar-commands')).toBeVisible();
    await expect.poll(() => aiHooksInstalled(page)).toBe(true);
    await expect.poll(() => aiStatus(page)).toBe('disabled');
    expect(await aiCommands(page)).toEqual(DISABLED_COMMANDS);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    await expect(page.getByTestId('toolbar-ai.toggle')).toBeVisible();
    expect(await viewMenuOffersAssistant(page)).toBe(true);
    await expectInertPanel(page);
    await expectToggleHotkeyShowsAndHidesTheInertPanel(page);
    await expectAskHotkeyInert(page);
    expect(await bodyMenuOffersAsk(page)).toBe(false); // the start-up document
    expect(await aiCommands(page)).toEqual(DISABLED_COMMANDS);
    expect(await liveElementsSeen(page)).toEqual([]);
    expectMainBundleOnly(assets);
    expect(errors).toEqual([]);
  }

  test('5. a second core with Disabled saved starts without the assistant from the first paint; a copied data directory too', async ({
    browser,
    uiLang,
  }) => {
    const dataDir = mkdtempSync(path.join(dir, 'data-'));

    // The first core: Disabled chosen on the page and OK → settings.json carries it.
    const first = await coreAndPage(browser, dataDir, uiLang);
    try {
      await expect(first.page.getByTestId('status-message')).toHaveText(
        await pageText(first.page, 'status.ready'),
      );
      await expect(first.page.getByTestId('toolbar-ai.toggle')).toBeVisible();
      // A fresh data directory: Disabled is the stored default (FR-001) and the panel is open
      // and inert. Free at OK makes it live; Disabled at OK again writes the choice.
      await expectInertPanel(first.page);
      await chooseModeAndOk(first.page, 'free');
      await expect(first.page.getByTestId('dialog-settings')).toHaveCount(0);
      await expect(first.page.getByTestId('ai-panel-content')).toBeVisible();
      await chooseModeAndOk(first.page, 'disabled');
      await expect(first.page.getByTestId('dialog-settings')).toHaveCount(0);
      await expect(first.page.getByTestId('toolbar-ai.toggle')).toBeVisible();
      await expectInertPanel(first.page);
      await expect
        .poll(
          () =>
            (JSON.parse(readFileSync(path.join(dataDir, 'settings.json'), 'utf8')) as SettingsFile)
              .ai.mode,
        )
        .toBe('disabled');
    } finally {
      await first.stop();
    }

    // The second core on the same data directory: scenario 1 from the first paint.
    const second = await coreAndPage(browser, dataDir, uiLang);
    try {
      await expectDisabledFromTheFirstPaint(second.page, second.assets, second.errors);
    } finally {
      await second.stop();
    }

    // The portable move, simulated by a copy: a third core on the copy honours it too.
    const copy = path.join(dir, 'moved-data');
    cpSync(dataDir, copy, { recursive: true });
    const third = await coreAndPage(browser, copy, uiLang);
    try {
      await expectDisabledFromTheFirstPaint(third.page, third.assets, third.errors);
      await openAiSettings(third.page);
      await expect(third.page.getByTestId('settings-ai-mode-disabled')).toBeChecked();
      await third.page.getByTestId('dialog-settings-button-cancel').click();
    } finally {
      await third.stop();
    }
  });
});

interface SettingsFile {
  ai: { mode: string };
}
