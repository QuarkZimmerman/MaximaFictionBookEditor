/**
 * Feature 004, User Story 11 - the keyboard layout switches when a document is opened (T078;
 * spec FR-090 to FR-093, SC-011; research R4). The system's layout switch is the recording
 * stand-in `mfbe-core serve --test-hooks` installs (rpc-api.md §5): `test.setKeyboardLayouts`
 * shapes the list the Settings page reads, `test.keyboardLayoutRequests` records every
 * `system.activateKeyboardLayout` the open routes make.
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`);
 * skipped in core-less mode. The scenarios:
 *
 *  1. Settings > Other shows the "Open file" group with "Restore position", the new option off
 *     and the select listing the seeded names with the current one preselected; Russian
 *     chosen, ticked, OK -> the three settings are stored and the reopened dialog shows them
 *     (English and Russian interface);
 *  2. with the option on, exactly one request `{id: "test-ru", activated: true}` per document
 *     opened - File > New, Open (queued dialog), Recent Files, a malformed book (Source view),
 *     the reload of a book changed on disk, the restart after a language change (the `?open=`
 *     reload) - and none when the Settings dialog is closed with OK;
 *  3. a `--open` start (the `app.openPaths` route of the command line, a double-click and a
 *     dropped file) and a `--open` of a missing file (the new document after the failed
 *     start-up open counts, FR-091), each on a core of its own;
 *  4. option off -> the count stays on every route;
 *  5. the chosen layout no longer listed -> "Russian (not installed)" selected in Settings and
 *     one request per open, answered `activated: false`, no error;
 *  6. `supported: false, reason: "wayland"` -> checkbox and select disabled with the note, the
 *     rest of the dialog usable (requester decision D2, 2026-10-20).
 */

import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import {
  expect,
  fixtureBook,
  NodeRpcClient,
  startCoreWith,
  test,
  waitForBook,
  waitForStartupDocument,
  withUiLang,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import { pageText, uiText, type UiLang } from './fixtures/i18n';

/* ------------------------------------------------------------------------ */
/* Stand-in shapes (rpc-api.md §3.11, §5)                                   */
/* ------------------------------------------------------------------------ */

interface LayoutRequest {
  id: string;
  at: string;
  activated: boolean;
}

interface LayoutList {
  supported: boolean;
  reason?: string;
  layouts: { id: string; name: string }[];
  current?: string;
}

interface OtherSettings {
  switchKeyboardLayout: boolean;
  keyboardLayoutId: string;
  keyboardLayoutName: string;
  restorePosition: boolean;
}

type Rpc = <T = unknown>(method: string, params?: unknown) => Promise<T>;

const DEFAULT_SEED: LayoutList = {
  supported: true,
  layouts: [
    { id: 'test-en', name: 'English (United States)' },
    { id: 'test-ru', name: 'Russian' },
  ],
  current: 'test-en',
};

const OPTION_OFF = { switchKeyboardLayout: false, keyboardLayoutId: '', keyboardLayoutName: '' };
const RUSSIAN_ON = {
  switchKeyboardLayout: true,
  keyboardLayoutId: 'test-ru',
  keyboardLayoutName: 'Russian',
};

async function supportsKeyboardLayouts(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('test.keyboardLayoutRequests')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

/** The recorded requests, without their time stamps. */
async function requests(rpc: Rpc): Promise<{ id: string; activated: boolean }[]> {
  const all = await rpc<LayoutRequest[]>('test.keyboardLayoutRequests');
  return all.map(({ id, activated }) => ({ id, activated }));
}

/**
 * Runs `action` and asserts that it made exactly `expected` requests (SC-011: exactly one per
 * document opened, none with the option off). The request is fire-and-forget after the
 * document is shown, so the count is polled up to the expected size and then given a moment
 * to prove it stays there.
 */
async function expectRequests(
  rpc: Rpc,
  page: Page,
  action: () => Promise<void>,
  expected: { id: string; activated: boolean }[],
): Promise<void> {
  const before = (await requests(rpc)).length;
  await action();
  if (expected.length > 0) {
    await expect
      .poll(async () => (await requests(rpc)).length, { message: 'the switch request arrives' })
      .toBeGreaterThanOrEqual(before + expected.length);
  }
  await page.waitForTimeout(400);
  expect((await requests(rpc)).slice(before)).toEqual(expected);
}

async function otherSettings(rpc: Rpc): Promise<OtherSettings> {
  return (await rpc<{ other: OtherSettings }>('settings.get')).other;
}

/* ------------------------------------------------------------------------ */
/* Books                                                                    */
/* ------------------------------------------------------------------------ */

function writeBook(file: string, title: string): string {
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Test</first-name><last-name>Author</last-name></author>
<book-title>${title}</book-title>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>e2e</nickname></author>
<program-used>us11-keyboard-layout.spec</program-used>
<date value="2026-10-21">2026-10-21</date>
<id>us11-${path.basename(file).replace(/\W/g, '-')}</id>
<version>1.0</version>
</document-info>
</description>
<body><section><title><p>${title}</p></title><p>A paragraph of ${title}.</p></section></body>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

/** Rewrites `file` with another title and a later modification time (the watcher's reload). */
function rewrite(file: string, title: string): void {
  writeBook(file, title);
  const later = new Date(Date.now() + 2000);
  utimesSync(file, later, later);
}

/* ------------------------------------------------------------------------ */
/* Page helpers                                                             */
/* ------------------------------------------------------------------------ */

async function openApp(core: CoreHandle, page: Page, lang?: UiLang): Promise<void> {
  if (lang) {
    await page.goto(withUiLang(core.baseURL, lang));
    await page.getByTestId('app-root').waitFor();
  } else {
    await core.openApp(page);
  }
  await waitForStartupDocument(page);
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
}

async function openSettingsOther(page: Page): Promise<void> {
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-settings').click();
  await expect(page.getByTestId('dialog-settings')).toBeVisible();
  await page.getByTestId('settings-tab-other').click();
  await expect(page.getByTestId('settings-page-other')).toBeVisible();
}

async function closeSettings(page: Page, button: 'ok' | 'cancel'): Promise<void> {
  await page.getByTestId(`dialog-settings-button-${button}`).click();
  await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
}

/** The id of the open document (whatever the active view; a Source-only one included). */
async function openDocId(page: Page): Promise<string> {
  const id = await page.evaluate<string | null>(
    'window.__mfbeTest.scripts.document()?.docId ?? null',
  );
  if (!id) throw new Error('no document is open');
  return id;
}

async function fileNew(page: Page): Promise<void> {
  const before = await openDocId(page);
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-new').click();
  await expect.poll(() => openDocId(page)).not.toBe(before);
  await waitForStartupDocument(page);
}

async function openViaDialog(
  enqueue: (method: string, result: unknown) => Promise<void>,
  page: Page,
  file: string,
): Promise<void> {
  await enqueue('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
}

async function openViaRecent(page: Page, file: string): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-recent').hover();
  const popup = page.getByTestId('menu-file-recent-popup');
  await expect(popup).toBeVisible();
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await popup
    .locator('[data-testid^="menu-file-recent-recent"]')
    .filter({ hasText: new RegExp(`\\d+\\. ${escaped}$`) })
    .first()
    .click();
  await waitForBook(page, file);
}

/** A malformed book through File > Open: the parse-error message, then the Source view. */
async function openMalformed(
  enqueue: (method: string, result: unknown) => Promise<void>,
  page: Page,
  file: string,
): Promise<void> {
  await enqueue('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  const parseError = page.getByTestId('dialog-parse-error');
  await expect(parseError).toBeVisible();
  await parseError.getByTestId('dialog-parse-error-button-ok').click();
  await waitForBook(page, file);
  await expect(page.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');
}

/** Rewrites the open book on disk and answers the reload prompt with Yes. */
async function reloadChangedOnDisk(page: Page, file: string, title: string): Promise<void> {
  await page.waitForTimeout(1100); // a distinct mtime second
  rewrite(file, title);
  const prompt = page.getByTestId('dialog-file-changed');
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await prompt.getByTestId('dialog-file-changed-button-yes').click();
  await expect(prompt).toBeHidden();
  await expect(page.getByTestId('body-editor')).toContainText(`A paragraph of ${title}.`, {
    timeout: 15_000,
  });
}

/* ------------------------------------------------------------------------ */
/* A core of a test's own (the --open routes)                               */
/* ------------------------------------------------------------------------ */

interface OwnCore {
  url: string;
  dataDir: string;
  rpc: NodeRpcClient;
  restart(extraArgs?: string[]): Promise<void>;
  stop(): Promise<void>;
}

async function ownCore(): Promise<OwnCore> {
  const binary = process.env.MFBE_CORE_BIN!;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mfbe-us11-layout-'));
  const connect = async (extraArgs: string[]) => {
    const started = await startCoreWith(binary, dataDir, extraArgs);
    const url = new URL(started.url);
    const rpc = new NodeRpcClient(
      `ws://127.0.0.1:${url.port}/rpc?token=${url.searchParams.get('token') ?? ''}`,
    );
    return { ...started, rpc };
  };
  let current = await connect([]);
  const own: OwnCore = {
    url: current.url,
    dataDir,
    rpc: current.rpc,
    async restart(extraArgs = []) {
      current.rpc.close();
      await current.stop();
      current = await connect(extraArgs);
      own.url = current.url;
      own.rpc = current.rpc;
    },
    async stop() {
      current.rpc.close();
      await current.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return own;
}

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('US11 (004) - the keyboard layout switches when a document is opened', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us11-keyboard-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(
      !(await supportsKeyboardLayouts(core)),
      'the core has no recording keyboard layout stand-in',
    );
    await core.rpc('test.setKeyboardLayouts', DEFAULT_SEED);
    await core.rpc('settings.set', { patch: { other: OPTION_OFF, view: { uiLanguage: 'en' } } });
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    await core.rpc('test.setKeyboardLayouts', DEFAULT_SEED).catch(() => {});
    await core
      .rpc('settings.set', { patch: { other: OPTION_OFF, view: { uiLanguage: 'en' } } })
      .catch(() => {});
  });

  test('1. Settings > Other: the "Open file" group, the option off, the system list; the choice round-trips (en, ru)', async ({
    core,
    page,
  }) => {
    for (const lang of ['en', 'ru'] as const) {
      await core.rpc('settings.set', { patch: { other: OPTION_OFF } });
      await openApp(core, page, lang);
      await openSettingsOther(page);

      // The group keeps its 0.0.3 name and "Restore position" (FR-090), and gains the option
      // and the list of the system's layouts under the names the system gives them.
      const group = page.getByTestId('settings-other-open-file');
      await expect(group.locator('legend')).toHaveText(
        uiText(lang, 'dialog.settings.other.openFile'),
      );
      await expect(group.getByTestId('settings-other-restore-position')).toBeVisible();
      await expect(group).toContainText(uiText(lang, 'dialog.settings.other.restorePosition'));
      await expect(group).toContainText(uiText(lang, 'dialog.settings.other.switchKeyboardLayout'));
      await expect(group).toContainText(uiText(lang, 'dialog.settings.other.keyboardLayout'));
      const checkbox = group.getByTestId('settings-other-switch-layout');
      const select = group.getByTestId('settings-other-layout');
      await expect(checkbox).not.toBeChecked();
      await expect(checkbox).toBeEnabled();
      await expect(select).toBeEnabled();
      await expect(select.locator('option')).toHaveText(['English (United States)', 'Russian']);
      expect(
        await select
          .locator('option')
          .evaluateAll((options) => options.map((option) => option.getAttribute('value'))),
      ).toEqual(['test-en', 'test-ru']);
      await expect(select).toHaveValue('test-en'); // the current layout preselected
      await expect(page.getByTestId('settings-other-layout-note')).toHaveCount(0);

      // Russian chosen, the option ticked, OK: the three settings travel together.
      await select.selectOption('test-ru');
      await checkbox.check();
      await closeSettings(page, 'ok');
      expect(await otherSettings(core.rpc)).toMatchObject(RUSSIAN_ON);

      // The reopened dialog shows the stored choice.
      await openSettingsOther(page);
      await expect(page.getByTestId('settings-other-switch-layout')).toBeChecked();
      await expect(page.getByTestId('settings-other-layout')).toHaveValue('test-ru');
      await closeSettings(page, 'cancel');
    }
  });

  test('2. with the option on, exactly one request per document opened by every route; none when Settings closes with OK', async ({
    core,
    page,
  }) => {
    const first = writeBook(path.join(dir, 'route-one.fb2'), 'Route one');
    const second = writeBook(path.join(dir, 'route-two.fb2'), 'Route two');
    const malformed = path.join(dir, 'malformed.fb2');
    writeFileSync(malformed, readFileSync(fixtureBook('malformed.fb2')));
    const rpc = core.rpc;
    const one = [{ id: 'test-ru', activated: true }];

    await openApp(core, page);
    // Switched on through the dialog: turning the option on switches nothing until the next
    // document opens (FR-091) - closing with OK makes no request.
    await expectRequests(
      rpc,
      page,
      async () => {
        await openSettingsOther(page);
        await page.getByTestId('settings-other-layout').selectOption('test-ru');
        await page.getByTestId('settings-other-switch-layout').check();
        await closeSettings(page, 'ok');
      },
      [],
    );
    expect(await otherSettings(rpc)).toMatchObject(RUSSIAN_ON);

    // File > New.
    await expectRequests(rpc, page, () => fileNew(page), one);
    // Open through the native dialog.
    await expectRequests(rpc, page, () => openViaDialog(core.enqueueDialog, page, first), one);
    await expectRequests(rpc, page, () => openViaDialog(core.enqueueDialog, page, second), one);
    // Recent Files.
    await expectRequests(rpc, page, () => openViaRecent(page, first), one);
    // A malformed book opens in the Source view only and counts as a document opened.
    await expectRequests(rpc, page, () => openMalformed(core.enqueueDialog, page, malformed), one);
    // The reload of a book that changed on disk.
    await expectRequests(rpc, page, () => openViaDialog(core.enqueueDialog, page, second), one);
    await expectRequests(
      rpc,
      page,
      () => reloadChangedOnDisk(page, second, 'Route two rewritten'),
      one,
    );
    // The open document is shown again after the reload: exactly one request for it.
    await waitForBook(page, second);

    // The restart after a language change: in browser mode the page reloads itself with
    // `?open=<book>` (as us8-restore-position.spec.ts drives it); the reopened book is one
    // document opened, the restart prompt and the Settings OK are none.
    const restartsBefore = (await rpc<unknown[]>('test.restartRequests')).length;
    await expectRequests(
      rpc,
      page,
      async () => {
        await page.getByTestId('menu-tools').click();
        await page.getByTestId('menu-tools-settings').click();
        await page.getByTestId('settings-view-language').selectOption('ru');
        await page.getByTestId('dialog-settings-button-ok').click();
        const prompt = page.getByTestId('dialog-restart-prompt');
        await expect(prompt).toBeVisible();
        await prompt.getByTestId('dialog-restart-prompt-button-yes').click();
        await expect
          .poll(() => rpc<unknown[]>('test.restartRequests'))
          .toHaveLength(restartsBefore + 1);
        await expect.poll(() => new URL(page.url()).searchParams.get('open')).toBe(second);
        await page.getByTestId('app-root').waitFor();
        await waitForBook(page, second);
        await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
      },
      one,
    );
  });

  test('3. a --open start and a --open of a missing file each make one request (the command-line, double-click and dropped-file route)', async ({
    browser,
  }) => {
    const binary = process.env.MFBE_CORE_BIN!;
    test.skip(
      !/mfbe-core/.test(path.basename(binary)),
      'needs the real mfbe-core binary (a core started with --open)',
    );
    const book = writeBook(path.join(dir, 'from-command-line.fb2'), 'From the command line');
    const missing = path.join(dir, 'does-not-exist.fb2');
    const own = await ownCore();
    const context = await browser.newContext();
    // The core hands the start-up file to its first client, so the page must connect before
    // the test's own RPC client does: the record is read only once the page has the book (a
    // fresh process holds no earlier request).
    const settled = async (page: Page, rpc: Rpc) => {
      await expect
        .poll(async () => (await requests(rpc)).length, { message: 'the switch request arrives' })
        .toBe(1);
      await page.waitForTimeout(400);
      expect(await requests(rpc)).toEqual([{ id: 'test-ru', activated: true }]);
    };
    try {
      // The option is set in the profile before the start that opens the file.
      await own.rpc.call('settings.set', { patch: { other: RUSSIAN_ON } });
      await own.restart(['--open', book]);
      const page = await context.newPage();
      await page.goto(own.url);
      await page.getByTestId('app-root').waitFor();
      await waitForBook(page, book);
      await settled(page, (method, params) => own.rpc.call(method, params));
      await page.close();

      // A file that does not exist: the open fails with a message and the new document is
      // shown instead (002 FR-003) - that document counts (FR-091); the failed open does not.
      await own.restart(['--open', missing]);
      const second = await context.newPage();
      await second.goto(own.url);
      await second.getByTestId('app-root').waitFor();
      const failed = second.getByTestId('dialog-open-failed');
      await expect(failed).toBeVisible();
      await failed.getByTestId('dialog-open-failed-button-ok').click();
      await waitForStartupDocument(second);
      await settled(second, (method, params) => own.rpc.call(method, params));
    } finally {
      await context.close();
      await own.stop();
    }
  });

  test('4. with the option off nothing is requested on any route', async ({ core, page }) => {
    const book = writeBook(path.join(dir, 'option-off.fb2'), 'Option off');
    const malformed = path.join(dir, 'option-off-malformed.fb2');
    writeFileSync(malformed, readFileSync(fixtureBook('malformed.fb2')));
    // A layout is chosen but the option is off: the id alone never switches.
    await core.rpc('settings.set', {
      patch: {
        other: { ...OPTION_OFF, keyboardLayoutId: 'test-ru', keyboardLayoutName: 'Russian' },
      },
    });
    const rpc = core.rpc;
    await expectRequests(rpc, page, () => openApp(core, page), []); // the start-up document
    await expectRequests(rpc, page, () => fileNew(page), []);
    await expectRequests(rpc, page, () => openViaDialog(core.enqueueDialog, page, book), []);
    await expectRequests(rpc, page, () => reloadChangedOnDisk(page, book, 'Option off 2'), []);
    await expectRequests(rpc, page, () => openViaRecent(page, book), []);
    await expectRequests(rpc, page, () => openMalformed(core.enqueueDialog, page, malformed), []);
    // Settings shows the choice kept and the option off.
    await openSettingsOther(page);
    await expect(page.getByTestId('settings-other-switch-layout')).not.toBeChecked();
    await expect(page.getByTestId('settings-other-layout')).toHaveValue('test-ru');
    await closeSettings(page, 'cancel');
  });

  test('5. the chosen layout is no longer installed: shown as not installed, one request answered activated: false, no error', async ({
    core,
    page,
  }) => {
    const book = writeBook(path.join(dir, 'not-installed.fb2'), 'Not installed');
    await core.rpc('settings.set', { patch: { other: RUSSIAN_ON } });
    await core.rpc('test.setKeyboardLayouts', {
      supported: true,
      layouts: [{ id: 'test-en', name: 'English (United States)' }],
      current: 'test-en',
    });
    const rpc = core.rpc;
    const notInstalled = [{ id: 'test-ru', activated: false }];
    // The start-up document is a document opened: one request, answered activated: false.
    await expectRequests(rpc, page, () => openApp(core, page), notInstalled);

    for (const lang of ['en', 'ru'] as const) {
      if (lang !== 'en') await openApp(core, page, lang);
      await openSettingsOther(page);
      const select = page.getByTestId('settings-other-layout');
      await expect(select).toHaveValue('test-ru');
      await expect(select.locator('option:checked')).toHaveText(
        uiText(lang, 'dialog.settings.other.layoutNotInstalled', { name: 'Russian' }),
      );
      await expect(select.locator('option')).toHaveText([
        'English (United States)',
        uiText(lang, 'dialog.settings.other.layoutNotInstalled', { name: 'Russian' }),
      ]);
      await expect(page.getByTestId('settings-other-switch-layout')).toBeChecked();
      await expect(page.getByTestId('settings-other-layout-note')).toHaveCount(0);
      await closeSettings(page, 'cancel');
    }
    // The choice is kept until another layout is picked (FR-091); opening raises nothing.
    expect(await otherSettings(rpc)).toMatchObject(RUSSIAN_ON);
    await expectRequests(
      rpc,
      page,
      () => openViaDialog(core.enqueueDialog, page, book),
      notInstalled,
    );
    await expect(page.locator('[data-testid^="dialog-"]')).toHaveCount(0);

    // Picking the installed layout replaces the choice; the extra option goes.
    await openSettingsOther(page);
    await page.getByTestId('settings-other-layout').selectOption('test-en');
    await expect(page.getByTestId('settings-other-layout').locator('option')).toHaveText([
      'English (United States)',
    ]);
    await closeSettings(page, 'ok');
    expect(await otherSettings(rpc)).toMatchObject({
      switchKeyboardLayout: true,
      keyboardLayoutId: 'test-en',
      keyboardLayoutName: 'English (United States)',
    });
    await expectRequests(rpc, page, () => fileNew(page), [{ id: 'test-en', activated: true }]);
  });

  test('6. under Wayland the option is disabled with the note and the rest of the dialog works', async ({
    core,
    page,
  }) => {
    await core.rpc('settings.set', { patch: { other: RUSSIAN_ON } });
    await core.rpc('test.setKeyboardLayouts', { supported: false, reason: 'wayland', layouts: [] });
    for (const lang of ['en', 'ru'] as const) {
      await openApp(core, page, lang);
      await openSettingsOther(page);
      const group = page.getByTestId('settings-other-open-file');
      await expect(group.getByTestId('settings-other-switch-layout')).toBeDisabled();
      await expect(group.getByTestId('settings-other-layout')).toBeDisabled();
      const note = group.getByTestId('settings-other-layout-note');
      await expect(note).toBeVisible();
      await expect(note).toHaveText(uiText(lang, 'dialog.settings.other.layoutUnsupported'));
      // The stored values stay as they are ...
      await expect(group.getByTestId('settings-other-switch-layout')).toBeChecked();
      // ... and the rest of the dialog is usable: "Restore position" toggles and OK saves it.
      const restore = group.getByTestId('settings-other-restore-position');
      await expect(restore).toBeEnabled();
      const was = await restore.isChecked();
      await restore.click();
      await closeSettings(page, 'ok');
      const stored = await otherSettings(core.rpc);
      expect(stored.restorePosition).toBe(!was);
      expect(stored).toMatchObject(RUSSIAN_ON);
      await core.rpc('settings.set', { patch: { other: { restorePosition: was } } });
    }
    // Opening a document makes the one request, answered `unsupported` (activated: false).
    await expectRequests(core.rpc, page, () => fileNew(page), [
      { id: 'test-ru', activated: false },
    ]);
  });
});
