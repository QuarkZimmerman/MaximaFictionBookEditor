/**
 * Feature 007, user story 1 - Ctrl+S saves the book (T026; spec FR-001, data-model §2, DP-2).
 *
 * Ctrl+S (Cmd+S on macOS) runs File > Save wherever Save is available - from the Body view, a
 * Description field, the Source view and the Document Tree - rewriting the book file and
 * clearing the modified marker; a book never saved goes into Save As; with a modal dialog open
 * nothing happens; F2 stays the assignable shortcut and still saves. Settings > Hotkeys shows
 * F2 for Save and the read-only "Fixed shortcut: Ctrl+S", refuses Ctrl+S for another command
 * ("Ctrl+S always runs Save"), and a hotkeys.json that bound Ctrl+S elsewhere loads without
 * that binding. With a Russian layout the physical S key saves (the editor's shortcuts follow
 * the key, not the character).
 *
 * Playwright's keys reach the page, as a user's keys do, but never the browser engine's own
 * accelerators: the engine's side - Ctrl+S never offering to save the page - is the shell
 * smoke's `save` key set (tools/shell-smoke.mjs). Needs the real core (MFBE_CORE_BIN).
 */

import { copyFileSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import {
  APP_TITLE,
  expect,
  fixtureBook,
  fileNew,
  test,
  waitForBook,
  type CoreHandle,
} from './fixtures/core';
import { MAC, MOD, MOD_LABEL } from './fixtures/keys';

const SAVE = `${MOD}+s`;

let dir = '';

test.beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us1-save-'));
});

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A copy of modern-utf8.fb2 under `name`, opened through the queued Open dialog. */
async function openCopy(core: CoreHandle, page: Page, name: string): Promise<string> {
  const file = path.join(dir, name);
  copyFileSync(fixtureBook('modern-utf8.fb2'), file);
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, name);
  return file;
}

async function expectModified(page: Page, name: string): Promise<void> {
  await expect(page).toHaveTitle(`${name}* - ${APP_TITLE}`);
}

async function expectSaved(page: Page, name: string, file: string, marker: string): Promise<void> {
  await expect(page).toHaveTitle(`${name} - ${APP_TITLE}`);
  await expect.poll(() => readFileSync(file, 'utf8').includes(marker)).toBe(true);
}

/** Types `marker` at the start of the Body view's first paragraph. */
async function editBody(page: Page, marker: string): Promise<void> {
  await page.getByTestId('view-body').click();
  await page.locator('[data-testid="body-editor"] p').first().click();
  await page.keyboard.press(MAC ? 'Meta+ArrowLeft' : 'Home');
  await page.keyboard.type(`${marker} `);
}

test.describe('US1 (feature 007) - Ctrl+S saves the book', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('1. Ctrl+S saves from the Body view, a Description field, the Source view and the Document Tree', async ({
    core,
    page,
  }) => {
    const name = 'us1-ctrl-s.fb2';
    const file = await openCopy(core, page, name);

    // The Body view.
    await editBody(page, 'BODY-CTRL-S');
    await expectModified(page, name);
    await page.keyboard.press(SAVE);
    await expectSaved(page, name, file, 'BODY-CTRL-S');

    // A Description field, the focus still in it.
    await page.getByTestId('view-description').click();
    const title = page.getByTestId('description-book-title');
    await title.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' DESC-CTRL-S');
    await expectModified(page, name);
    await page.keyboard.press(SAVE);
    await expectSaved(page, name, file, 'DESC-CTRL-S');
    await expect(title).toBeFocused();

    // The Source view: the marker goes into the first paragraph of the body.
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    const saved = readFileSync(file, 'utf8');
    const at = saved.indexOf('<p>', saved.indexOf('<body'));
    await page.getByTestId('source-editor').click();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.insertText(`${saved.slice(0, at + 3)}SOURCE-CTRL-S ${saved.slice(at + 3)}`);
    await expectModified(page, name);
    await page.keyboard.press(SAVE);
    await expectSaved(page, name, file, 'SOURCE-CTRL-S');

    // The Document Tree (shown by default): a row has the focus.
    await editBody(page, 'TREE-CTRL-S');
    await expectModified(page, name);
    const row = page.locator('[data-testid^="tree-row-"]').first();
    await row.click();
    await page.keyboard.press(SAVE);
    await expectSaved(page, name, file, 'TREE-CTRL-S');
  });

  test('2. a book never saved goes into Save As; F2 still saves; nothing happens with a modal dialog open', async ({
    core,
    page,
  }) => {
    // A new book: Ctrl+S asks where to save it (Save As).
    await core.openApp(page);
    await fileNew(page);
    const target = path.join(dir, 'us1-new-book.fb2');
    await core.enqueueDialog('dialog.saveFile', { path: target, encoding: 'utf-8' });
    await page.locator('[data-testid="body-editor"] p').first().click();
    await page.keyboard.type('NEW-BOOK');
    await page.keyboard.press(SAVE);
    // A new book does not validate yet: the usual "save anyway?" question, then Save As.
    await page.getByTestId('dialog-validation-failed-button-yes').click();
    await expect(page).toHaveTitle(`us1-new-book.fb2 - ${APP_TITLE}`);
    await expect
      .poll(() => existsSync(target) && readFileSync(target, 'utf8').includes('NEW-BOOK'))
      .toBe(true);

    // F2 stays Save's assignable shortcut.
    const name = 'us1-f2.fb2';
    const file = await openCopy(core, page, name);
    await editBody(page, 'F2-SAVE');
    await expectModified(page, name);
    await page.keyboard.press('F2');
    await expectSaved(page, name, file, 'F2-SAVE');

    // A modal dialog open: Ctrl+S does nothing - no save, no dialog behind it.
    await editBody(page, 'MODAL-UNSAVED');
    await expectModified(page, name);
    await page.getByTestId('menu-help').click();
    await page.getByTestId('menu-help-about').click();
    const about = page.getByTestId('dialog-about');
    await expect(about).toBeVisible();
    await page.keyboard.press(SAVE);
    await page.waitForTimeout(500);
    await expect(about).toBeVisible();
    await expectModified(page, name);
    expect(readFileSync(file, 'utf8')).not.toContain('MODAL-UNSAVED');
    await page.keyboard.press('Escape');
    await expect(about).toBeHidden();
  });

  test('3. Settings > Hotkeys shows the fixed shortcut and refuses Ctrl+S for another command', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-settings').click();
    await page.getByTestId('settings-tab-hotkeys').click();
    await page.getByTestId('settings-hotkeys-group-file').click();
    await expect(page.getByTestId('settings-hotkeys-command-file.save')).toContainText(
      `F2, ${MOD_LABEL}+S`,
    );
    await page.getByTestId('settings-hotkeys-command-file.save').click();
    await expect(page.getByTestId('settings-hotkeys-current')).toContainText('F2');
    await expect(page.getByTestId('hotkeys-fixed-line')).toHaveText(
      `Fixed shortcut: ${MOD_LABEL}+S`,
    );
    // Save as has no fixed shortcut.
    await page.getByTestId('settings-hotkeys-command-file.saveAs').click();
    await expect(page.getByTestId('hotkeys-fixed-line')).toHaveCount(0);

    // Ctrl+S for Add > Poem: refused, with the command it always runs.
    await page.getByTestId('settings-hotkeys-group-edit').click();
    await page.getByTestId('settings-hotkeys-command-insert.poem').click();
    const capture = page.getByTestId('settings-hotkeys-capture');
    await capture.focus();
    await page.keyboard.press(SAVE);
    await expect(page.getByTestId('settings-hotkeys-collision')).toHaveText(
      `${MOD_LABEL}+S always runs Save`,
    );
    await expect(page.getByTestId('settings-hotkeys-assign')).toBeDisabled();
    await page.getByTestId('dialog-settings-button-cancel').click();
  });

  test('4. a hotkeys.json that bound Ctrl+S elsewhere loads without that binding', async ({
    core,
    page,
  }) => {
    const ctrlS = MAC ? 'Meta+S' : 'Ctrl+S';
    await core.rpc('hotkeys.set', {
      bindings: [{ commandId: 'script.01/upper-case', keys: ctrlS }],
    });
    try {
      const name = 'us1-stored.fb2';
      const file = await openCopy(core, page, name);
      // A lower-case marker under the caret: the upper-case script would have changed it.
      await editBody(page, 'storedbinding');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press(SAVE);
      await expectSaved(page, name, file, 'storedbinding');
      await page.waitForTimeout(500);
      await expect(page).toHaveTitle(`${name} - ${APP_TITLE}`);
      expect(readFileSync(file, 'utf8')).not.toContain('STOREDBINDING');
      await page.getByTestId('menu-tools').click();
      await page.getByTestId('menu-tools-settings').click();
      await page.getByTestId('settings-tab-hotkeys').click();
      await page.getByTestId('settings-hotkeys-group-scripts').click();
      await expect(
        page.getByTestId('settings-hotkeys-command-script.01/upper-case'),
      ).not.toContainText(MAC ? 'Cmd+S' : 'Ctrl+S');
      await page.getByTestId('dialog-settings-button-cancel').click();
    } finally {
      await core.rpc('hotkeys.set', { bindings: [] });
    }
  });

  test('5. with a Russian layout the physical S key saves', async ({ core, page }) => {
    const name = 'us1-layout.fb2';
    const file = await openCopy(core, page, name);
    await editBody(page, 'LAYOUT-RU');
    await expectModified(page, name);
    // The S key of a Russian layout types "ы": the shortcut follows the key.
    const cdp = await page.context().newCDPSession(page);
    try {
      const modifiers = MAC ? 4 : 2; // Meta : Ctrl
      const key = { key: 'ы', code: 'KeyS', windowsVirtualKeyCode: 83 };
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, ...key });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...key });
    } finally {
      await cdp.detach();
    }
    await expectSaved(page, name, file, 'LAYOUT-RU');
  });
});
