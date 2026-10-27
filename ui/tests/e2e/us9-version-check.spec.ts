/**
 * US9 (feature 002) - Help > Check for new version and the Maxima Library link (FR-080 to
 * FR-083): the latest release comes from the core (`app.latestRelease`, pre-answered here with
 * `test.enqueueRelease`: the checks never contact GitHub or Maxima Library); a newer release is
 * named and its page offered, Yes opens `.../releases/tag/<tag>` outside the editor and No does
 * nothing; the same or an older version gives "the latest version"; every failure gives "Can't
 * connect to server" - in English and in Russian. The About dialog links Maxima Library in the
 * system browser, and a session that does not use the command requests nothing but the
 * editor's own address.
 *
 * US5 (feature 003) - the check on a schedule (FR-040 to FR-045): Settings > Other > Version
 * check offers at every start / once a day / once a week / once a month / never (monthly by
 * default, also for a settings file without the key); the schedule and the record
 * `session.lastVersionCheck` are preset through `settings.set` before the page loads. A due
 * check at start-up makes the same single request once the document is shown and announces
 * only a newer release - after an open dialog has been closed -, records the time of any
 * answer, and is silent and unrecorded on failure (no `log.error`); a check that is not due,
 * and "never" over a whole journey, make no request (`test.requests()`); the manual command
 * keeps its three messages and records on an answer only.
 *
 * Feature 006 (decision 13, FR-055): a pre-release is older than its final - the final of the
 * running label (`0.0.6` for `0.0.6-rc`) is newer exactly while that label is a pre-release -,
 * and a `+build` part is ignored, so a rebuild is still the latest.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import {
  NodeRpcClient,
  expect,
  fixtureBook,
  recordOutside,
  startCoreWith,
  test,
  waitForBook,
  type CoreHandle,
} from './fixtures/core';

const RELEASES = 'https://github.com/QuarkZimmerman/MaximaFictionBookEditor/releases/tag/';
const RUNNING = (
  JSON.parse(
    readFileSync(
      path.join(path.dirname(fixtureBook('x')), '..', '..', '..', 'ui', 'package.json'),
      'utf8',
    ),
  ) as { version: string }
).version;
/**
 * The final release of the running label - its numbers alone, `0.0.6` for `0.0.6-rc` -, newer
 * exactly while the label is a pre-release, with a `-` before any `+build` (feature 006,
 * decision 13).
 */
const [RUNNING_PRECEDENCE] = RUNNING.split('+');
const [RUNNING_FINAL] = RUNNING_PRECEDENCE.split('-');
const RUNNING_IS_PRERELEASE = RUNNING_FINAL !== RUNNING_PRECEDENCE;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type Schedule = 'everyStart' | 'daily' | 'weekly' | 'monthly' | 'never';

interface NetworkRequest {
  method: string;
  at: string;
}

interface SettingsJson {
  other: { versionCheck: Schedule };
  session: { lastVersionCheck?: string };
}

interface LogEntry {
  level: string;
  source: string;
  code: string;
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

/** An ISO 8601 UTC time `ms` milliseconds before now (negative: after now). */
function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/**
 * The schedule and the record of the last check before the page loads (the worker's core
 * keeps its settings from one test to the next); `null` removes the record.
 */
async function presetSchedule(
  core: CoreHandle,
  schedule: Schedule,
  lastVersionCheck: string | null,
): Promise<void> {
  await core.rpc('settings.set', {
    patch: { other: { versionCheck: schedule }, session: { lastVersionCheck } },
  });
}

/** The shell-delegated network requests made since the core started. */
async function requestCount(core: CoreHandle): Promise<number> {
  return (await core.rpc<NetworkRequest[]>('test.requests')).length;
}

async function lastCheck(core: CoreHandle): Promise<string | undefined> {
  return (await core.rpc<SettingsJson>('settings.get')).session.lastVersionCheck;
}

function readLog(core: CoreHandle): LogEntry[] {
  const file = path.join(core.dataDir!, 'logs', 'mfbe-errors.log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LogEntry);
}

async function openSettings(page: Page): Promise<void> {
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-settings').click();
  await expect(page.getByTestId('dialog-settings')).toBeVisible();
}

async function openAbout(page: Page): Promise<void> {
  await page.getByTestId('menu-help').click();
  await page.getByTestId('menu-help-about').click();
  await expect(page.getByTestId('dialog-about')).toBeVisible();
}

/** Within `ms` of now: the record of a check made during this test. */
function isRecent(iso: string | undefined, ms = 60_000): boolean {
  return iso !== undefined && Math.abs(Date.now() - Date.parse(iso)) < ms;
}

test.describe('US9 - check for a new version; Maxima Library in About', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    // The manual command alone: no scheduled check at start-up in these journeys.
    await presetSchedule(core, 'never', null);
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

  test('2. the same or an older version is the latest, the final of a pre-release is newer; every failure cannot connect', async ({
    core,
    page,
    context,
  }) => {
    const outside = await recordOutside(context);
    await openApp(core, page);
    // The same version, also rebuilt (`+rebuild`), and an older one. An added `.0` is not the
    // same for a pre-release label: `0.0.6-rc.0` is newer than `0.0.6-rc` (feature 006,
    // decision 13).
    for (const tag of [`v${RUNNING}`, RUNNING, 'v0.0.0', `v${RUNNING}+rebuild`]) {
      await core.rpc('test.enqueueRelease', { result: { tag } });
      await checkVersion(page);
      await expect(page.getByTestId('dialog-version-latest')).toHaveText(
        /You have the latest version of Maxima Fiction Book Editor\./,
      );
      await page.getByTestId('dialog-version-latest-button-ok').click();
    }
    // The running label's final: a test build learns that its final is out, a final build has
    // the latest version.
    await core.rpc('test.enqueueRelease', { result: { tag: `v${RUNNING_FINAL}` } });
    await checkVersion(page);
    if (RUNNING_IS_PRERELEASE) {
      const offer = page.getByTestId('dialog-version-new');
      await expect(offer).toContainText(
        `A new version of Maxima Fiction Book Editor is available: ${RUNNING_FINAL}.`,
      );
      await expect(page.getByTestId('dialog-version-latest')).toHaveCount(0);
      await page.getByTestId('dialog-version-new-button-no').click();
      await expect(offer).toHaveCount(0);
    } else {
      await expect(page.getByTestId('dialog-version-latest')).toHaveText(
        /You have the latest version of Maxima Fiction Book Editor\./,
      );
      await expect(page.getByTestId('dialog-version-new')).toHaveCount(0);
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

  test('5. the manual command records the check on an answer, newer or latest, never on a failure', async ({
    core,
    page,
    context,
  }) => {
    await recordOutside(context);
    await openApp(core, page);
    expect(await lastCheck(core)).toBeUndefined();

    await core.rpc('test.enqueueRelease', { result: { tag: 'v99.0.1' } });
    await checkVersion(page);
    await page.getByTestId('dialog-version-new-button-no').click();
    await expect.poll(() => lastCheck(core)).toBeDefined();
    const afterNewer = await lastCheck(core);
    expect(isRecent(afterNewer)).toBe(true);

    await core.rpc('test.enqueueRelease', { error: { reason: 'offline' } });
    await checkVersion(page);
    await expect(page.getByTestId('dialog-version-cant-connect')).toBeVisible();
    await page.getByTestId('dialog-version-cant-connect-button-ok').click();
    expect(await lastCheck(core)).toBe(afterNewer);

    await core.rpc('test.enqueueRelease', { result: { tag: `v${RUNNING}` } });
    await checkVersion(page);
    await expect(page.getByTestId('dialog-version-latest')).toBeVisible();
    await page.getByTestId('dialog-version-latest-button-ok').click();
    await expect.poll(() => lastCheck(core)).not.toBe(afterNewer);
    expect(isRecent(await lastCheck(core))).toBe(true);
  });
});

test.describe('US5 (feature 003) - the check for a new version on a schedule', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('1. Settings > Other offers the five schedules, once a month by default; the choice is kept', async ({
    core,
    page,
  }) => {
    await core.rpc('settings.set', { patch: { other: null, session: { lastVersionCheck: null } } });
    expect((await core.rpc<SettingsJson>('settings.get')).other.versionCheck).toBe('monthly');
    await openApp(core, page);
    await openSettings(page);
    await page.getByTestId('settings-tab-other').click();
    const select = page.getByTestId('settings-other-version-check');
    await expect(select).toHaveValue('monthly');
    await expect(select.locator('option')).toHaveText([
      'at every start',
      'once a day',
      'once a week',
      'once a month',
      'never',
    ]);
    await select.selectOption('weekly');
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    expect((await core.rpc<SettingsJson>('settings.get')).other.versionCheck).toBe('weekly');

    // The same choice in Ukrainian.
    await presetSchedule(core, 'never', null);
    await openApp(core, page, 'uk');
    await openSettings(page);
    await page.getByTestId('settings-tab-other').click();
    await expect(page.getByText('Перевірка нової версії')).toBeVisible();
    await expect(page.getByTestId('settings-other-version-check').locator('option')).toHaveText([
      'при кожному запуску',
      'щодня',
      'щотижня',
      'щомісяця',
      'ніколи',
    ]);
    await page.getByTestId('dialog-settings-button-cancel').click();
  });

  test('2. once a week, last check 8 days ago, a newer release: the notice after start-up, the check recorded', async ({
    core,
    page,
    context,
  }) => {
    const outside = await recordOutside(context);
    await presetSchedule(core, 'weekly', ago(8 * DAY));
    await core.rpc('test.enqueueRelease', { result: { tag: 'v99.0.1' } });
    const before = await requestCount(core);
    const startedAt = Date.now();

    await openApp(core, page);
    const offer = page.getByTestId('dialog-version-new');
    await expect(offer).toBeVisible();
    // The notice came after the window became usable: the document is shown under it.
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    await expect(offer).toContainText(
      'A new version of Maxima Fiction Book Editor is available: 99.0.1.',
    );
    await expect(offer).toContainText('Open its page?');
    // The single request, and nothing left the editor's own address.
    expect(await requestCount(core)).toBe(before + 1);
    expect(outside).toEqual([]);
    // The last check is now recorded as today.
    const recorded = await lastCheck(core);
    expect(recorded).toBeDefined();
    expect(Date.parse(recorded!)).toBeGreaterThanOrEqual(startedAt - 1000);
    expect(isRecent(recorded)).toBe(true);

    // Yes opens the release's page in the system browser, as the manual check does.
    const popup = page.waitForEvent('popup');
    await page.getByTestId('dialog-version-new-button-yes').click();
    await popup;
    await expect.poll(() => outside).toEqual([`${RELEASES}v99.0.1`]);
    await expect(offer).toHaveCount(0);
  });

  test('3. once a week, last check 2 days ago: no request, the record untouched', async ({
    core,
    page,
    context,
  }) => {
    const outside = await recordOutside(context);
    const recorded = ago(2 * DAY);
    await presetSchedule(core, 'weekly', recorded);
    const before = await requestCount(core);
    await openApp(core, page);
    // A short journey after start-up: the check would have gone out by now.
    await openAbout(page);
    await page.getByTestId('dialog-about-button-close').click();
    await openSettings(page);
    await page.getByTestId('dialog-settings-button-cancel').click();
    expect(await requestCount(core)).toBe(before);
    expect(await lastCheck(core)).toBe(recorded);
    expect(outside).toEqual([]);
    await expect(page.getByTestId('dialog-version-new')).toHaveCount(0);
  });

  test('4. a due check that finds the latest version shows nothing and records the check', async ({
    core,
    page,
  }) => {
    const recorded = ago(25 * HOUR);
    await presetSchedule(core, 'daily', recorded);
    await core.rpc('test.enqueueRelease', { result: { tag: `v${RUNNING}` } });
    const before = await requestCount(core);
    await openApp(core, page);
    await expect.poll(() => requestCount(core)).toBe(before + 1);
    await expect.poll(() => lastCheck(core)).not.toBe(recorded);
    expect(isRecent(await lastCheck(core))).toBe(true);
    await expect(page.getByTestId('dialog-version-latest')).toHaveCount(0);
    await expect(page.getByTestId('dialog-version-new')).toHaveCount(0);
    await expect(page.getByTestId('dialog-version-cant-connect')).toHaveCount(0);
  });

  test('5. a due check without an answer shows nothing, records nothing, logs no error', async ({
    core,
    page,
  }) => {
    for (const [index, reason] of ['offline', 'timeout', 'http', 'format'].entries()) {
      // No record at all the first time (a fresh start), then an old one.
      const recorded = index === 0 ? null : ago(40 * DAY);
      await presetSchedule(core, 'monthly', recorded);
      await core.rpc('test.enqueueRelease', { error: { reason } });
      const before = await requestCount(core);
      const logBefore = readLog(core).length;
      await openApp(core, page);
      await expect.poll(() => requestCount(core)).toBe(before + 1);
      // A round trip after the failed request: the UI has handled the failure by now.
      await openSettings(page);
      await page.getByTestId('dialog-settings-button-cancel').click();
      expect(await lastCheck(core)).toBe(recorded ?? undefined);
      await expect(page.getByTestId('dialog-version-cant-connect')).toHaveCount(0);
      await expect(page.getByTestId('dialog-version-new')).toHaveCount(0);
      // The core notes the unavailable answer as a warning; the UI logs no error.
      const added = readLog(core).slice(logBefore);
      expect(added.filter((entry) => entry.level === 'error')).toEqual([]);
      expect(added.filter((entry) => entry.source !== 'core')).toEqual([]);
    }
  });

  test('6. "never": no request over a whole journey - start, open a book, Settings', async ({
    core,
    page,
    context,
  }) => {
    const outside = await recordOutside(context);
    await presetSchedule(core, 'never', null);
    const before = await requestCount(core);
    await openApp(core, page);
    const book = fixtureBook('modern-utf8.fb2');
    await core.enqueueDialog('dialog.openFile', { paths: [book] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await waitForBook(page, book);
    await openSettings(page);
    await page.getByTestId('settings-tab-other').click();
    await expect(page.getByTestId('settings-other-version-check')).toHaveValue('never');
    await page.getByTestId('dialog-settings-button-cancel').click();
    await openAbout(page);
    await page.getByTestId('dialog-about-button-close').click();
    expect(await requestCount(core)).toBe(before);
    expect(await lastCheck(core)).toBeUndefined();
    expect(outside).toEqual([]);
  });

  test('7. the notice waits until the dialog open at that moment is closed; the request follows the document', async ({
    core,
    page,
    context,
  }) => {
    await recordOutside(context);
    await presetSchedule(core, 'everyStart', null);
    await core.rpc('test.enqueueRelease', { result: { tag: 'v99.0.1' } });

    // Hold the core's answer to the start-up request until Settings is open, so the notice
    // provably arrives while a modal dialog is up. The page's JSON-RPC frames are relayed
    // through this route; the request order is kept for the second assertion.
    const sent: string[] = [];
    const answer: { deliver: (() => void) | null; held: () => void } = {
      deliver: null,
      held: () => {},
    };
    const held = new Promise<void>((resolve) => {
      answer.held = resolve;
    });
    await page.routeWebSocket(/\/rpc\?/, (ws) => {
      const server = ws.connectToServer();
      let requestId: number | null = null;
      ws.onMessage((message) => {
        if (typeof message === 'string') {
          const request = JSON.parse(message) as { id?: number; method?: string };
          if (request.method) sent.push(request.method);
          if (request.method === 'app.latestRelease') requestId = request.id ?? null;
        }
        server.send(message);
      });
      server.onMessage((message) => {
        if (typeof message === 'string' && requestId !== null) {
          const response = JSON.parse(message) as { id?: number };
          if (response.id === requestId) {
            answer.deliver = () => ws.send(message);
            answer.held();
            return;
          }
        }
        ws.send(message);
      });
    });

    await openApp(core, page);
    await held;
    // The request went out after the start-up document had been asked for.
    expect(sent.indexOf('app.latestRelease')).toBeGreaterThan(sent.indexOf('doc.new'));
    await openSettings(page);
    answer.deliver!();
    // The answer is in: recorded at once ...
    await expect.poll(() => lastCheck(core)).toBeDefined();
    // ... but the notice does not appear over the Settings dialog.
    await expect(page.getByTestId('dialog-version-new')).toHaveCount(0);
    await page.getByTestId('settings-tab-other').click();
    await expect(page.getByTestId('settings-other-version-check')).toHaveValue('everyStart');
    await expect(page.getByTestId('dialog-version-new')).toHaveCount(0);
    await page.getByTestId('dialog-settings-button-cancel').click();
    // Once the dialog is closed, the notice follows.
    const offer = page.getByTestId('dialog-version-new');
    await expect(offer).toBeVisible();
    await expect(offer).toContainText('99.0.1');
    await page.getByTestId('dialog-version-new-button-no').click();
    await expect(offer).toHaveCount(0);
  });

  test('8. the same newer version is announced again at the next due check; a later record counts as now', async ({
    core,
    page,
    context,
  }) => {
    await recordOutside(context);
    // Announced at a due check ...
    await presetSchedule(core, 'daily', ago(2 * DAY));
    await core.rpc('test.enqueueRelease', { result: { tag: 'v99.0.1' } });
    await openApp(core, page);
    await expect(page.getByTestId('dialog-version-new')).toBeVisible();
    await page.getByTestId('dialog-version-new-button-no').click();
    // ... and again at the next one (the record of the first is moved back a day).
    await presetSchedule(core, 'daily', ago(DAY + HOUR));
    await core.rpc('test.enqueueRelease', { result: { tag: 'v99.0.1' } });
    await openApp(core, page);
    await expect(page.getByTestId('dialog-version-new')).toBeVisible();
    await expect(page.getByTestId('dialog-version-new')).toContainText('99.0.1');
    await page.getByTestId('dialog-version-new-button-no').click();

    // A record later than now (the clock was set back): treated as a check made now - no
    // request, and the record is brought back to now.
    const future = ago(-30 * DAY);
    await presetSchedule(core, 'daily', future);
    const before = await requestCount(core);
    await openApp(core, page);
    await expect.poll(() => lastCheck(core)).not.toBe(future);
    expect(isRecent(await lastCheck(core))).toBe(true);
    await openSettings(page);
    await page.getByTestId('dialog-settings-button-cancel').click();
    expect(await requestCount(core)).toBe(before);
    // The queue is left as it was: nothing was asked for.
    await expect(page.getByTestId('dialog-version-new')).toHaveCount(0);
  });

  test('9. a fresh installation and a settings file of release 0.0.2: once a month, and the first start checks', async ({
    browser,
  }) => {
    const binary = process.env.MFBE_CORE_BIN!;
    test.skip(!/mfbe-core/.test(path.basename(binary)), 'needs the real mfbe-core binary');
    const dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us5-'));
    // Two profiles: an empty one, and one whose settings.json predates the schedule setting.
    const fresh = path.join(dir, 'fresh');
    const upgraded = path.join(dir, 'upgraded');
    for (const profile of [fresh, upgraded]) mkdirSync(profile, { recursive: true });
    writeFileSync(
      path.join(upgraded, 'settings.json'),
      JSON.stringify({
        schemaVersion: 1,
        view: { uiLanguage: 'en' },
        other: { defaultEncoding: 'utf-8', keepEncoding: true },
      }),
    );

    for (const profile of [fresh, upgraded]) {
      const second = await startCoreWith(binary, profile, []);
      const url = new URL(second.url);
      const client = new NodeRpcClient(
        `ws://127.0.0.1:${url.port}/rpc?token=${url.searchParams.get('token')}`,
      );
      const context = await browser.newContext();
      try {
        const settings = await client.call<SettingsJson>('settings.get');
        expect(settings.other.versionCheck).toBe('monthly');
        expect(settings.session.lastVersionCheck).toBeUndefined();
        expect(await client.call<NetworkRequest[]>('test.requests')).toEqual([]);
        await client.call('test.enqueueRelease', { result: { tag: 'v99.0.1' } });

        const page = await context.newPage();
        await page.goto(second.url);
        await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
        // The first start checks: the one request, the notice, the record.
        await expect(page.getByTestId('dialog-version-new')).toContainText('99.0.1');
        expect(await client.call<NetworkRequest[]>('test.requests')).toHaveLength(1);
        await page.getByTestId('dialog-version-new-button-no').click();
        const after = await client.call<SettingsJson>('settings.get');
        expect(isRecent(after.session.lastVersionCheck)).toBe(true);
        // The record lives in the profile's settings.json (the data folder of this copy).
        await expect
          .poll(() => readFileSync(path.join(profile, 'settings.json'), 'utf8'))
          .toContain(after.session.lastVersionCheck);
        if (profile === upgraded) expect(after.other).toMatchObject({ keepEncoding: true });
      } finally {
        client.close();
        await context.close();
        await second.stop();
      }
    }
  });
});
