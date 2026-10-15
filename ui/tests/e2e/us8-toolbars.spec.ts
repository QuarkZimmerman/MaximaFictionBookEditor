/**
 * US8 (feature 002) - toolbars and right-click as in the original (FR-060 to FR-064): a
 * right-click on the Commands or the Scripts toolbar, on a button or an empty part, shows the
 * editor's menu with the single "Customize toolbar..."; the Links, Table and Document Tree
 * toolbars, the menu bar and the status bar show nothing and the browser's menu is cancelled;
 * the Customize dialog adds, removes, reorders, inserts separators, resets and is keyboard
 * operable; layouts survive a reload and a restart (settings.json); Shift+drag moves a button
 * and drags it off to remove it; a double-click on an empty part opens the dialog; the Scripts
 * toolbar starts with "Last script" alone and the dialog offers every script with an icon by
 * name; scripts added or removed later leave every other button on its script; a Description
 * field shows the Body menu and the Source view Undo, Redo, Cut, Copy, Paste, Delete and
 * Select All. Every test runs a core of its own on its own data folder, so the layouts it
 * stores reach no other test.
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import {
  APP_TITLE,
  expect,
  NodeRpcClient,
  startCoreWith,
  test,
  waitForStartupDocument,
} from './fixtures/core';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const SCRIPT_FIXTURES = path.join(REPO_ROOT, 'tests', 'scripts', 'fixtures');

/** The Commands toolbar of the original (`IDR_MAINFRAME TOOLBAR`), "-" for a separator. */
const ORIGINAL_COMMANDS = [
  'file.new',
  'file.open',
  'file.save',
  '-',
  'file.validate',
  '-',
  'view.description',
  'view.body',
  'view.source',
  '-',
  'insert.binary',
  'insert.image',
  'insert.inlineImage',
  '-',
  'edit.find',
  'edit.findNext',
  '-',
  'edit.cut',
  'edit.copy',
  'edit.paste',
  '-',
  'edit.undo',
  'edit.redo',
  '-',
  'style.strong',
  'style.emphasis',
  'style.sup',
  'style.sub',
  'style.strikethrough',
  'style.code',
  '-',
  'style.link',
  'style.footnote',
  'style.removeLink',
  'edit.gotoFootnote',
  '-',
  'style.normal',
  'style.subtitle',
  'style.textAuthor',
  '-',
  'tools.spellcheck',
];

/** A core of the test's own, on a data folder of its own. */
interface OwnCore {
  url: string;
  dataDir: string;
  rpc: NodeRpcClient;
  /** Stops the core and starts it again on the same data folder. */
  restart(): Promise<void>;
  stop(): Promise<void>;
}

async function ownCore(scriptGroups: readonly string[] = []): Promise<OwnCore> {
  const binary = process.env.MFBE_CORE_BIN!;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mfbe-us8-'));
  for (const group of scriptGroups) {
    cpSync(path.join(SCRIPT_FIXTURES, group), path.join(dataDir, 'scripts', group), {
      recursive: true,
    });
  }
  const connect = async () => {
    const started = await startCoreWith(binary, dataDir, []);
    const url = new URL(started.url);
    const rpc = new NodeRpcClient(
      `ws://127.0.0.1:${url.port}/rpc?token=${url.searchParams.get('token') ?? ''}`,
    );
    return { ...started, rpc };
  };
  let current = await connect();
  const own: OwnCore = {
    url: current.url,
    dataDir,
    rpc: current.rpc,
    async restart() {
      current.rpc.close();
      await current.stop();
      current = await connect();
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

async function openOwn(page: Page, core: OwnCore, lang?: string): Promise<void> {
  const url = new URL(core.url);
  if (lang) url.searchParams.set('lang', lang);
  await page.goto(url.toString());
  if (lang === 'ru') await expect(page).toHaveTitle(`Без имени - ${APP_TITLE}`);
  else await waitForStartupDocument(page);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

/** The items a toolbar shows in order ("-" for a separator). */
function layout(page: Page, toolbar: 'commands' | 'scripts'): Promise<string[]> {
  return page
    .getByTestId(`toolbar-${toolbar}`)
    .locator('[data-toolbar-item]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-toolbar-item') ?? ''));
}

/** The items of one of the Customize dialog's lists in order. */
function listItems(page: Page, list: 'available' | 'current'): Promise<string[]> {
  return page
    .getByTestId(`customize-toolbar-${list}`)
    .locator('option')
    .evaluateAll((options) => options.map((option) => option.getAttribute('data-item') ?? ''));
}

/** The stored layouts of settings.json (`session.toolbarLayouts`). */
function storedLayouts(core: OwnCore): Record<string, string[]> {
  const file = path.join(core.dataDir, 'settings.json');
  if (!existsSync(file)) return {};
  const settings = JSON.parse(readFileSync(file, 'utf8')) as {
    session?: { toolbarLayouts?: Record<string, string[]> };
  };
  return settings.session?.toolbarLayouts ?? {};
}

/** Records every right-click: the test id of the place and whether the browser's menu was cancelled. */
const RECORD_RIGHT_CLICKS = `(() => {
  window.__rightClicks = [];
  window.addEventListener('contextmenu', (event) => {
    const place = event.target.closest('[data-testid]');
    window.__rightClicks.push({
      place: place ? place.getAttribute('data-testid') : null,
      cancelled: event.defaultPrevented,
    });
  });
})()`;
const TAKE_RIGHT_CLICKS = 'window.__rightClicks.splice(0)';

interface RightClick {
  place: string | null;
  cancelled: boolean;
}

async function openCustomize(page: Page, toolbar: 'commands' | 'scripts'): Promise<void> {
  await page.getByTestId(`toolbar-${toolbar}`).locator('[data-toolbar-index]').first().click({
    button: 'right',
  });
  await page.getByTestId('toolbar-menu-customize').click();
  await expect(page.getByTestId('dialog-customize-toolbar')).toBeVisible();
}

async function closeCustomize(page: Page): Promise<void> {
  await page.getByTestId('dialog-customize-toolbar-button-close').click();
  await expect(page.getByTestId('dialog-customize-toolbar')).toHaveCount(0);
}

/** Shift+drag from the point (fx, fy) of `from` (fractions of its box) to the page point. */
async function shiftDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

async function pointIn(
  page: Page,
  testId: string,
  fx = 0.5,
  fy = 0.5,
): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

test.describe('US8 - toolbars and right-click as in the original', () => {
  let core: OwnCore | null = null;

  test.beforeEach(({ core: shared }) => {
    test.skip(!shared.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test.afterEach(async () => {
    await core?.stop();
    core = null;
  });

  test('1. the Commands and Scripts toolbars offer "Customize toolbar..." alone; other bars nothing', async ({
    page,
  }) => {
    core = await ownCore();
    await openOwn(page, core);
    await page.evaluate(RECORD_RIGHT_CLICKS);
    const menu = page.getByTestId('toolbar-menu');

    // A button, a disabled button and the empty part of each toolbar.
    const places = [
      () => page.getByTestId('toolbar-file.save').click({ button: 'right' }),
      () => page.getByTestId('toolbar-edit.cut').click({ button: 'right', force: true }),
      async () => {
        const end = await pointIn(page, 'toolbar-commands', 0.99);
        await page.mouse.click(end.x, end.y, { button: 'right' });
      },
      () => page.getByTestId('toolbar-scripts.last').click({ button: 'right', force: true }),
      async () => {
        const end = await pointIn(page, 'toolbar-scripts', 0.99);
        await page.mouse.click(end.x, end.y, { button: 'right' });
      },
    ];
    for (const rightClick of places) {
      await rightClick();
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem')).toHaveCount(1);
      await expect(page.getByTestId('toolbar-menu-customize')).toHaveText('Customize toolbar...');
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    }
    const onToolbars = (await page.evaluate(TAKE_RIGHT_CLICKS)) as RightClick[];
    expect(onToolbars).toHaveLength(places.length);
    expect(onToolbars.every((click) => click.cancelled)).toBe(true);

    // The other bars, the menu bar and the status bar: nothing, and no browser menu.
    for (const place of ['linksbar', 'tablebar', 'tree-toolbar', 'menubar', 'statusbar']) {
      await page.getByTestId(place).click({ button: 'right', position: { x: 3, y: 3 } });
      await expect(page.getByRole('menu')).toHaveCount(0);
    }
    await page.getByTestId('tree-toolbar-delete').click({ button: 'right', force: true });
    // Below the Document Tree's items: nothing either (the original's tree menu needs an item).
    const belowItems = await pointIn(page, 'tree-content', 0.5, 0.95);
    await page.mouse.click(belowItems.x, belowItems.y, { button: 'right' });
    await expect(page.getByTestId('tree-menu')).toHaveCount(0);
    const elsewhere = (await page.evaluate(TAKE_RIGHT_CLICKS)) as RightClick[];
    expect(elsewhere).toHaveLength(7);
    expect(elsewhere.filter((click) => !click.cancelled)).toEqual([]);

    // A text box keeps the shell's edit menu: its right-click is not cancelled.
    await page.getByTestId('links-bar-id').click({ button: 'right', force: true });
    expect((await page.evaluate(TAKE_RIGHT_CLICKS)) as RightClick[]).toEqual([
      { place: 'links-bar-id', cancelled: false },
    ]);

    // In Russian.
    await openOwn(page, core, 'ru');
    await page.getByTestId('toolbar-file.save').click({ button: 'right' });
    await expect(page.getByTestId('toolbar-menu-customize')).toHaveText('Настройка панели...');
    await page.getByTestId('toolbar-menu-customize').click();
    await expect(
      page.getByTestId('dialog-customize-toolbar-title').locator('.mfbe-dialog-title-text'),
    ).toHaveText('Настройка панели инструментов');
  });

  test('2. the Customize dialog edits the layout at once, by mouse and keyboard; kept after reload and restart', async ({
    page,
  }) => {
    core = await ownCore();
    await openOwn(page, core);
    await expect.poll(() => layout(page, 'commands')).toEqual(ORIGINAL_COMMANDS);

    await openCustomize(page, 'commands');
    await expect(
      page.getByTestId('dialog-customize-toolbar-title').locator('.mfbe-dialog-title-text'),
    ).toHaveText('Customize Toolbar');
    // Every button is shown: only the separator is available; the end entry closes the list.
    expect(await listItems(page, 'available')).toEqual(['-']);
    expect(await listItems(page, 'current')).toEqual([...ORIGINAL_COMMANDS, 'end']);
    await expect(page.getByTestId('customize-toolbar-current').locator('option').nth(2)).toHaveText(
      'Save',
    );

    // Remove Save: back in the available list, off the toolbar at once.
    await page.getByTestId('customize-toolbar-current').selectOption({ label: 'Save' });
    await page.getByTestId('dialog-customize-toolbar-button-remove').click();
    await expect(page.getByTestId('toolbar-file.save')).toHaveCount(0);
    expect(await listItems(page, 'available')).toEqual(['-', 'file.save']);

    // Add it before New; Move Down twice puts it back in its place.
    await page.getByTestId('customize-toolbar-current').selectOption({ label: 'New' });
    await page.getByTestId('customize-toolbar-available').selectOption({ label: 'Save' });
    await page.getByTestId('dialog-customize-toolbar-button-add').click();
    await expect
      .poll(async () => (await layout(page, 'commands')).slice(0, 3))
      .toEqual(['file.save', 'file.new', 'file.open']);
    await page.getByTestId('customize-toolbar-current').selectOption({ label: 'Save' });
    await page.getByTestId('dialog-customize-toolbar-button-moveDown').click();
    await page.getByTestId('dialog-customize-toolbar-button-moveDown').click();
    await expect.poll(() => layout(page, 'commands')).toEqual(ORIGINAL_COMMANDS);

    // Keyboard: a separator at the end (the end entry), removed again; Move Up; Reset.
    const current = page.getByTestId('customize-toolbar-current');
    const available = page.getByTestId('customize-toolbar-available');
    await available.focus();
    await page.keyboard.press('Tab');
    await expect(current).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Tab');
    await expect(available).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('Alt+a');
    await expect.poll(() => layout(page, 'commands')).toEqual([...ORIGINAL_COMMANDS, '-']);
    await current.focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Alt+r');
    await expect.poll(() => layout(page, 'commands')).toEqual(ORIGINAL_COMMANDS);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Alt+u');
    await expect
      .poll(async () => (await layout(page, 'commands')).slice(0, 2))
      .toEqual(['file.open', 'file.new']);
    await page.keyboard.press('Alt+e');
    await expect.poll(() => layout(page, 'commands')).toEqual(ORIGINAL_COMMANDS);
    await expect.poll(() => storedLayouts(core!).commands).toBeUndefined();

    // A layout of the user's: Save removed, a separator first; kept after reload and restart.
    await current.selectOption({ label: 'Save' });
    await page.keyboard.press('Alt+r');
    await current.selectOption({ label: 'New' });
    await available.selectOption({ index: 0 });
    await page.keyboard.press('Alt+a');
    const customised = [
      '-',
      ...ORIGINAL_COMMANDS.filter((item, index) => item !== 'file.save' || index !== 2),
    ];
    await expect.poll(() => layout(page, 'commands')).toEqual(customised);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dialog-customize-toolbar')).toHaveCount(0);
    await expect.poll(() => storedLayouts(core!).commands).toEqual(customised);
    await page.reload();
    await waitForStartupDocument(page);
    await expect.poll(() => layout(page, 'commands')).toEqual(customised);
    await core.restart();
    await openOwn(page, core);
    await expect.poll(() => layout(page, 'commands')).toEqual(customised);
    // The Scripts toolbar kept its own (original) layout.
    await expect.poll(() => layout(page, 'scripts')).toEqual(['scripts.last']);

    // Reset restores the original layout for good.
    await openCustomize(page, 'commands');
    await page.getByTestId('dialog-customize-toolbar-button-reset').click();
    await closeCustomize(page);
    await expect.poll(() => layout(page, 'commands')).toEqual(ORIGINAL_COMMANDS);
    await expect.poll(() => storedLayouts(core!).commands).toBeUndefined();
  });

  test('3. Shift+drag moves a button or drops it off the toolbar; a double-click opens the dialog', async ({
    page,
  }) => {
    core = await ownCore();
    await openOwn(page, core);

    // Open onto New: Open takes New's place, and no Open dialog was asked for.
    await shiftDrag(
      page,
      await pointIn(page, 'toolbar-file.open'),
      await pointIn(page, 'toolbar-file.new'),
    );
    await expect
      .poll(async () => (await layout(page, 'commands')).slice(0, 3))
      .toEqual(['file.open', 'file.new', 'file.save']);
    expect(await core.rpc.call('test.dialogRequests')).toEqual([]);

    // A disabled button moves too: Cut onto Copy.
    await expect(page.getByTestId('toolbar-edit.cut')).toBeDisabled();
    await shiftDrag(
      page,
      await pointIn(page, 'toolbar-edit.cut'),
      await pointIn(page, 'toolbar-edit.copy'),
    );
    await expect
      .poll(async () => {
        const items = await layout(page, 'commands');
        return items.indexOf('edit.cut') - items.indexOf('edit.copy');
      })
      .toBe(1);

    // Dropped on its own right half: a separator before it; on its left half: removed again.
    const before = await layout(page, 'commands');
    await shiftDrag(
      page,
      await pointIn(page, 'toolbar-file.save', 0.3),
      await pointIn(page, 'toolbar-file.save', 0.8),
    );
    const saveAt = before.indexOf('file.save');
    await expect
      .poll(() => layout(page, 'commands'))
      .toEqual([...before.slice(0, saveAt), '-', ...before.slice(saveAt)]);
    await shiftDrag(
      page,
      await pointIn(page, 'toolbar-file.save', 0.8),
      await pointIn(page, 'toolbar-file.save', 0.2),
    );
    await expect.poll(() => layout(page, 'commands')).toEqual(before);

    // Off the toolbar: removed.
    await shiftDrag(
      page,
      await pointIn(page, 'toolbar-file.save'),
      await pointIn(page, 'body-editor', 0.5, 0.5),
    );
    await expect(page.getByTestId('toolbar-file.save')).toHaveCount(0);
    await expect.poll(() => storedLayouts(core!).commands).not.toContain('file.save');

    // A double-click on a button presses it (a disabled one: nothing); on an empty part it
    // opens the dialog.
    await page.getByTestId('toolbar-edit.copy').dblclick({ force: true });
    await expect(page.getByTestId('dialog-customize-toolbar')).toHaveCount(0);
    const empty = await pointIn(page, 'toolbar-commands', 0.99);
    await page.mouse.dblclick(empty.x, empty.y);
    await expect(page.getByTestId('dialog-customize-toolbar')).toBeVisible();
    expect(await listItems(page, 'available')).toEqual(['-', 'file.save']);
    await closeCustomize(page);
  });

  test('4. the Scripts toolbar: "Last script" alone at first; scripts with icons by name; scripts added or removed later', async ({
    page,
  }) => {
    core = await ownCore(['01_Case', '04_Model']);
    await openOwn(page, core);
    const body = page.getByTestId('body-editor');
    await expect.poll(() => layout(page, 'scripts')).toEqual(['scripts.last']);

    await openCustomize(page, 'scripts');
    expect(await listItems(page, 'current')).toEqual(['scripts.last', 'end']);
    const offered = await listItems(page, 'available');
    expect(offered[0]).toBe('-');
    expect(offered).toEqual(
      expect.arrayContaining([
        'script.test.case.upper',
        'script.test.case.lower',
        'script.test.model.append',
      ]),
    );
    // Offered under the script's name; a script without an icon is not offered.
    const availableList = page.getByTestId('customize-toolbar-available');
    await expect(availableList.locator('option[data-item="script.test.case.upper"]')).toHaveText(
      'To upper case',
    );
    await expect(availableList.locator('option[data-item="script.test.model.append"]')).toHaveText(
      'Append paragraph',
    );
    // "Last script" first, then upper case and append.
    await page.getByTestId('customize-toolbar-current').selectOption({ index: 1 });
    await availableList.selectOption({ label: 'To upper case' });
    await page.getByTestId('dialog-customize-toolbar-button-add').click();
    await availableList.selectOption({ label: 'Append paragraph' });
    await page.getByTestId('dialog-customize-toolbar-button-add').click();
    await closeCustomize(page);
    await expect
      .poll(() => layout(page, 'scripts'))
      .toEqual(['scripts.last', 'script.test.case.upper', 'script.test.model.append']);

    // A script with an icon added later is only offered; it does not appear on the toolbar.
    cpSync(
      path.join(SCRIPT_FIXTURES, '02_Dialogs'),
      path.join(core.dataDir, 'scripts', '02_Dialogs'),
      { recursive: true },
    );
    await core.rpc.call('scripts.reload');
    await openCustomize(page, 'scripts');
    await expect
      .poll(() => listItems(page, 'available'))
      .toEqual(expect.arrayContaining(['script.test.dialogs.form']));
    await closeCustomize(page);
    await expect
      .poll(() => layout(page, 'scripts'))
      .toEqual(['scripts.last', 'script.test.case.upper', 'script.test.model.append']);

    // A removed script's button goes; the other button still runs its own script.
    rmSync(path.join(core.dataDir, 'scripts', '01_Case', '01_Upper'), { recursive: true });
    await core.rpc.call('scripts.reload');
    await expect
      .poll(() => layout(page, 'scripts'))
      .toEqual(['scripts.last', 'script.test.model.append']);
    await page.getByTestId('scripts-toolbar-test.model.append').click();
    await expect(body).toContainText('Added by script');
    // The stored layout still names the scripts by their ids.
    expect(storedLayouts(core).scripts).toEqual([
      'scripts.last',
      'script.test.case.upper',
      'script.test.model.append',
    ]);
  });

  test('5. a Description field shows the Body menu; the Source view its edit menu', async ({
    page,
    context,
  }) => {
    core = await ownCore();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(core.url).origin,
    });
    await openOwn(page, core);
    await page.evaluate(RECORD_RIGHT_CLICKS);

    // Description: Undo, Cut, Copy, Paste on the field under the pointer.
    await page.getByTestId('view-description').click();
    const title = page.getByTestId('description-book-title');
    await title.fill('Moved title');
    await title.selectText();
    await title.click({ button: 'right' });
    const menu = page.getByTestId('context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['Undo', 'Cut', 'Copy', 'Paste']);
    await page.getByTestId('context-menu-edit.cut').click();
    await expect(title).toHaveValue('');
    await title.click({ button: 'right' });
    await expect(page.getByTestId('context-menu-edit.cut')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.getByTestId('context-menu-edit.paste').click();
    await expect(title).toHaveValue('Moved title');
    // Elsewhere in the Description view: nothing.
    await page.getByTestId('description-view').click({ button: 'right', position: { x: 2, y: 2 } });
    await expect(menu).toHaveCount(0);
    const clicks = (await page.evaluate(TAKE_RIGHT_CLICKS)) as RightClick[];
    expect(clicks.every((click) => click.cancelled)).toBe(true);

    // Source: Undo, Redo, Cut, Copy, Paste, Delete, Select All.
    await page.getByTestId('view-source').click();
    const source = page.getByTestId('source-editor');
    await expect(source).toContainText('FictionBook');
    await source.click({ button: 'right' });
    const sourceMenu = page.getByTestId('source-context-menu');
    await expect(sourceMenu.getByRole('menuitem')).toHaveText([
      'Undo',
      'Redo',
      'Cut',
      'Copy',
      'Paste',
      'Delete',
      'Select All',
    ]);
    await page.getByTestId('source-context-menu-selectAll').click();
    await source.click({ button: 'right' });
    await expect(page.getByTestId('source-context-menu-copy')).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.getByTestId('source-context-menu-delete').click();
    await expect(source).not.toContainText('FictionBook');
    await source.click({ button: 'right' });
    await page.getByTestId('source-context-menu-undo').click();
    await expect(source).toContainText('FictionBook');
  });
});
