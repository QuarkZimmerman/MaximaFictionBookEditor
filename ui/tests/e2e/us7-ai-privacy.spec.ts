/**
 * User Story 7 (feature 005) - the user knows what leaves the computer (T079; quickstart §7;
 * FR-008, FR-014, FR-021, FR-042, FR-100, FR-105; SC-006, SC-007, SC-010, SC-012). Needs the
 * real core (`MFBE_CORE_BIN`); skipped in core-less mode. Nothing but the stand-in
 * (`fixtures/ai-standin.mjs`, loopback only) is ever contacted (`recordOutside`).
 *
 * Scenarios (spec.md US7):
 *  1. the first-use notice for a *hosted* name - the stand-in under `ai.standin.test:<port>`
 *     through `test.setAiResolve` on a core started with `no_proxy=ai.standin.test`: its exact
 *     content (the service, what leaves - and nothing else -, the terms link by href, the
 *     plain-http sentence for `http://` and not for `https://`), No sends nothing, Yes is
 *     remembered per service **and** host in `settings.json`, listed and revocable in Settings,
 *     shown again after a revocation and after a host change, kept by a second core (SC-006);
 *     the keyboard pass of the notice (FR-105); the same before *Test connection*
 *  2. a loopback address → no notice
 *  3. a request whose tool chain reads three sections → three `tool.call` entries naming the
 *     sections' titles; `request.start` names the outline sent
 *  4. the log scan (SC-007, SC-010): every failure kind provoked - offline, timeout, 401, 404
 *     (model), 429 / 402 / 503 waits, 503, 400 HTML, 200-with-error, format, tls, 3xx, cancel,
 *     rejected, internal - with an instruction holding a unique token, the book's unique
 *     sentence read by a tool, the keys `sk-test-123` / `sk-wrong` / `sk-user` (a user list
 *     entry's key, FR-014) in play; `mfbe-errors.log` then holds one entry per transport failure
 *     with the kind, the host and the status alone, none for the waits, the 3xx, the
 *     200-with-error or the cancel, and nothing of the instruction, the book, the keys, the
 *     service's words, the model or the page token; the `offline` text in the active language
 *     within 2 s (SC-010 - the projects `chromium-ru` / `chromium-uk` run this file)
 *  5. the port scan (SC-012, Linux): the core's one listener is the UI-core loopback link
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import {
  ensureAssistantOn,
  expect,
  fixtureBook,
  NodeRpcClient,
  recordOutside,
  startCoreWith,
  test,
  waitForBook,
  type CoreHandle,
} from './fixtures/core';
import { pageLang, pageText } from './fixtures/i18n';

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/ai-services/', import.meta.url));
const SELECTION_BOOK = fixtureBook('ai-selection.fb2');
const MANY_SECTIONS = fixtureBook('many-sections.fb2');
/** A sentence of `ai-selection.fb2` no other text of the suite holds. */
const UNIQUE_SENTENCE = 'Дорога длинна, а песня коротка.';
const HOSTED_NAME = 'ai.standin.test';
const SECOND_NAME = 'ai2.standin.test';
const TERMS_URL = 'https://ai.standin.test/terms';

interface LastRequest {
  id: string;
  state: string;
  exchanges: number;
  changes: number;
}

interface ActivityRow {
  kind: string;
  request: string;
  text: string;
}

interface LogEntry {
  ts: string;
  level: string;
  source: string;
  code: string;
  message: string;
  context: Record<string, string>;
  stack?: string;
}

interface SettingsJson {
  ai: { mode: string; agreements: { service: string; host: string; at: string }[] };
}

declare const window: {
  __mfbeTest: {
    ai: {
      lastRequest(): LastRequest | null;
      on: boolean;
      failNextTool(n: string, m?: string): boolean;
    };
    scripts: { toXml(): Promise<string> };
  };
};

const lastRequest = (page: Page) =>
  page.evaluate<LastRequest | null>(() => window.__mfbeTest.ai.lastRequest());
const lastRequestId = async (page: Page) => (await lastRequest(page))?.id ?? null;
const documentXml = (page: Page) => page.evaluate(() => window.__mfbeTest.scripts.toXml());

const input = (page: Page) => page.getByTestId('ai-input');
const notice = (page: Page) => page.getByTestId('dialog-ai-notice');

const allActivityRows = (page: Page) =>
  page.evaluate<ActivityRow[]>(`Array.from(
    document.querySelectorAll('[data-testid^="ai-activity-"]'),
    (li) => ({
      kind: li.getAttribute('data-kind'),
      request: li.getAttribute('data-request'),
      text: li.querySelector('.mfbe-ai-activity-text').textContent,
    }),
  )`);

/** The activity rows of the latest request alone, in order. */
async function activityRows(page: Page): Promise<ActivityRow[]> {
  const rows = await allActivityRows(page);
  const last = rows.at(-1)?.request;
  return rows.filter((row) => row.request === last);
}

const messageRows = (page: Page) =>
  page.evaluate<{ role: string; text: string }[]>(`Array.from(
    document.querySelectorAll('[data-testid^="ai-message-"]'),
    (div) => ({
      role: div.getAttribute('data-role'),
      text: div.querySelector('.mfbe-ai-message-text').textContent,
    }),
  )`);

const focusedTestId = (page: Page) =>
  page.evaluate<string | null>(`document.activeElement?.getAttribute('data-testid') ?? null`);

function settingsJson(dataDir: string): SettingsJson {
  return JSON.parse(readFileSync(path.join(dataDir, 'settings.json'), 'utf8')) as SettingsJson;
}

function logFile(core: CoreHandle): string {
  return path.join(core.dataDir!, 'logs', 'mfbe-errors.log');
}

function readLog(core: CoreHandle): LogEntry[] {
  const file = logFile(core);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LogEntry);
}

function logText(core: CoreHandle): string {
  return existsSync(logFile(core)) ? readFileSync(logFile(core), 'utf8') : '';
}

function writeUserFile(dataDir: string, content: string): void {
  writeFileSync(path.join(dataDir, 'ai-services.json'), content);
}

function removeUserFile(dataDir: string): void {
  const file = path.join(dataDir, 'ai-services.json');
  if (existsSync(file)) unlinkSync(file);
}

/** The user list file with one entry `standin` at `address`. */
function standinListFile(address: string): string {
  return JSON.stringify({
    version: 1,
    services: [
      {
        id: 'standin',
        name: 'Stand-in (local)',
        address,
        model: 'standin-chat',
        termsUrl: TERMS_URL,
        limits: { en: 'none', ru: 'нет', uk: 'немає' },
      },
    ],
  });
}

async function setCustomTarget(core: CoreHandle, address: string, key = ''): Promise<void> {
  await core.rpc('settings.set', {
    patch: { ai: { mode: 'custom', custom: { address, key, model: 'standin-chat' } } },
  });
}

async function openBook(core: CoreHandle, page: Page, book: string): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

/**
 * The assistant on: the panel is restored as the session left it (FR-040 as amended, T100) -
 * live already at start, or shown through View → AI Assistant when hidden.
 */
async function turnOn(page: Page): Promise<void> {
  await ensureAssistantOn(page);
}

/** Types the instruction into the panel's field and presses Enter; returns the id to wait past. */
async function send(page: Page, instruction: string): Promise<string | null> {
  const before = await lastRequestId(page);
  await input(page).fill(instruction);
  await input(page).press('Enter');
  return before;
}

async function waitForEnd(
  page: Page,
  before: string | null,
  timeout = 30_000,
): Promise<LastRequest> {
  await expect.poll(() => lastRequestId(page), { timeout }).not.toBe(before);
  await expect(page.getByTestId('ai-send')).toBeVisible({ timeout });
  await expect(page.getByTestId('script-run-banner')).toHaveCount(0, { timeout });
  return (await lastRequest(page))!;
}

async function sendAndWait(page: Page, instruction: string, timeout?: number) {
  const before = await send(page, instruction);
  return waitForEnd(page, before, timeout);
}

/** Tools > Settings > the AI assistant page. */
async function openAiPage(page: Page): Promise<Locator> {
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-settings').click();
  await expect(page.getByTestId('dialog-settings')).toBeVisible();
  await page.getByTestId('settings-tab-ai').click();
  const aiPage = page.getByTestId('settings-page-ai');
  await expect(aiPage).toBeVisible();
  await expect(page.getByTestId('settings-ai-service').locator('option').first()).toBeAttached();
  return aiPage;
}

async function cancelSettings(page: Page): Promise<void> {
  await page.getByTestId('dialog-settings-button-cancel').click();
  await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
}

/** The exact content of the notice (FR-021): what leaves the computer and nothing else. */
async function expectNoticeContent(page: Page, options: { unencrypted: boolean }): Promise<void> {
  await expect(notice(page)).toBeVisible();
  await expect(page.getByTestId('dialog-ai-notice-service')).toContainText('Stand-in (local)');
  const sent = page.getByTestId('dialog-ai-notice-sent');
  const items = sent.locator('li');
  await expect(items).toHaveCount(5);
  const expected: string[] = [];
  for (const item of ['instruction', 'conversation', 'outline', 'parts', 'editor']) {
    expected.push(await pageText(page, `ai.notice.sent.${item}`));
  }
  expect(await items.allTextContents()).toEqual(expected);
  expect((await sent.textContent())!.trim()).toBe(
    `${await pageText(page, 'ai.notice.sentIntro')}${expected.join('')}`,
  );
  await expect(page.getByTestId('dialog-ai-notice-terms')).toHaveAttribute('href', TERMS_URL);
  await expect(page.getByTestId('dialog-ai-notice-unencrypted')).toHaveCount(
    options.unencrypted ? 1 : 0,
  );
}

/* ------------------------------------------------------------------------ */
/* Scenario 1: the notice for a hosted name                                  */
/* ------------------------------------------------------------------------ */

test.describe('US7 (005) - the first-use notice for a hosted name', () => {
  // A core of its own: `no_proxy` keeps a runner's proxy away from the hosted name.
  test.use({ coreEnv: { no_proxy: `${HOSTED_NAME},${SECOND_NAME}` } });
  let outside: string[] = [];

  test.beforeEach(async ({ core, standin, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    outside = await recordOutside(context);
    await standin.reset();
    await core.rpc('settings.set', { patch: { ai: null } });
    writeUserFile(core.dataDir!, standinListFile(`http://${HOSTED_NAME}:${standin.port}/v1`));
    await core.rpc('ai.reloadServices');
    await core.setAiResolve([`${HOSTED_NAME}:${standin.port}:127.0.0.1`]);
    await core.resetAiRequests();
    await core.rpc('settings.set', { patch: { ai: { mode: 'free', freeServiceId: 'standin' } } });
  });

  test.afterEach(() => {
    expect(outside).toEqual([]);
  });

  test('1. Send: the notice names what leaves; No sends nothing; Yes is remembered per service and host, listed, revocable, asked again after a host change and kept by a second core; the keyboard pass', async ({
    core,
    page,
    standin,
  }) => {
    const host = `${HOSTED_NAME}:${standin.port}`;
    await openBook(core, page, SELECTION_BOOK);
    await turnOn(page);

    // The notice before the first request: its exact content.
    await input(page).fill('Say hello');
    await input(page).press('Enter');
    await expectNoticeContent(page, { unencrypted: true });

    // No: nothing is sent - no stand-in request, no core record at all, nothing in the panel.
    await page.getByTestId('dialog-ai-notice-button-no').click();
    await expect(notice(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await standin.requests()).toEqual([]);
    expect(await core.aiRequests()).toEqual([]);
    await expect(page.locator('[data-testid^="ai-message-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="ai-activity-"]')).toHaveCount(0);
    expect(settingsJson(core.dataDir!).ai.agreements).toEqual([]);
    await expect(input(page)).toHaveValue('Say hello'); // the instruction comes back

    // Yes: the request goes, the agreement is written with the service and the host.
    await standin.scenario({ text: 'Hello!' });
    let before = await lastRequestId(page);
    await input(page).press('Enter');
    await expect(notice(page)).toBeVisible();
    await page.getByTestId('dialog-ai-notice-button-yes').click();
    await expect(notice(page)).toHaveCount(0);
    let ended = await waitForEnd(page, before);
    expect(ended.state).toBe('answered');
    expect(await standin.requests()).toHaveLength(1);
    const agreements = settingsJson(core.dataDir!).ai.agreements;
    expect(agreements).toHaveLength(1);
    expect(agreements[0]).toMatchObject({ service: 'standin', host });
    expect(Date.parse(agreements[0]!.at)).not.toBeNaN();
    expect(agreements[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

    // A second request: no notice.
    await standin.scenario({ text: 'Again.' });
    before = await send(page, 'Say it again');
    await page.waitForTimeout(300);
    await expect(notice(page)).toHaveCount(0);
    ended = await waitForEnd(page, before);
    expect(ended.state).toBe('answered');
    expect(await standin.requests()).toHaveLength(2);

    // Settings lists the agreement; Withdraw removes it (FR-008) - the notice is due again.
    await openAiPage(page);
    const list = page.getByTestId('settings-ai-agreements');
    await expect(list).toContainText('Stand-in (local)');
    await expect(list).toContainText(host);
    const revoke = page.getByTestId('settings-ai-agreement-standin-revoke');
    await expect(revoke).toBeVisible();
    await revoke.click();
    await expect(revoke).toHaveCount(0);
    await expect.poll(() => settingsJson(core.dataDir!).ai.agreements).toEqual([]);
    await cancelSettings(page);

    // The notice again - and its keyboard pass (FR-105): Escape is No; Tab reaches the link,
    // No and Yes; Enter decides.
    await standin.scenario({ text: 'Third.' });
    before = await send(page, 'Once more');
    await expect(notice(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(notice(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(await standin.requests()).toHaveLength(2);
    expect(await lastRequestId(page)).toBe(before);
    await input(page).press('Enter');
    await expect(notice(page)).toBeVisible();
    const reached = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      const id = await focusedTestId(page);
      if (id) reached.add(id);
      await page.keyboard.press('Tab');
    }
    expect([...reached]).toEqual(
      expect.arrayContaining([
        'dialog-ai-notice-terms',
        'dialog-ai-notice-button-no',
        'dialog-ai-notice-button-yes',
      ]),
    );
    // Enter on No decides No; Enter on Yes decides Yes.
    for (let i = 0; i < 8 && (await focusedTestId(page)) !== 'dialog-ai-notice-button-no'; i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(page.getByTestId('dialog-ai-notice-button-no')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(notice(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(await standin.requests()).toHaveLength(2);
    await input(page).press('Enter');
    await expect(notice(page)).toBeVisible();
    for (
      let i = 0;
      i < 8 && (await focusedTestId(page)) !== 'dialog-ai-notice-button-yes';
      i += 1
    ) {
      await page.keyboard.press('Tab');
    }
    await expect(page.getByTestId('dialog-ai-notice-button-yes')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(notice(page)).toHaveCount(0);
    ended = await waitForEnd(page, before);
    expect(ended.state).toBe('answered');
    expect(await standin.requests()).toHaveLength(3);
    expect(settingsJson(core.dataDir!).ai.agreements).toMatchObject([{ service: 'standin', host }]);

    // Host change (review B4): the entry now points at another name; `standin` is agreed, the
    // host differs → the notice again; Yes updates the agreement's host in place.
    const secondHost = `${SECOND_NAME}:${standin.port}`;
    writeUserFile(core.dataDir!, standinListFile(`http://${SECOND_NAME}:${standin.port}/v1`));
    await core.rpc('ai.reloadServices');
    await core.setAiResolve([
      `${HOSTED_NAME}:${standin.port}:127.0.0.1`,
      `${SECOND_NAME}:${standin.port}:127.0.0.1`,
    ]);
    await standin.scenario({ text: 'Moved.' });
    before = await send(page, 'After the move');
    await expect(notice(page)).toBeVisible();
    await expect(page.getByTestId('dialog-ai-notice-service')).toContainText(secondHost);
    await page.getByTestId('dialog-ai-notice-button-yes').click();
    ended = await waitForEnd(page, before);
    expect(ended.state).toBe('answered');
    expect(await standin.requests()).toHaveLength(4);
    const updated = settingsJson(core.dataDir!).ai.agreements;
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ service: 'standin', host: secondHost });

    // SC-006: a second core on the same data directory reads the same agreement.
    const second = await startCoreWith(process.env.MFBE_CORE_BIN!, core.dataDir!, [], {
      env: { no_proxy: `${HOSTED_NAME},${SECOND_NAME}` },
    });
    try {
      const parsed = new URL(second.url);
      const client = new NodeRpcClient(
        `ws://127.0.0.1:${parsed.port}/rpc?token=${parsed.searchParams.get('token') ?? ''}`,
      );
      const settings = await client.call<SettingsJson>('settings.get');
      client.close();
      expect(settings.ai.agreements).toMatchObject([{ service: 'standin', host: secondHost }]);
    } finally {
      await second.stop();
    }

    // The recorded requests of the whole journey: the host, never a key, a body or the model.
    const records = JSON.stringify(await core.aiRequests());
    expect(records).toContain(HOSTED_NAME);
    expect(records).not.toContain('standin-chat');
    expect(records).not.toContain('Say hello');
  });

  test('1b. Test connection: the notice first, No sends nothing; an https name shows no plain-http sentence', async ({
    core,
    page,
    standin,
  }) => {
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    await openAiPage(page);
    await page.getByTestId('settings-ai-service').selectOption('standin');
    await page.getByTestId('settings-ai-test').click();
    await expectNoticeContent(page, { unencrypted: true });
    await page.getByTestId('dialog-ai-notice-button-no').click();
    await expect(notice(page)).toHaveCount(0);
    await expect(page.getByTestId('settings-ai-status')).toHaveAttribute('data-status', 'untested');
    await page.waitForTimeout(300);
    expect(await standin.requests()).toEqual([]);
    expect(await core.aiRequests()).toEqual([]);
    expect(settingsJson(core.dataDir!).ai.agreements).toEqual([]);
    await cancelSettings(page);

    // The same entry under an `https://` name: the notice without the unencrypted sentence
    // (the request itself would fail with `tls` against the plain stand-in - not asserted here).
    writeUserFile(core.dataDir!, standinListFile(`https://${HOSTED_NAME}:${standin.port}/v1`));
    await core.rpc('ai.reloadServices');
    await openAiPage(page);
    await page.getByTestId('settings-ai-service').selectOption('standin');
    await page.getByTestId('settings-ai-test').click();
    await expectNoticeContent(page, { unencrypted: false });
    await page.getByTestId('dialog-ai-notice-button-no').click();
    await expect(notice(page)).toHaveCount(0);
    await cancelSettings(page);
    expect(await standin.requests()).toEqual([]);
    expect(await core.aiRequests()).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* Scenarios 2-5 on the worker's core: the loopback stand-in                   */
/* ------------------------------------------------------------------------ */

test.describe('US7 (005) - the activity record, the log scan and the port scan', () => {
  let outside: string[] = [];

  test.beforeEach(async ({ core, standin, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    outside = await recordOutside(context);
    await standin.reset();
    await core.resetAiRequests();
    await core.setAiResolve([]);
    await core.setAiTimeouts(20_000, 120_000);
    await core.rpc('settings.set', { patch: { ai: null } });
    removeUserFile(core.dataDir!);
    await core.rpc('ai.reloadServices');
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    expect(outside).toEqual([]);
    await core.setAiTimeouts(20_000, 120_000).catch(() => {});
    await core.rpc('settings.set', { patch: { ai: null } }).catch(() => {});
  });

  test('2+3. a loopback address asks nothing; a chain reading three sections names them in the activity list', async ({
    core,
    page,
    standin,
  }) => {
    await setCustomTarget(core, `${standin.url}/v1`);
    await openBook(core, page, MANY_SECTIONS);
    await turnOn(page);
    await standin.scenarios([
      { toolCalls: [{ id: 'c1', name: 'read_part', arguments: { node: 'body[1]/section[1]' } }] },
      { toolCalls: [{ id: 'c2', name: 'read_part', arguments: { node: 'body[1]/section[2]' } }] },
      { toolCalls: [{ id: 'c3', name: 'read_part', arguments: { node: 'body[1]/section[3]' } }] },
      { text: 'Прочитал три главы.' },
    ]);
    const before = await send(page, 'Read the first three chapters');
    await page.waitForTimeout(300);
    await expect(notice(page)).toHaveCount(0); // scenario 2: loopback, no notice
    const ended = await waitForEnd(page, before);
    expect(ended.state).toBe('answered');
    expect(await standin.requests()).toHaveLength(4);

    const rows = await activityRows(page);
    const calls = rows.filter((row) => row.kind === 'tool.call');
    expect(calls).toHaveLength(3);
    const sectionName = await pageText(page, 'ai.activity.element.section');
    for (const [index, title] of ['Глава 1', 'Глава 2', 'Глава 3'].entries()) {
      expect(calls[index]!.text).toContain(`${sectionName} ${index + 1} "${title}"`);
      expect(calls[index]!.text).toMatch(/\(\d+ /); // the characters read
    }
    // The first line names what the first exchange carried: the outline with its sections
    // (every `<section>` of the book, nested ones included).
    const sections = (readFileSync(MANY_SECTIONS, 'utf8').match(/<section\b/g) ?? []).length;
    expect(sections).toBeGreaterThan(3);
    const start = rows.find((row) => row.kind === 'request.start')!;
    expect(start.text).toContain(
      await pageText(page, 'ai.activity.sentOutline', { count: sections }),
    );
    // Nothing of the sections' text is in the record.
    const record = rows.map((row) => row.text).join('\n');
    expect(record).not.toContain('Текст');
    expect(settingsJson(core.dataDir!).ai.agreements).toEqual([]);
  });

  test('SC-010: with the service unreachable the request fails within 2 s with the offline text of the active language', async ({
    core,
    page,
  }) => {
    // Connection refused: nothing listens on port 1.
    await setCustomTarget(core, 'http://127.0.0.1:1/v1');
    await openBook(core, page, SELECTION_BOOK);
    await turnOn(page);
    const offlineText = await pageText(page, 'ai.failure.offline');
    const started = Date.now();
    const before = await send(page, 'Hello?');
    const failure = page.locator('[data-testid^="ai-message-"][data-role="notice"]').last();
    await expect(failure).toContainText(offlineText, { timeout: 2000 });
    expect(Date.now() - started).toBeLessThan(2000 + 500);
    const ended = await waitForEnd(page, before);
    expect(ended.state).toBe('failed');
    const text = (await failure.textContent()) ?? '';
    expect(text).not.toContain('CURLE_');
    // No English fallback in the other languages (SC-010: the message in the user's language).
    if ((await pageLang(page)) !== 'en') {
      expect(text).not.toContain('The service could not be reached');
    }
    // The editor's other functions behave as before: the document is editable and unchanged.
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    await expect(page.getByTestId('script-run-banner')).toHaveCount(0);
  });

  test('4. the log scan: every failure kind, then the log holds kinds, hosts and statuses alone (SC-007)', async ({
    core,
    page,
    standin,
    uiLang,
  }) => {
    test.skip(uiLang !== undefined, 'the log does not depend on the interface language');
    test.setTimeout(240_000);
    const token = `aiq-${crypto.randomUUID()}`;
    const instruction = (what: string) => `${what} ${token}`;
    const consoleLines: string[] = [];
    page.on('console', (message) => consoleLines.push(message.text()));
    page.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));
    const logBefore = readLog(core).length;
    const standinAddress = `${standin.url}/v1`;
    const standinHost = `127.0.0.1:${standin.port}`;
    const KEY = 'sk-test-123';

    await setCustomTarget(core, standinAddress, KEY);
    await openBook(core, page, SELECTION_BOOK);
    const xmlBefore = await documentXml(page);
    expect(xmlBefore).toContain(UNIQUE_SENTENCE);
    await turnOn(page);
    const lastNotice = async () => {
      const messages = await messageRows(page);
      return messages.at(-1)!;
    };
    const failureKindText = (kind: string) => pageText(page, `ai.failure.${kind}`);

    // offline: connection refused.
    await setCustomTarget(core, 'http://127.0.0.1:1/v1', KEY);
    let ended = await sendAndWait(page, instruction('Offline'));
    expect(ended.state).toBe('failed');
    expect((await lastNotice()).text).toContain(await failureKindText('offline'));

    // timeout: the stand-in holds the answer past the total time-out.
    await setCustomTarget(core, standinAddress, KEY);
    await core.setAiTimeouts(20_000, 2_000);
    await standin.scenario({ text: 'late', delayMs: 5000 });
    ended = await sendAndWait(page, instruction('Timeout'));
    expect(ended.state).toBe('failed');
    expect((await lastNotice()).text).toContain(await failureKindText('timeout'));
    await core.setAiTimeouts(20_000, 120_000);
    await standin.reset();

    // http 401: the key mode refuses `sk-wrong` - the service's words shown with the key masked.
    await setCustomTarget(core, standinAddress, 'sk-wrong');
    await standin.scenario({ keyRequired: 'sk-right' });
    ended = await sendAndWait(page, instruction('Wrong key'));
    expect(ended.state).toBe('failed');
    let text = (await lastNotice()).text;
    expect(text).toContain(await failureKindText('auth'));
    expect(text).toContain('Incorrect API key provided: •••');
    expect(text).not.toContain('sk-wrong');
    expect((await activityRows(page)).at(-1)!.text).not.toContain('sk-wrong');
    await expect(page.getByTestId('ai-settings-link')).toBeVisible();
    await standin.reset();
    await setCustomTarget(core, standinAddress, KEY);

    // http 404 of the model class: the service's words, logged once as ai.http 404.
    await standin.scenario({
      status: 404,
      body: { error: { message: 'The model `nope` does not exist', code: 'model_not_found' } },
    });
    ended = await sendAndWait(page, instruction('No model'));
    expect(ended.state).toBe('failed');
    text = (await lastNotice()).text;
    expect(text).toContain(await failureKindText('model'));
    expect(text).toContain('The model `nope` does not exist');
    await expect(page.getByTestId('ai-settings-link')).toBeVisible();

    // 429 with a 2 s wait, then a read of the section holding the unique sentence (chapter
    // three's epigraph), then success.
    await standin.scenarios([
      { status: 429, retryAfter: 2 },
      { toolCalls: [{ id: 'r1', name: 'read_part', arguments: { node: 'body[1]/section[3]' } }] },
      { text: 'Готово.' },
    ]);
    const limitStarted = Date.now();
    ended = await sendAndWait(page, instruction('Read chapter three'));
    expect(ended.state).toBe('answered');
    expect(Date.now() - limitStarted).toBeGreaterThanOrEqual(1500);
    const read = (await activityRows(page)).filter((row) => row.kind === 'tool.call');
    expect(read).toHaveLength(1);
    expect(read[0]!.text).not.toContain(UNIQUE_SENTENCE);
    // The sentence did travel: the stand-in saw it in the tool result.
    const bodies = JSON.stringify((await standin.requests()).map((r) => r.body));
    expect(bodies).toContain(UNIQUE_SENTENCE);
    expect(bodies).toContain(token);
    await standin.reset();

    // 402 with a wait, 503 with Retry-After: waits, not failures (not logged).
    await standin.scenarios([{ status: 402, retryAfter: 1 }, { text: 'After 402.' }]);
    ended = await sendAndWait(page, instruction('Quota'));
    expect(ended.state).toBe('answered');
    await standin.scenarios([{ status: 503, retryAfter: 1 }, { text: 'After 503.' }]);
    ended = await sendAndWait(page, instruction('Overloaded with a wait'));
    expect(ended.state).toBe('answered');

    // 503 without Retry-After: a failure, logged once with status 503.
    await standin.scenarios([{ status: 503 }, { text: 'unused' }]);
    ended = await sendAndWait(page, instruction('Overloaded'));
    expect(ended.state).toBe('failed');
    expect((await lastNotice()).text).toContain('The stand-in is overloaded.');
    await standin.reset();

    // 400 with an HTML body: reduced through the inert document, logged once with status 400.
    await standin.scenarios([
      {
        status: 400,
        contentType: 'text/html',
        body: '<html><head><title>400 Bad Request</title></head><body><pre>Bad request html body</pre><script>document.title="pwned"</script></body></html>',
      },
      { text: 'unused' },
    ]);
    ended = await sendAndWait(page, instruction('Html'));
    expect(ended.state).toBe('failed');
    text = (await lastNotice()).text;
    expect(text).toContain('Bad request html body');
    expect(text).not.toContain('<pre>');
    await expect(page).not.toHaveTitle(/pwned/);
    await standin.reset();

    // 200 with an error body: a service failure for the UI, an `ok` outcome for the core.
    await standin.scenarios([
      { status: 200, body: { error: { message: 'two hundred error text' } } },
    ]);
    ended = await sendAndWait(page, instruction('Two hundred'));
    expect(ended.state).toBe('failed');
    expect((await lastNotice()).text).toContain('two hundred error text');
    await standin.reset();

    // format: a 200 that is not JSON.
    await standin.scenarios([{ status: 200, contentType: 'text/plain', body: 'not json at all' }]);
    ended = await sendAndWait(page, instruction('Not json'));
    expect(ended.state).toBe('failed');
    expect((await lastNotice()).text).toContain(await failureKindText('format'));
    await standin.reset();

    // tls: https against the plain stand-in.
    await setCustomTarget(core, `https://127.0.0.1:${standin.port}/v1`, KEY);
    ended = await sendAndWait(page, instruction('Tls'));
    expect(ended.state).toBe('failed');
    expect((await lastNotice()).text).toContain(await failureKindText('tls'));
    await setCustomTarget(core, standinAddress, KEY);
    await standin.reset();

    // 3xx: the redirect the editor refuses to follow - a normal http outcome, not logged.
    await standin.scenarios([
      {
        status: 302,
        contentType: 'text/plain',
        body: '',
        headers: { Location: 'http://127.0.0.1:1/elsewhere' },
      },
      { text: 'unused' },
    ]);
    ended = await sendAndWait(page, instruction('Redirect'));
    expect(ended.state).toBe('failed');
    expect((await lastNotice()).text).toContain(await failureKindText('redirect'));
    await standin.reset();

    // cancelled: Stop during a held exchange.
    await standin.scenario({ text: 'late', delayMs: 8000 });
    const cancelBefore = await send(page, instruction('Cancel me'));
    await expect(page.getByTestId('ai-stop')).toBeVisible();
    await page.getByTestId('ai-stop').click();
    ended = await waitForEnd(page, cancelBefore);
    expect(ended.state).toBe('cancelled');
    await standin.reset();

    // rejected: the same change refused three times (three malformed replacements).
    const malformed = (id: string) => ({
      toolCalls: [
        {
          id,
          name: 'replace_node',
          arguments: {
            node: 'body[1]/section[1]/p[2]',
            content: { xml: '<p>Незакрытый <emphasis>абзац</p>' },
          },
        },
      ],
    });
    await standin.scenarios([
      malformed('m1'),
      malformed('m2'),
      malformed('m3'),
      { text: 'unused' },
    ]);
    ended = await sendAndWait(page, instruction('Rewrite'));
    expect(ended.state).toBe('rejected');
    expect(await documentXml(page)).toBe(xmlBefore);
    await standin.reset();

    // internal: a tool made to throw inside the loop (review C17) - the UI's one log line
    // holds the code and the error's name, the console nothing of the message.
    const secret = `secret-${crypto.randomUUID()}`;
    expect(
      await page.evaluate<boolean, string>(
        (s) => window.__mfbeTest.ai.failNextTool('get_outline', s),
        secret,
      ),
    ).toBe(true);
    await standin.scenarios([
      { toolCalls: [{ name: 'get_outline', arguments: {} }] },
      { text: 'x' },
    ]);
    ended = await sendAndWait(page, instruction('Internal'));
    expect(ended.state).toBe('failed');
    text = (await lastNotice()).text;
    expect(text).toContain(await failureKindText('internal'));
    expect(text).not.toContain(secret);
    expect(await documentXml(page)).toBe(xmlBefore);
    await standin.reset();

    // FR-014: a user list entry with its own key - the key goes with the request
    // (`authorization: present`), the page names it as ••• and never shows it.
    writeUserFile(
      core.dataDir!,
      readFileSync(path.join(FIXTURES, 'user-with-key.json'), 'utf8').replace(
        /127\.0\.0\.1:8787/g,
        standinHost,
      ),
    );
    await core.rpc('ai.reloadServices');
    await core.rpc('settings.set', { patch: { ai: { mode: 'free', freeServiceId: 'keyed' } } });
    await standin.scenarios([{ keyRequired: 'sk-user' }, { text: 'Keyed answer.' }]);
    ended = await sendAndWait(page, instruction('With the user key'));
    expect(ended.state).toBe('answered');
    const keyed = await standin.requests();
    expect(keyed).toHaveLength(1);
    expect(keyed[0]!.headers.authorization).toBe('present');
    expect(JSON.stringify(keyed)).not.toContain('sk-user');
    await openAiPage(page);
    await expect(page.getByTestId('settings-ai-service')).toHaveValue('keyed');
    await expect(page.getByTestId('settings-ai-entry-key')).toContainText('•••');
    expect(await page.getByTestId('settings-page-ai').textContent()).not.toContain('sk-user');
    expect(await page.content()).not.toContain('sk-user');
    await cancelSettings(page);
    await standin.reset();
    removeUserFile(core.dataDir!);
    await core.rpc('ai.reloadServices');
    await setCustomTarget(core, standinAddress, KEY);

    // The whole page never showed a key.
    const shown = await page.content();
    for (const key of [KEY, 'sk-wrong', 'sk-user']) expect(shown, key).not.toContain(key);

    /* ------------------------------------------------ the log (SC-007) */

    await expect
      .poll(
        () =>
          readLog(core)
            .slice(logBefore)
            .filter((e) => e.code === 'ai.internal').length,
        {
          timeout: 10_000,
        },
      )
      .toBe(1);
    const entries = readLog(core).slice(logBefore);
    const ai = entries.filter((entry) => entry.code.startsWith('ai.'));
    const byKind = (code: string, status?: string) =>
      ai.filter(
        (entry) => entry.code === code && (status === undefined || entry.context.status === status),
      );
    expect(byKind('ai.offline'), JSON.stringify(ai)).toHaveLength(1);
    expect(byKind('ai.timeout'), JSON.stringify(ai)).toHaveLength(1);
    expect(byKind('ai.tls'), JSON.stringify(ai)).toHaveLength(1);
    expect(byKind('ai.http', '401'), JSON.stringify(ai)).toHaveLength(1);
    expect(byKind('ai.http', '404'), JSON.stringify(ai)).toHaveLength(1);
    expect(byKind('ai.http', '503'), JSON.stringify(ai)).toHaveLength(1);
    expect(byKind('ai.http', '400'), JSON.stringify(ai)).toHaveLength(1);
    expect(byKind('ai.format'), JSON.stringify(ai)).toHaveLength(1);
    expect(byKind('ai.internal'), JSON.stringify(ai)).toHaveLength(1);
    // Nothing for the waits, the 3xx, the 200-with-error (an `ok` outcome for the core - the
    // `format` line of the non-JSON 200 is the one entry with that status) or the cancel.
    for (const status of ['429', '402', '302']) {
      expect(
        ai.filter((entry) => entry.context.status === status),
        status,
      ).toEqual([]);
    }
    expect(byKind('ai.http', '200')).toEqual([]);
    expect(byKind('ai.cancelled')).toEqual([]);
    expect(ai.filter((entry) => entry.code === 'ai.http')).toHaveLength(4);
    expect(ai).toHaveLength(9);
    // Every core entry: a warning, the fixed message, the context {method, targetKind, host,
    // status?} (plus the logger's own `version` and `platform`, on every entry of the log)
    // and nothing else.
    for (const entry of ai.filter((e) => e.source === 'core')) {
      expect(entry.level).toBe('warning');
      expect(entry.message).toBe('AI request failed');
      expect(entry.stack).toBeUndefined();
      const keys = Object.keys(entry.context)
        .filter((key) => key !== 'version' && key !== 'platform')
        .sort();
      expect(keys, JSON.stringify(entry)).toEqual(
        entry.code === 'ai.http' || entry.code === 'ai.format'
          ? ['host', 'method', 'status', 'targetKind']
          : ['host', 'method', 'targetKind'],
      );
      expect(entry.context.method).toBe('ai.complete');
      expect(entry.context.targetKind).toBe('custom');
      expect([standinHost, '127.0.0.1:1']).toContain(entry.context.host);
    }
    expect(byKind('ai.offline')[0]!.context.host).toBe('127.0.0.1:1');
    // The UI's internal line: the code, the error's name, no stack, no message.
    const internal = byKind('ai.internal')[0]!;
    expect(internal.source).toBe('ui');
    expect(internal.message).toBe('Error');
    expect(internal.stack).toBeUndefined();

    // The whole text of the log: nothing of the instruction, the book, the keys, the service's
    // words, the model, the page token, the address path.
    const added = logText(core)
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .slice(logBefore)
      .join('\n');
    for (const forbidden of [
      token,
      UNIQUE_SENTENCE,
      KEY,
      'sk-wrong',
      'sk-user',
      secret,
      'Incorrect API key',
      'The model `nope`',
      'overloaded',
      'Bad request html',
      'two hundred error',
      'not json at all',
      'standin-chat',
      core.token!,
      '/v1/chat/completions',
      'elsewhere',
    ]) {
      expect(added, forbidden).not.toContain(forbidden);
    }
    // The console held nothing of the exception's words or the instruction either.
    const consoleText = consoleLines.join('\n');
    expect(consoleText).not.toContain(secret);
    expect(consoleText).not.toContain(token);
    expect(consoleText).not.toContain(KEY);

    // The core's request records: hosts, kinds and statuses - no key, body or model.
    const records = await core.aiRequests();
    expect(records.length).toBeGreaterThanOrEqual(15);
    const recordText = JSON.stringify(records);
    for (const forbidden of [KEY, 'sk-wrong', 'sk-user', 'standin-chat', token, UNIQUE_SENTENCE]) {
      expect(recordText, forbidden).not.toContain(forbidden);
    }
    expect(records.some((r) => r.outcome === 'offline' && r.host === '127.0.0.1:1')).toBe(true);
    expect(records.some((r) => r.outcome === 'cancelled')).toBe(true);
    expect(records.every((r) => !('body' in r) && !('key' in r) && !('model' in r))).toBe(true);
    expect(await documentXml(page)).toBe(xmlBefore);
  });

  test('5. the port scan (SC-012): the core listens on the UI-core loopback link and nowhere else', async ({
    core,
    page,
    standin,
    uiLang,
  }) => {
    test.skip(process.platform !== 'linux', '/proc is Linux');
    test.skip(uiLang !== undefined, 'the listeners do not depend on the interface language');
    await setCustomTarget(core, `${standin.url}/v1`);
    await openBook(core, page, SELECTION_BOOK);
    await turnOn(page);
    await standin.scenario({ text: 'Done.' });
    const ended = await sendAndWait(page, 'Anything');
    expect(ended.state).toBe('answered');

    const info = await core.rpc<{ pid: number; port: number }>('app.info');
    expect(info.pid).toBeGreaterThan(0);
    expect(info.port).toBe(core.port);
    // The socket inodes the core process holds.
    const inodes = new Set<string>();
    for (const fd of readdirSync(`/proc/${info.pid}/fd`)) {
      let link: string;
      try {
        link = readlinkSync(`/proc/${info.pid}/fd/${fd}`);
      } catch {
        continue;
      }
      const match = /^socket:\[(\d+)\]$/.exec(link);
      if (match) inodes.add(match[1]!);
    }
    expect(inodes.size).toBeGreaterThan(0);
    // The listening TCP sockets (state 0A) among them.
    const listeners: { local: string; inode: string }[] = [];
    for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
      if (!existsSync(table)) continue;
      for (const line of readFileSync(table, 'utf8').split('\n').slice(1)) {
        const columns = line.trim().split(/\s+/);
        if (columns.length < 10) continue;
        const [, local, , state] = columns;
        const inode = columns[9]!;
        if (state === '0A' && inodes.has(inode)) listeners.push({ local: local!, inode });
      }
    }
    expect(listeners, JSON.stringify(listeners)).toHaveLength(1);
    expect(listeners[0]!.local).toBe(
      `0100007F:${info.port.toString(16).toUpperCase().padStart(4, '0')}`,
    );

    // The recorded requests carry no docId, path, key, authors or genres (review C14).
    const bodies = (await standin.requests()).map(
      (r) => r.body as { messages: { role: string; content: string }[] },
    );
    expect(bodies).toHaveLength(1);
    const system = bodies[0]!.messages[0]!;
    expect(system.role).toBe('system');
    expect(system.content).not.toContain('"authors"');
    expect(system.content).not.toContain('"genres"');
    const serialised = JSON.stringify(bodies);
    expect(serialised).not.toContain('docId');
    expect(serialised).not.toContain('ai-selection.fb2');
    expect(serialised).not.toContain('"key"');
    expect(JSON.stringify(await core.aiRequests())).not.toContain('standin-chat');
  });
});
