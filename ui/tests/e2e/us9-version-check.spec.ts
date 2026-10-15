/**
 * US9 (feature 002) - Help > Check for new version and the Maxima Library link (FR-080 to
 * FR-083): the latest release comes from the core (`app.latestRelease`, pre-answered here with
 * `test.enqueueRelease`: the checks never contact GitHub or Maxima Library); a newer release is
 * named and its page offered, Yes opens `.../releases/tag/<tag>` outside the editor and No does
 * nothing; the same or an older version gives "the latest version"; every failure gives "Can't
 * connect to server" - in English and in Russian. The About dialog links Maxima Library in the
 * system browser, and a session that does not use the command requests nothing but the
 * editor's own address.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { BrowserContext, Page } from '@playwright/test';

import { expect, fixtureBook, test, type CoreHandle } from './fixtures/core';

const RELEASES = 'https://github.com/QuarkZimmerman/MaximaFictionBookEditor/releases/tag/';
const RUNNING = (
  JSON.parse(
    readFileSync(
      path.join(path.dirname(fixtureBook('x')), '..', '..', '..', 'ui', 'package.json'),
      'utf8',
    ),
  ) as { version: string }
).version;

/** Aborts every request that leaves the editor's own address and records it. */
async function recordOutside(context: BrowserContext): Promise<string[]> {
  const outside: string[] = [];
  await context.route(
    (url) => url.hostname !== '127.0.0.1',
    async (route) => {
      outside.push(route.request().url());
      await route.abort();
    },
  );
  return outside;
}

async function openApp(core: CoreHandle, page: Page, lang?: string): Promise<void> {
  const url = new URL(core.baseURL);
  if (lang) url.searchParams.set('lang', lang);
  await page.goto(url.toString());
  // The start-up document (its title is in the interface language).
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

async function checkVersion(page: Page): Promise<void> {
  await page.getByTestId('menu-help').click();
  await page.getByTestId('menu-help-checkVersion').click();
}

test.describe('US9 - check for a new version; Maxima Library in About', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('1. a newer release is named; Yes opens its page outside the editor, No does nothing', async ({
    core,
    page,
    context,
  }) => {
    const outside = await recordOutside(context);
    await openApp(core, page);
    await core.rpc('test.enqueueRelease', { result: { tag: 'v99.0.1' } });
    await checkVersion(page);
    const offer = page.getByTestId('dialog-version-new');
    await expect(offer).toContainText(
      'A new version of Maxima Fiction Book Editor is available: 99.0.1.',
    );
    await expect(offer).toContainText('Open its page?');
    await page.getByTestId('dialog-version-new-button-no').click();
    await expect(offer).toHaveCount(0);
    expect(outside).toEqual([]);

    await core.rpc('test.enqueueRelease', { result: { tag: 'v99.0.1' } });
    await checkVersion(page);
    const popup = page.waitForEvent('popup');
    await page.getByTestId('dialog-version-new-button-yes').click();
    await popup;
    await expect.poll(() => outside).toEqual([`${RELEASES}v99.0.1`]);
    // Only the page itself was asked for: the release request is the shell's (none here).
    expect(outside.every((url) => url.startsWith(RELEASES))).toBe(true);
  });

  test('2. the same or an older version is the latest; every failure cannot connect', async ({
    core,
    page,
    context,
  }) => {
    const outside = await recordOutside(context);
    await openApp(core, page);
    for (const tag of [`v${RUNNING}`, RUNNING, 'v0.0.0', `v${RUNNING}.0`]) {
      await core.rpc('test.enqueueRelease', { result: { tag } });
      await checkVersion(page);
      await expect(page.getByTestId('dialog-version-latest')).toHaveText(
        /You have the latest version of Maxima Fiction Book Editor\./,
      );
      await page.getByTestId('dialog-version-latest-button-ok').click();
    }
    for (const reason of ['offline', 'timeout', 'http', 'format']) {
      await core.rpc('test.enqueueRelease', { error: { reason } });
      await checkVersion(page);
      await expect(page.getByTestId('dialog-version-cant-connect')).toContainText(
        "Can't connect to server",
      );
      await page.getByTestId('dialog-version-cant-connect-button-ok').click();
    }
    expect(outside).toEqual([]);
  });

  test('3. in Russian', async ({ core, page, context }) => {
    await recordOutside(context);
    await openApp(core, page, 'ru');
    await page.getByTestId('menu-help').click();
    await expect(page.getByTestId('menu-help-checkVersion')).toContainText(
      'Проверить новую версию',
    );
    await page.keyboard.press('Escape');
    await core.rpc('test.enqueueRelease', { result: { tag: 'v99.0.1' } });
    await checkVersion(page);
    await expect(page.getByTestId('dialog-version-new')).toContainText(
      'Новая версия Maxima Fiction Book Editor доступна для загрузки: 99.0.1.',
    );
    await page.getByTestId('dialog-version-new-button-no').click();
    await core.rpc('test.enqueueRelease', { result: { tag: `v${RUNNING}` } });
    await checkVersion(page);
    await expect(page.getByTestId('dialog-version-latest')).toContainText(
      'У Вас установлена последняя версия Maxima Fiction Book Editor.',
    );
    await page.getByTestId('dialog-version-latest-button-ok').click();
    await core.rpc('test.enqueueRelease', { error: { reason: 'offline' } });
    await checkVersion(page);
    await expect(page.getByTestId('dialog-version-cant-connect')).toContainText(
      'Не могу подключиться к серверу',
    );
  });

  test('4. About links Maxima Library in the system browser; nothing else leaves the editor', async ({
    core,
    page,
    context,
  }) => {
    const outside = await recordOutside(context);
    await openApp(core, page);
    await page.getByTestId('menu-help').click();
    await page.getByTestId('menu-help-about').click();
    const link = page.getByTestId('about-maxima-library');
    await expect(link).toHaveAttribute('href', 'https://www.maxima-library.com');
    await expect(link).toHaveAttribute('target', '_blank');
    // A session without the version check asked for nothing but the editor's own address.
    expect(outside).toEqual([]);
    const popup = page.waitForEvent('popup');
    await link.click();
    await popup;
    await expect.poll(() => outside).toEqual(['https://www.maxima-library.com/']);
  });
});
