/**
 * US6 (feature 003) - dates are written the way the system writes them (FR-050 to FR-052).
 *
 * The core is started under the regional settings of each scenario (`coreEnv`, LC_ALL) with an
 * interface language that differs from them, so the journeys show that the date text follows
 * the regional settings and not the interface:
 *  1. Today replaces the text and the value of the title-info and document-info dates, whatever
 *     the text contained; the text is the regional long date, the value `YYYY-MM-DD`.
 *  2. A new document's date and the date filled in for a loaded book without one are written
 *     the same way.
 *  3. Without regional settings (the C locale) the interface language decides: Ukrainian text
 *     under the Ukrainian interface.
 *  4. The date text stays free text: hand-edited text is saved verbatim; only the value is
 *     checked for the calendar-date form, as before.
 *
 * Runs against the real core (`MFBE_CORE_BIN`); the environment drives the regional settings on
 * Linux only (Windows and macOS read the user's settings), so scenarios 1-3 run there alone.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import {
  expect,
  fileNew,
  test,
  waitForBook,
  waitForStartupDocument,
  type CoreHandle,
} from './fixtures/core';
import { fallbackLongDate, isoDate, longDateText } from './fixtures/dates';
import type { UiLang } from './fixtures/i18n';

interface Region {
  /** LC_ALL of the core process. */
  locale: string;
  /** The interface language of the page - deliberately not the regional one. */
  uiLang: UiLang;
  name: string;
}

const REGIONS: Region[] = [
  { locale: 'ru_RU.UTF-8', uiLang: 'en', name: 'Russian regional settings, English interface' },
  { locale: 'uk_UA.UTF-8', uiLang: 'en', name: 'Ukrainian regional settings, English interface' },
  { locale: 'en_US.UTF-8', uiLang: 'ru', name: 'US-English regional settings, Russian interface' },
];

/** A valid book whose document-info has no date: the editor fills it in on load. */
function bookWithoutDate(dir: string): string {
  const file = path.join(dir, 'no-date.fb2');
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Without a date</book-title>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>maker</nickname></author>
<id>no-date-0001</id>
<version>1.0</version>
</document-info>
</description>
<body>
<section><p>Only text.</p></section>
</body>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

async function showDescription(page: Page): Promise<void> {
  await page.getByTestId('view-description').click();
  await expect(page.getByTestId('description-view')).toBeVisible();
}

/** File > New from the Body view (`fileNew` watches the document the Body view shows). */
async function newDocument(page: Page): Promise<void> {
  await page.getByTestId('view-body').click();
  await expect(page.getByTestId('body-view')).toBeVisible();
  await fileNew(page);
}

async function openViaDialog(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
}

/**
 * Save As to `file` through the queued native dialog (a validation prompt, should the book
 * have issues, is answered with Yes); returns the written text.
 */
async function saveAs(core: CoreHandle, page: Page, file: string): Promise<string> {
  await core.enqueueDialog('dialog.saveFile', { path: file, encoding: 'utf-8' });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-saveAs').click();
  const prompt = page.getByTestId('dialog-validation-failed');
  const saved = `${path.basename(file)} - `;
  await expect
    .poll(async () => (await prompt.count()) > 0 || (await page.title()).startsWith(saved))
    .toBe(true);
  if ((await prompt.count()) > 0) {
    await page.getByTestId('dialog-validation-failed-button-yes').click();
  }
  await waitForBook(page, file);
  return readFileSync(file, 'utf8');
}

/** Presses Today on the date with the test-id prefix and checks both of its fields. */
async function pressToday(page: Page, prefix: string, expectedText: string): Promise<void> {
  const now = new Date();
  await page.getByTestId(`${prefix}-today`).click();
  await expect(page.getByTestId(`${prefix}-text`)).toHaveValue(expectedText);
  await expect(page.getByTestId(`${prefix}-value`)).toHaveValue(isoDate(now));
}

for (const region of REGIONS) {
  test.describe(`US6 - ${region.name}`, () => {
    test.use({ coreEnv: { LC_ALL: region.locale }, uiLang: region.uiLang });
    test.beforeEach(({ core }) => {
      test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
      test.skip(process.platform !== 'linux', 'LC_ALL drives the regional settings on Linux only');
    });

    test('1. Today replaces the text and the value of both dates with the regional long date', async ({
      core,
      page,
    }) => {
      await core.openApp(page);
      await waitForStartupDocument(page);
      await expect(page.locator('html')).toHaveAttribute('lang', region.uiLang);
      await showDescription(page);
      const expected = longDateText(new Date(), region.locale, region.uiLang);
      // The title-info date has content in both fields: both are replaced (release 0.0.2 kept
      // the text).
      await page.getByTestId('description-date-text').fill('весна 2001');
      await page.getByTestId('description-date-value').fill('2001-04-01');
      await pressToday(page, 'description-date', expected);
      // The document-info date was filled in on load; Today rewrites it the same way.
      await page.getByTestId('description-doc-date-text').fill('13 October 2026');
      await page.getByTestId('description-doc-date-value').fill('2026-10-13');
      await pressToday(page, 'description-doc-date', expected);
    });

    test('2. a new document and a loaded book without a date get the regional long date', async ({
      core,
      page,
    }) => {
      await core.openApp(page);
      await waitForStartupDocument(page);
      await showDescription(page);
      const now = new Date();
      const expected = longDateText(now, region.locale, region.uiLang);
      await expect(page.getByTestId('description-doc-date-text')).toHaveValue(expected);
      await expect(page.getByTestId('description-doc-date-value')).toHaveValue(isoDate(now));
      await newDocument(page);
      await showDescription(page);
      await expect(page.getByTestId('description-doc-date-text')).toHaveValue(expected);
      await expect(page.getByTestId('description-doc-date-value')).toHaveValue(isoDate(now));

      const dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us6-'));
      try {
        await openViaDialog(core, page, bookWithoutDate(dir));
        await showDescription(page);
        await expect(page.getByTestId('description-doc-date-text')).toHaveValue(expected);
        await expect(page.getByTestId('description-doc-date-value')).toHaveValue(isoDate(now));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

test.describe('US6 - no regional settings: the interface language decides', () => {
  test.use({ coreEnv: { LC_ALL: 'C' }, uiLang: 'uk' });
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(process.platform !== 'linux', 'LC_ALL drives the regional settings on Linux only');
  });

  test('3. under the C locale the Ukrainian interface writes the Ukrainian long form', async ({
    core,
    page,
  }) => {
    // The interface language the core follows is its setting (the page's `?lang` is the same).
    await core.rpc('settings.set', { patch: { view: { uiLanguage: 'uk' } } });
    await core.openApp(page);
    await waitForStartupDocument(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
    await showDescription(page);
    const now = new Date();
    const expected = fallbackLongDate(now, 'uk');
    expect(expected).toMatch(/^\d{1,2} \S+ \d{4}$/);
    // The start-up document and File > New: the filled-in text in the fallback form.
    await expect(page.getByTestId('description-doc-date-text')).toHaveValue(expected);
    await newDocument(page);
    await showDescription(page);
    await expect(page.getByTestId('description-doc-date-text')).toHaveValue(expected);
    await expect(page.getByTestId('description-doc-date-value')).toHaveValue(isoDate(now));
    // Today: the same form.
    await page.getByTestId('description-date-text').fill('Spring');
    await pressToday(page, 'description-date', expected);
  });
});

test.describe('US6 - the date text stays free text', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('4. hand-edited text is saved verbatim; only the value is checked', async ({
    core,
    page,
  }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us6-'));
    try {
      await core.openApp(page);
      await waitForStartupDocument(page);
      await openViaDialog(core, page, bookWithoutDate(dir));
      await showDescription(page);
      // The value is flagged while it is not a calendar date, as before; the text never is.
      const text = page.getByTestId('description-doc-date-text');
      const value = page.getByTestId('description-doc-date-value');
      await text.fill('наприкінці жовтня 2026 р.');
      await value.fill('2026-13-45');
      await expect(value).toHaveAttribute('aria-invalid', 'true');
      await expect(text).not.toHaveAttribute('aria-invalid', 'true');
      await value.fill('2026-10-31');
      await expect(value).not.toHaveAttribute('aria-invalid', 'true');

      const file = path.join(dir, 'free-text.fb2');
      const xml = await saveAs(core, page, file);
      expect(xml).toContain('<date value="2026-10-31">наприкінці жовтня 2026 р.</date>');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
