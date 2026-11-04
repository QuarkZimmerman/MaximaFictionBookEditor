/**
 * Feature 009, user story 1 - a backup of the previous version when saving (T010; spec FR-001 to
 * FR-007, data-model §1, research DP-7).
 *
 * Every way of saving over an existing file leaves `<file>.bak` holding the file as it was
 * before that save: File > Save, Ctrl+S, F2, the toolbar's Save button, Yes in the question
 * about unsaved changes, and Save As onto an existing file. Settings > Other switches it off.
 * A backup that cannot be made (a folder in its place) never stops the save, and the status
 * line says why. Export as FBD makes none, and the backup opens like any book. The ZIP case
 * (scenario 8) is in us2-archives. Needs the real core (MFBE_CORE_BIN).
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import {
  APP_TITLE,
  expect,
  fixtureBook,
  test,
  waitForBook,
  type CoreHandle,
} from './fixtures/core';
import { MAC, MOD } from './fixtures/keys';

let dir = '';

test.beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us1-backups-'));
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

/** Types `marker` at the start of the Body view's first paragraph. */
async function editBody(page: Page, marker: string): Promise<void> {
  await page.getByTestId('view-body').click();
  await page.locator('[data-testid="body-editor"] p').first().click();
  await page.keyboard.press(MAC ? 'Meta+ArrowLeft' : 'Home');
  await page.keyboard.type(`${marker} `);
}

const read = (file: string): string => readFileSync(file, 'utf8');

/** The save finished: the title has no modified marker and the file holds `marker`. */
async function expectSaved(page: Page, name: string, file: string, marker: string): Promise<void> {
  await expect(page).toHaveTitle(`${name} - ${APP_TITLE}`);
  await expect.poll(() => read(file).includes(marker)).toBe(true);
}

/** One edit and one save by `save`; the backup must then equal the file before that save. */
async function saveOnceAndCheck(
  page: Page,
  name: string,
  file: string,
  marker: string,
  save: () => Promise<void>,
): Promise<void> {
  const before = read(file);
  await editBody(page, marker);
  await save();
  await expectSaved(page, name, file, marker);
  expect(read(`${file}.bak`)).toBe(before);
}

test.describe('US1 (feature 009) - a backup of the previous version when saving', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('1-4. File > Save, Ctrl+S, F2 and the toolbar each keep the version before that save', async ({
    core,
    page,
  }) => {
    const name = 'every-way.fb2';
    const file = await openCopy(core, page, name);
    expect(existsSync(`${file}.bak`)).toBe(false);
    await saveOnceAndCheck(page, name, file, 'MENU1', async () => {
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-save').click();
    });
    // Every save replaces the backup with the version before it (D2).
    await saveOnceAndCheck(page, name, file, 'CTRLS2', () => page.keyboard.press(`${MOD}+s`));
    await saveOnceAndCheck(page, name, file, 'FKEY3', () => page.keyboard.press('F2'));
    await saveOnceAndCheck(page, name, file, 'TOOL4', () =>
      page.getByTestId('toolbar-file.save').click(),
    );
  });

  test('5. Yes in the question about unsaved changes keeps the backup too', async ({
    core,
    page,
  }) => {
    const name = 'question.fb2';
    const file = await openCopy(core, page, name);
    const before = read(file);
    await editBody(page, 'ASKED5');
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-new').click();
    await expect(page.getByTestId('dialog-save-changes')).toBeVisible();
    await page.getByTestId('dialog-save-changes-button-yes').click();
    await expect.poll(() => read(file).includes('ASKED5')).toBe(true);
    expect(read(`${file}.bak`)).toBe(before);
  });

  test('6. Save As onto an existing file keeps that file as its backup', async ({ core, page }) => {
    const name = 'source.fb2';
    await openCopy(core, page, name);
    const target = path.join(dir, 'existing-target.fb2');
    copyFileSync(fixtureBook('modern-utf8.fb2'), target);
    const before = read(target);
    await editBody(page, 'SAVEAS6');
    await core.enqueueDialog('dialog.saveFile', { path: target, encoding: 'utf-8' });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-saveAs').click();
    await expect.poll(() => read(target).includes('SAVEAS6')).toBe(true);
    expect(read(`${target}.bak`)).toBe(before);
  });

  test('7. switched off in Settings > Other, no backup is made', async ({ core, page }) => {
    const name = 'switched-off.fb2';
    const file = await openCopy(core, page, name);
    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-settings').click();
    await expect(page.getByTestId('dialog-settings')).toBeVisible();
    await page.getByTestId('settings-tab-other').click();
    const box = page.getByTestId('settings-other-keep-backup');
    await expect(box).toBeChecked();
    await box.uncheck();
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    await editBody(page, 'OFF7');
    await page.keyboard.press(`${MOD}+s`);
    await expectSaved(page, name, file, 'OFF7');
    expect(existsSync(`${file}.bak`)).toBe(false);
    // Back on for the other journeys of this worker.
    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-settings').click();
    await page.getByTestId('settings-tab-other').click();
    await page.getByTestId('settings-other-keep-backup').check();
    await page.getByTestId('dialog-settings-button-ok').click();
  });

  test('9. Export as FBD makes no backup of the file it replaces', async ({ core, page }) => {
    const name = 'export.fb2';
    await openCopy(core, page, name);
    const target = path.join(dir, 'export.fbd');
    copyFileSync(fixtureBook('modern-utf8.fb2'), target);
    await core.enqueueDialog('dialog.saveFile', { path: target, encoding: 'utf-8' });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-export').hover();
    await page.getByTestId('menu-file-export-exportFbd').click();
    await expect
      .poll(() => read(target) !== readFileSync(fixtureBook('modern-utf8.fb2'), 'utf8'))
      .toBe(true);
    expect(existsSync(`${target}.bak`)).toBe(false);
  });

  test('10. a folder in the backup\u2019s place: the book is saved and the status line says why; the backup opens as a book', async ({
    core,
    page,
  }) => {
    const name = 'blocked.fb2';
    const file = await openCopy(core, page, name);
    mkdirSync(`${file}.bak`);
    await editBody(page, 'BLOCKED10');
    await page.keyboard.press(`${MOD}+s`);
    await expectSaved(page, name, file, 'BLOCKED10');
    await expect(page.getByTestId('status-message')).toContainText('no backup copy');
    rmSync(`${file}.bak`, { recursive: true, force: true });

    // A real backup opens through File > Open like any book (FR-007).
    await editBody(page, 'AGAIN10');
    await page.keyboard.press(`${MOD}+s`);
    await expectSaved(page, name, file, 'AGAIN10');
    await core.enqueueDialog('dialog.openFile', { paths: [`${file}.bak`] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await waitForBook(page, `${name}.bak`);
  });
});
