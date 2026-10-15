/**
 * US2 (feature 002) - the editor starts with the original's blank document, replaceable by the
 * user (FR-001 to FR-009): at start-up and on File > New a new, untitled, unmodified document
 * from the effective template, with the document details the original filled in on load (id,
 * version 1.0, program used, today's date); a user `blank.fb2` in the per-user data folder or in
 * the template folder chosen in Settings replaces the built-in one as written; a damaged one is
 * named and the built-in one used; a start-up file that does not exist is reported, then a new
 * document is shown; validating the new document reports only the values the author still has
 * to fill in, no structure errors.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import {
  APP_TITLE,
  expect,
  fileNew,
  fixtureBook,
  startCoreWith,
  test,
  waitForStartupDocument,
} from './fixtures/core';

/** Browser-side test hooks (`src/scripting/testHooks.ts`); the e2e tsconfig has no DOM lib. */
declare const window: {
  __mfbeTest?: { scripts?: { document(): { binaries: { id: string }[] } | null } };
};

const PROGRAM = /^Maxima Fiction Book Editor \d+\.\d+\.\d+/;
const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const COVER = readFileSync(
  path.join(path.dirname(fixtureBook('modern-utf8.fb2')), '..', 'images', 'tiny.png'),
).toString('base64');

/** The document date the original wrote: "09 October 2026" and "2026-10-09" (local date). */
function today(): { text: string; value: string } {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return {
    text: `${day} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`,
    value: `${now.getFullYear()}-${month}-${day}`,
  };
}

function userTemplate(title: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>sf</genre><book-title>${title}</book-title>
<annotation><p>Annotation of the user template.</p></annotation>
<coverpage><image l:href="#cover.png"/></coverpage><lang>en</lang></title-info>
<document-info><id/><version/></document-info></description>
<body><section><p>Text of the user template.</p></section></body>
<binary id="cover.png" content-type="image/png">${COVER}</binary>
</FictionBook>`;
}

async function showDescription(page: Page): Promise<void> {
  await page.getByTestId('view-description').click();
  await expect(page.getByTestId('description-view')).toBeVisible();
}

async function openSettingsOther(page: Page): Promise<void> {
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-settings').click();
  await page.getByTestId('settings-tab-other').click();
}

test.describe('US2 - start with the original blank document, replaceable by the user', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });
  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    rmSync(path.join(core.dataDir!, 'blank.fb2'), { force: true });
    await core.rpc('settings.set', { patch: { other: { templateFolder: null } } }).catch(() => {});
  });

  test('1. start-up shows a new, untitled, unmodified document with the details filled in', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await waitForStartupDocument(page);
    await expect(page.getByTestId('body-view')).toBeVisible();
    await expect(page.getByTestId('body-editor')).toContainText('blank.fb2');
    await showDescription(page);
    await expect(page.getByTestId('description-lang')).toHaveValue('ru');
    await expect(page.getByTestId('description-annotation')).toContainText(
      'Введите сюда краткую аннотацию',
    );
    await expect(page.getByTestId('description-version')).toHaveValue('1.0');
    await expect(page.getByTestId('description-program-used')).toHaveValue(PROGRAM);
    await expect(page.getByTestId('description-id')).toHaveValue(UUID);
    const { text, value } = today();
    await expect(page.getByTestId('description-doc-date-text')).toHaveValue(text);
    await expect(page.getByTestId('description-doc-date-value')).toHaveValue(value);
    // Filling these in does not mark the document modified.
    await expect(page).toHaveTitle(`Untitled - ${APP_TITLE}`);
  });

  test('2. File > New takes a blank.fb2 from the data folder as written', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await waitForStartupDocument(page);
    writeFileSync(path.join(core.dataDir!, 'blank.fb2'), userTemplate('User template'));
    await fileNew(page);
    await expect(page.getByTestId('body-editor')).toContainText('Text of the user template.');
    await showDescription(page);
    await expect(page.getByTestId('description-lang')).toHaveValue('en');
    await expect(page.getByTestId('description-book-title')).toHaveValue('User template');
    await expect(page.getByTestId('description-annotation')).toContainText(
      'Annotation of the user template.',
    );
    const binaries = await page.evaluate(() =>
      window.__mfbeTest!.scripts!.document()!.binaries.map((binary) => binary.id),
    );
    expect(binaries).toEqual(['cover.png']);
    await expect(page.getByTestId('description-version')).toHaveValue('1.0');
    await expect(page.getByTestId('description-id')).toHaveValue(UUID);
    await expect(page).toHaveTitle(`Untitled - ${APP_TITLE}`);
  });

  test('3. a template folder chosen in Settings wins and is shown there', async ({
    core,
    page,
  }) => {
    const folder = mkdtempSync(path.join(tmpdir(), 'mfbe-us2-template-'));
    try {
      writeFileSync(path.join(folder, 'blank.fb2'), userTemplate('Settings template'));
      writeFileSync(path.join(core.dataDir!, 'blank.fb2'), userTemplate('Data template'));
      await core.openApp(page);
      await waitForStartupDocument(page);
      await openSettingsOther(page);
      await expect(page.getByTestId('settings-other-template-in-use')).toContainText(
        path.join(core.dataDir!, 'blank.fb2'),
      );
      await page.getByTestId('settings-other-template-default').uncheck();
      await page.getByTestId('settings-other-template-path').fill(folder);
      await page.getByTestId('dialog-settings-button-ok').click();
      await expect(page.getByTestId('dialog-settings')).toBeHidden();
      await fileNew(page);
      await showDescription(page);
      await expect(page.getByTestId('description-book-title')).toHaveValue('Settings template');

      await openSettingsOther(page);
      await expect(page.getByTestId('settings-other-template-in-use')).toContainText(
        path.join(folder, 'blank.fb2'),
      );
      await expect(page.getByTestId('settings-other-template-path')).toHaveValue(folder);
      // "Open template folder" shows it (headless: recorded, no message).
      await page.getByTestId('settings-other-template-open').click();
      await expect(page.getByTestId('dialog-folder-failed')).toHaveCount(0);
      await expect(page.getByTestId('dialog-folder-unavailable')).toHaveCount(0);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test('4. a damaged user template is named and the built-in one is used', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await waitForStartupDocument(page);
    const file = path.join(core.dataDir!, 'blank.fb2');
    writeFileSync(file, '<FictionBook><body>');
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-new').click();
    const message = page.getByTestId('dialog-template-issue');
    await expect(message).toContainText(file);
    await expect(message).toContainText('not well-formed XML');
    await page.getByTestId('dialog-template-issue-button-ok').click();
    await showDescription(page);
    await expect(page.getByTestId('description-lang')).toHaveValue('ru');
    await expect(page).toHaveTitle(`Untitled - ${APP_TITLE}`);
  });

  test('5. a start-up file that does not exist is reported, then a new document is shown', async ({
    browser,
  }) => {
    const binary = process.env.MFBE_CORE_BIN!;
    test.skip(!/mfbe-core/.test(path.basename(binary)), 'needs the real mfbe-core binary');
    const dataDir = mkdtempSync(path.join(tmpdir(), 'mfbe-us2-startup-'));
    const missing = path.join(dataDir, 'missing.fb2');
    const second = await startCoreWith(binary, dataDir, ['--open', missing]);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(second.url);
      const failed = page.getByTestId('dialog-open-failed');
      await expect(failed).toContainText(missing);
      await page.getByTestId('dialog-open-failed-button-ok').click();
      await waitForStartupDocument(page);
      await expect(page.getByTestId('body-view')).toBeVisible();
      expect(existsSync(missing)).toBe(false);
    } finally {
      await context.close();
      await second.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('6. Validate on the new document lists only the values still to fill in', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await waitForStartupDocument(page);
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-validate').click();
    const panel = page.getByTestId('validation-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-code]').first()).toBeVisible();
    const codes = await page.evaluate<string[]>(
      `[...document.querySelectorAll('[data-testid="validation-panel"] [data-code]')].map((item) => item.getAttribute('data-code'))`,
    );
    expect(codes).toContain('genre.unknown');
    expect(codes.filter((code) => code.startsWith('schema.'))).toEqual([]);
  });
});
