/**
 * User Story 8 (feature 005) - use my own service and key (T084; quickstart §8).
 *
 * Tagged `@platform`: the whole file runs on the Linux, Windows and macOS e2e legs of CI - the
 * own-key path (UI -> core -> libcurl -> the key-demanding loopback stand-in) once per
 * operating system. Needs the real core (`MFBE_CORE_BIN`); skipped in core-less mode. Nothing
 * but the stand-in (`fixtures/ai-standin.mjs`, loopback only) is ever contacted: the custom
 * address names it directly, and a hosted name is given to it by `test.setAiResolve`.
 *
 * Scenarios (spec.md US8; FR-003, FR-004, FR-006, FR-009, FR-014, FR-021, FR-024; SC-006,
 * SC-014):
 *  - the fields: the OpenAI default with the placeholder naming both examples, the masked key
 *    with its reveal toggle (FR-003); draft testing - Fetch models and Test connection call
 *    `ai.models` / `ai.test` with the draft triple and nothing is saved before OK (review A1)
 *  6. the status red -> green -> red (after an edit) -> green (the same values again, no new
 *     test) computed on the page; OK writes the triple with `ai.customVerified` (the
 *     fingerprint recomputed by the journey); a forged record is stored empty by the core; a
 *     failed test shows the service's words (FR-009, SC-014)
 *  - jobs (review A4): Cancel while a test runs cancels the job and saves nothing
 *  3. Fetch models: the list offered, none -> a typed name, a non-list -> the format message
 *  4. a wrong or missing key: Test connection and a popup request refused in the stand-in's
 *     words (the key masked), the link to the settings page, the XML unchanged (FR-024)
 *  5. a local address with an empty key: no notice, success, no Authorization header
 *  7. a plain `http` address off this computer: the warning on the page, none for https or
 *     a local address; under a hosted name the notice before Fetch models and Test connection
 *     with the unencrypted sentence, No sends nothing, Yes is recorded as `custom:<address>`
 *  - the Disabled exception (review A5): Test connection works on a draft while `disabled` is
 *    saved
 *  - FR-014: a user list entry with a key - masked marker, the key sent and never shown
 *  1+2. the triple survives a restart and a copied data directory, the key masked, used
 */

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Browser, Locator, Page } from '@playwright/test';

import {
  ensureAssistantOn,
  expect,
  fixtureBook,
  NodeRpcClient,
  recordOutside,
  startCoreWith,
  startStandin,
  test,
  waitForBook,
  withUiLang,
  type CoreHandle,
  type StandinHandle,
} from './fixtures/core';
import { pageText, type UiLang } from './fixtures/i18n';

/* ------------------------------------------------------------------------ */
/* Fixtures and helpers                                                     */
/* ------------------------------------------------------------------------ */

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/ai-services/', import.meta.url));
const BOOK = fixtureBook('ai-selection.fb2');
const KEY = 'sk-test-123';
const DEFAULT_ADDRESS = 'https://api.openai.com/v1';
const LOCAL_EXAMPLE = 'http://127.0.0.1:11434/v1';
const GREEN = 'rgb(16, 124, 16)';
const RED = 'rgb(196, 43, 28)';

interface SettingsJson {
  ai: {
    mode: string;
    freeServiceId: string;
    custom: { address: string; key: string; model: string };
    customVerified: { fingerprint: string; model: string; at: string };
    agreements: { service: string; host: string; at: string }[];
  };
}

/** The fingerprint as the core computes it (rpc-api §3.7): SHA-256 hex of `address\0key\0model`. */
function fingerprintOf(address: string, key: string, model: string): string {
  return createHash('sha256').update(`${address}\0${key}\0${model}`, 'utf8').digest('hex');
}

function settingsJson(dataDir: string): SettingsJson {
  return JSON.parse(readFileSync(path.join(dataDir, 'settings.json'), 'utf8')) as SettingsJson;
}

const settingsBytes = (dataDir: string) => readFileSync(path.join(dataDir, 'settings.json'));

function userFileText(name: string, standinPort: number): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8').replace(
    /127\.0\.0\.1:8787/g,
    `127.0.0.1:${standinPort}`,
  );
}

function removeUserFile(dataDir: string): void {
  rmSync(path.join(dataDir, 'ai-services.json'), { force: true });
}

async function openApp(page: Page, core: CoreHandle): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
}

/** Tools > Settings > the AI assistant page (the service list arrived). */
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

async function okSettings(page: Page): Promise<void> {
  await page.getByTestId('dialog-settings-button-ok').click();
  await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
}

/** The custom radio and its three fields (the key field cleared when `key` is empty). */
async function fillCustom(page: Page, address: string, key: string, model: string): Promise<void> {
  await page.getByTestId('settings-ai-mode-custom').check();
  await page.getByTestId('settings-ai-address').fill(address);
  await page.getByTestId('settings-ai-key').fill(key);
  await page.getByTestId('settings-ai-model').fill(model);
}

const status = (page: Page) => page.getByTestId('settings-ai-status');

/** The values of the model field's suggestions (the `<datalist>` filled by Fetch models). */
const suggestedModels = (page: Page) =>
  page
    .getByTestId('settings-ai-model-list')
    .locator('option')
    .evaluateAll((options) => options.map((o) => o.getAttribute('value')));

/** The text of the whole page body: where a key must never appear. */
const bodyText = (page: Page) => page.evaluate<string>('document.body.innerText');

const documentXml = (page: Page) => page.evaluate<string>('window.__mfbeTest.scripts.toXml()');

async function openBook(page: Page, core: CoreHandle): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

/**
 * The assistant on: the panel is restored as the session left it (FR-040 as amended, T100) -
 * live already at start, or shown through View → AI Assistant when hidden.
 */
async function turnOn(page: Page): Promise<void> {
  await ensureAssistantOn(page);
}

/** The caret in the first paragraph, right-click → Ask AI... → the popup, the instruction sent. */
async function askFromPopup(page: Page, instruction: string): Promise<Locator> {
  const paragraph = page
    .getByTestId('body-editor')
    .locator('p.fb-p', { hasText: 'Поезд пришёл' })
    .first();
  await paragraph.click();
  await paragraph.click({ button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await page.getByTestId('context-menu-ai.ask').click();
  const popup = page.getByTestId('dialog-ai-ask');
  await expect(popup).toBeVisible();
  const input = page.getByTestId('dialog-ai-ask-input');
  await input.fill(instruction);
  await input.press('Enter');
  return popup;
}

interface StandinRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

const requestsOf = (standin: StandinHandle) =>
  standin.requests() as unknown as Promise<StandinRequest[]>;

/* ------------------------------------------------------------------------ */
/* The journeys on the worker's core                                        */
/* ------------------------------------------------------------------------ */

test.describe('US8 (005) - use my own service and key @platform', () => {
  let outside: string[] = [];

  test.beforeEach(async ({ core, standin, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    outside = await recordOutside(context);
    await standin.reset();
    await core.resetAiRequests();
    await core.setAiResolve([]);
    await core.rpc('settings.set', { patch: { ai: null } });
    removeUserFile(core.dataDir!);
    await core.rpc('ai.reloadServices');
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    expect(outside).toEqual([]);
    removeUserFile(core.dataDir!);
    await core.rpc('settings.set', { patch: { ai: null } }).catch(() => {});
    await core.rpc('ai.reloadServices').catch(() => {});
  });

  test('6. the fields, Fetch models, the status red -> green -> red -> green, OK writes the triple with the record, a forged record stays red, a failed test shows the service words', async ({
    core,
    page,
    standin,
  }) => {
    await standin.scenario({ keyRequired: KEY });
    const address = `${standin.url}/v1`;
    await openApp(page, core);
    const before = settingsBytes(core.dataDir!);
    await openAiPage(page);

    // FR-003: the fields come alive under the custom radio; the OpenAI default; the
    // placeholder names the hosted and the local example; the key is a password field.
    const addressField = page.getByTestId('settings-ai-address');
    const keyField = page.getByTestId('settings-ai-key');
    const modelField = page.getByTestId('settings-ai-model');
    await expect(addressField).toBeDisabled();
    await page.getByTestId('settings-ai-mode-custom').check();
    await expect(addressField).toBeEnabled();
    await expect(addressField).toHaveValue(DEFAULT_ADDRESS);
    const placeholder = await addressField.getAttribute('placeholder');
    expect(placeholder).toContain(DEFAULT_ADDRESS);
    expect(placeholder).toContain(LOCAL_EXAMPLE);
    await expect(keyField).toHaveAttribute('type', 'password');
    await expect(page.getByTestId('settings-ai-http-warning')).toHaveCount(0);

    await addressField.fill(address);
    await keyField.fill(KEY);
    // The reveal toggle shows the key while editing and hides it again.
    const reveal = page.getByTestId('settings-ai-key-reveal');
    await reveal.click();
    await expect(keyField).toHaveAttribute('type', 'text');
    await expect(keyField).toHaveValue(KEY);
    await reveal.click();
    await expect(keyField).toHaveAttribute('type', 'password');
    // A local address: no plain-http warning (FR-003).
    await expect(page.getByTestId('settings-ai-http-warning')).toHaveCount(0);

    // FR-004: Fetch models on the draft - GET /v1/models with the key, the two models offered.
    await expect(status(page)).toHaveAttribute('data-status', 'untested');
    await page.getByTestId('settings-ai-fetch-models').click();
    await expect
      .poll(() => suggestedModels(page), { timeout: 15_000 })
      .toEqual(['standin-chat', 'standin-mini']);
    await expect(page.getByTestId('settings-ai-models-note')).toHaveText(
      await pageText(page, 'dialog.settings.ai.custom.modelsFetched', { count: 2 }),
    );
    let requests = await requestsOf(standin);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'GET', path: '/v1/models' });
    expect(requests[0]!.headers.authorization).toBe('present');
    expect(await core.aiRequests()).toMatchObject([
      { method: 'ai.models', targetKind: 'custom', outcome: 'ok', status: 200 },
    ]);
    await modelField.fill('standin-chat');

    // SC-014 / scenario 6: red "not tested" -> Test -> green "Verified — model standin-chat".
    await expect(status(page)).toHaveAttribute('data-status', 'untested');
    await expect(status(page)).toHaveText(
      await pageText(page, 'dialog.settings.ai.status.untested'),
    );
    await expect(status(page)).toHaveCSS('color', RED);
    await standin.scenario({ text: 'OK' });
    await page.getByTestId('settings-ai-test').click();
    await expect(status(page)).toHaveAttribute('data-status', 'verified', { timeout: 15_000 });
    await expect(status(page)).toHaveText(
      await pageText(page, 'dialog.settings.ai.status.customVerified', { model: 'standin-chat' }),
    );
    await expect(status(page)).toHaveCSS('color', GREEN);
    requests = await requestsOf(standin);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ method: 'POST', path: '/v1/chat/completions' });
    expect(requests[1]!.headers.authorization).toBe('present');
    expect((requests[1]!.body as { model: string; stream: boolean }).model).toBe('standin-chat');
    expect((requests[1]!.body as { stream: boolean }).stream).toBe(false);
    expect(requests[1]!.body).not.toHaveProperty('max_tokens');
    expect((await core.aiRequests())[1]).toMatchObject({
      method: 'ai.test',
      targetKind: 'custom',
      outcome: 'ok',
      status: 200,
    });

    // An edit: red at once (the page's digest of the draft differs from the record's); the
    // same values again: green again without a new test.
    await modelField.fill('standin-mini');
    await expect(status(page)).toHaveAttribute('data-status', 'untested');
    await expect(status(page)).toHaveCSS('color', RED);
    await modelField.fill('standin-chat');
    await expect(status(page)).toHaveAttribute('data-status', 'verified');
    await expect(status(page)).toHaveCSS('color', GREEN);
    expect(await requestsOf(standin)).toHaveLength(2);
    // Nothing saved before OK - the key never reached the store (review A1).
    expect(settingsBytes(core.dataDir!).equals(before)).toBe(true);

    // OK: the triple and the record in one patch; the fingerprint is the SHA-256 the
    // journey recomputes; the record holds neither the key nor the address.
    await okSettings(page);
    await expect
      .poll(() => settingsJson(core.dataDir!).ai.custom)
      .toEqual({ address, key: KEY, model: 'standin-chat' });
    const saved = settingsJson(core.dataDir!).ai;
    expect(saved.mode).toBe('custom');
    expect(saved.customVerified.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.customVerified.fingerprint).toBe(fingerprintOf(address, KEY, 'standin-chat'));
    expect(saved.customVerified.model).toBe('standin-chat');
    expect(Date.parse(saved.customVerified.at)).not.toBeNaN();
    const record = JSON.stringify(saved.customVerified);
    expect(record).not.toContain(KEY);
    expect(record).not.toContain(address);

    // Reopened: green again, the key masked, no request made.
    await openAiPage(page);
    await expect(page.getByTestId('settings-ai-mode-custom')).toBeChecked();
    await expect(addressField).toHaveValue(address);
    await expect(modelField).toHaveValue('standin-chat');
    await expect(keyField).toHaveAttribute('type', 'password');
    expect(await bodyText(page)).not.toContain(KEY);
    await expect(status(page)).toHaveAttribute('data-status', 'verified');
    await cancelSettings(page);
    expect(await requestsOf(standin)).toHaveLength(2);

    // A forged record: the core stores the empty record (rpc-api §3.7) - the page shows red.
    await core.rpc('settings.set', {
      patch: {
        ai: {
          custom: { address, key: KEY, model: 'standin-mini' },
          customVerified: {
            fingerprint: '0'.repeat(64),
            model: 'standin-mini',
            at: '2026-10-22T10:00:00.000Z',
          },
        },
      },
    });
    expect(settingsJson(core.dataDir!).ai.customVerified).toEqual({
      fingerprint: '',
      model: '',
      at: '',
    });
    await openAiPage(page);
    await expect(modelField).toHaveValue('standin-mini');
    await expect(status(page)).toHaveAttribute('data-status', 'untested');

    // A failed test: the service's own words in red (FR-009).
    await standin.scenario({
      status: 401,
      body: {
        error: { message: 'The key has expired for this project.', code: 'invalid_api_key' },
      },
    });
    await page.getByTestId('settings-ai-test').click();
    await expect(status(page)).toHaveAttribute('data-status', 'failed', { timeout: 15_000 });
    await expect(status(page)).toContainText('The key has expired for this project.');
    await expect(status(page)).toHaveCSS('color', RED);
    // An edit after the failure: "not tested" again - the failure was the old draft's.
    await modelField.fill('standin-chat');
    await expect(status(page)).toHaveAttribute('data-status', 'untested');
    await cancelSettings(page);
    expect(settingsJson(core.dataDir!).ai.custom.model).toBe('standin-mini');
  });

  test('jobs: Fetch + Test + Cancel saves nothing; Cancel while a test runs cancels the job; the keyboard pass over the custom fields', async ({
    core,
    page,
    standin,
  }) => {
    await standin.scenario({ keyRequired: KEY });
    const address = `${standin.url}/v1`;
    await openApp(page, core);
    await core.rpc('settings.get');
    const before = settingsBytes(core.dataDir!);
    await openAiPage(page);
    await fillCustom(page, address, KEY, 'standin-chat');

    // The keyboard pass (FR-105): Tab from the custom radio reaches the address, the key, the
    // reveal toggle (Space toggles it), the model, Fetch models and Test connection in order.
    await page.getByTestId('settings-ai-mode-custom').focus();
    const reached: string[] = [];
    for (let i = 0; i < 10 && !reached.includes('settings-ai-test'); i += 1) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate<string>(
        `document.activeElement?.getAttribute('data-testid') ?? ''`,
      );
      if (id.startsWith('settings-ai-')) reached.push(id);
    }
    expect(reached).toEqual([
      'settings-ai-address',
      'settings-ai-key',
      'settings-ai-key-reveal',
      'settings-ai-model',
      'settings-ai-fetch-models',
      'settings-ai-test',
    ]);
    await page.getByTestId('settings-ai-key-reveal').focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('settings-ai-key')).toHaveAttribute('type', 'text');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('settings-ai-key')).toHaveAttribute('type', 'password');

    // Fetch, Test (by keyboard: Enter on the focused button), Cancel: settings.json identical.
    await page.getByTestId('settings-ai-fetch-models').click();
    await expect.poll(() => suggestedModels(page), { timeout: 15_000 }).toHaveLength(2);
    await standin.scenario({ text: 'OK' });
    await page.getByTestId('settings-ai-test').focus();
    await page.keyboard.press('Enter');
    await expect(status(page)).toHaveAttribute('data-status', 'verified', { timeout: 15_000 });
    await cancelSettings(page);
    await page.waitForTimeout(500);
    expect(settingsBytes(core.dataDir!).equals(before)).toBe(true);
    expect(settingsJson(core.dataDir!).ai.mode).toBe('disabled'); // the stored default, untouched
    expect(await core.aiRequests()).toHaveLength(2);
    expect(await requestsOf(standin)).toHaveLength(2);

    // A slow answer, Test, then Cancel the dialog: the job is cancelled, nothing saved.
    await openAiPage(page);
    await fillCustom(page, address, KEY, 'standin-chat');
    await standin.scenario({ text: 'OK', delayMs: 5000 });
    await page.getByTestId('settings-ai-test').click();
    await expect(page.getByTestId('settings-ai-test-spinner')).toBeVisible();
    await expect(status(page)).toHaveAttribute('data-status', 'untested');
    await expect(page.getByTestId('settings-ai-test')).toBeDisabled();
    await cancelSettings(page);
    await expect
      .poll(async () => (await core.aiRequests()).at(-1)?.outcome, { timeout: 15_000 })
      .toBe('cancelled');
    expect((await core.aiRequests()).at(-1)).toMatchObject({
      method: 'ai.test',
      targetKind: 'custom',
    });
    await page.waitForTimeout(300);
    expect(settingsBytes(core.dataDir!).equals(before)).toBe(true);
  });

  test('3. Fetch models: no models -> a typed name is accepted and used; a non-list answer -> the format message, the field typed-only', async ({
    core,
    page,
    standin,
  }) => {
    await standin.scenarios([{ keyRequired: KEY }, { models: [] }]);
    await openApp(page, core);
    await openAiPage(page);
    await fillCustom(page, `${standin.url}/v1`, KEY, '');
    await page.getByTestId('settings-ai-fetch-models').click();
    await expect(page.getByTestId('settings-ai-models-note')).toHaveText(
      await pageText(page, 'dialog.settings.ai.custom.modelsNone'),
      { timeout: 15_000 },
    );
    expect(await suggestedModels(page)).toEqual([]);
    // Without a model the test has nothing to send to; a typed name is accepted and used.
    await expect(page.getByTestId('settings-ai-test')).toBeDisabled();
    await page.getByTestId('settings-ai-model').fill('my-typed-model');
    await standin.scenario({ text: 'OK' });
    await page.getByTestId('settings-ai-test').click();
    await expect(status(page)).toHaveAttribute('data-status', 'verified', { timeout: 15_000 });
    await expect(status(page)).toContainText('my-typed-model');
    const requests = await requestsOf(standin);
    expect(requests).toHaveLength(2);
    expect((requests[1]!.body as { model: string }).model).toBe('my-typed-model');

    // A non-list body: the `format` message under the button; the field still takes a name.
    await standin.scenario({ models: { message: 'not a list' } });
    await page.getByTestId('settings-ai-fetch-models').click();
    await expect(page.getByTestId('settings-ai-models-note')).toContainText(
      await pageText(page, 'ai.failure.format'),
      { timeout: 15_000 },
    );
    expect(await suggestedModels(page)).toEqual([]);
    // (The core's record names the call and the HTTP exchange - a 200 whose body is no list -
    // never a body; the `format` verdict is the result the page shows.)
    expect((await core.aiRequests()).at(-1)).toMatchObject({
      method: 'ai.models',
      targetKind: 'custom',
      status: 200,
    });
    await page.getByTestId('settings-ai-model').fill('another-typed-model');
    await expect(page.getByTestId('settings-ai-model')).toHaveValue('another-typed-model');
    await expect(page.getByTestId('settings-ai-test')).toBeEnabled();
    await cancelSettings(page);
  });

  test('4. a wrong key: Test connection and a popup request refused in the service words with the key masked, the settings link; an empty key in key mode: "Missing API key."', async ({
    core,
    page,
    standin,
  }) => {
    await standin.scenario({ keyRequired: KEY });
    const address = `${standin.url}/v1`;
    await core.rpc('settings.set', {
      patch: {
        ai: { mode: 'custom', custom: { address, key: 'sk-wrong', model: 'standin-chat' } },
      },
    });
    await openApp(page, core);
    await openBook(page, core);
    const xmlBefore = await documentXml(page);

    // Test connection: 401 invalid_api_key in the stand-in's words; the echoed key masked.
    await openAiPage(page);
    await expect(page.getByTestId('settings-ai-mode-custom')).toBeChecked();
    await page.getByTestId('settings-ai-test').click();
    await expect(status(page)).toHaveAttribute('data-status', 'failed', { timeout: 15_000 });
    await expect(status(page)).toContainText('Incorrect API key provided');
    await expect(status(page)).toContainText('•••');
    await expect(status(page)).not.toContainText('sk-wrong');
    expect(await bodyText(page)).not.toContain('sk-wrong');
    expect((await core.aiRequests()).at(-1)).toMatchObject({
      method: 'ai.test',
      targetKind: 'custom',
      outcome: 'http',
      status: 401,
    });
    await cancelSettings(page);

    // A popup request: the same words, the link opens Settings on the AI page, XML unchanged.
    await turnOn(page);
    await askFromPopup(page, 'Fix the typos');
    const popupStatus = page.getByTestId('dialog-ai-ask-status');
    await expect(popupStatus).toHaveAttribute('data-state', 'failed', { timeout: 20_000 });
    await expect(popupStatus).toContainText('Incorrect API key provided');
    await expect(popupStatus).toContainText(await pageText(page, 'ai.failure.auth'));
    await expect(popupStatus).not.toContainText('sk-wrong');
    expect(await documentXml(page)).toBe(xmlBefore);
    await expect(page).not.toHaveTitle(/\*/);
    await page.getByTestId('dialog-ai-ask-settings-link').click();
    await expect(page.getByTestId('dialog-settings')).toBeVisible();
    await expect(page.getByTestId('settings-page-ai')).toBeVisible();

    // An empty key for a service that needs one: "Missing API key." (FR-024, scenario 4).
    await page.getByTestId('settings-ai-key').fill('');
    await page.getByTestId('settings-ai-test').click();
    await expect(status(page)).toHaveAttribute('data-status', 'failed', { timeout: 15_000 });
    await expect(status(page)).toContainText('Missing API key.');
    const requests = await requestsOf(standin);
    expect(requests.at(-1)!.headers.authorization).toBe('absent');
    await cancelSettings(page);
    expect(settingsJson(core.dataDir!).ai.custom.key).toBe('sk-wrong');
    expect(await documentXml(page)).toBe(xmlBefore);
  });

  test('5+7. a local address with an empty key: no notice, success, no Authorization; the plain-http warning for an address off this computer only', async ({
    core,
    page,
    standin,
  }) => {
    await openApp(page, core);
    await openAiPage(page);
    await fillCustom(page, `${standin.url}/v1`, '', 'standin-chat');
    await standin.scenario({ text: 'OK' });
    await page.getByTestId('settings-ai-test').click();
    await expect(status(page)).toHaveAttribute('data-status', 'verified', { timeout: 15_000 });
    await expect(page.getByTestId('dialog-ai-notice')).toHaveCount(0);
    const requests = await requestsOf(standin);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.authorization).toBe('absent');
    expect(settingsJson(core.dataDir!).ai.agreements).toEqual([]);

    // FR-003: the warning for a plain address that is not on this computer, and only then.
    const addressField = page.getByTestId('settings-ai-address');
    const warning = page.getByTestId('settings-ai-http-warning');
    await addressField.fill('http://192.0.2.10:8080/v1');
    await expect(warning).toBeVisible();
    await expect(warning).toHaveText(await pageText(page, 'dialog.settings.ai.custom.httpWarning'));
    for (const address of [
      'https://example.invalid/v1',
      'http://127.0.0.1:8787/v1',
      'http://localhost:8787/v1',
      'http://[::1]:8787/v1',
    ]) {
      await addressField.fill(address);
      await expect(warning, address).toHaveCount(0);
    }
    await cancelSettings(page);
    expect(await core.aiRequests()).toHaveLength(1);
  });

  test('the Disabled exception: with Disabled saved, Test connection on a custom draft sends the one request', async ({
    core,
    page,
    standin,
  }) => {
    await core.rpc('settings.set', { patch: { ai: { mode: 'disabled' } } });
    await openApp(page, core);
    await core.rpc('settings.get');
    const before = settingsBytes(core.dataDir!);
    await openAiPage(page);
    await expect(page.getByTestId('settings-ai-test')).toHaveCount(0);
    await fillCustom(page, `${standin.url}/v1`, '', 'standin-mini');
    await standin.scenario({ text: 'OK' });
    await page.getByTestId('settings-ai-test').click();
    await expect(status(page)).toHaveAttribute('data-status', 'verified', { timeout: 15_000 });
    const requests = await requestsOf(standin);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', path: '/v1/chat/completions' });
    expect((requests[0]!.body as { model: string }).model).toBe('standin-mini');
    expect(await core.aiRequests()).toMatchObject([
      { method: 'ai.test', targetKind: 'custom', outcome: 'ok' },
    ]);
    await cancelSettings(page);
    await page.waitForTimeout(300);
    expect(settingsBytes(core.dataDir!).equals(before)).toBe(true);
  });

  test('FR-014: a list entry with a key - the masked marker, the key sent with Test connection and a request, never shown or stored', async ({
    core,
    page,
    standin,
  }) => {
    await standin.scenario({ keyRequired: 'sk-user' });
    writeFileSync(
      path.join(core.dataDir!, 'ai-services.json'),
      userFileText('user-with-key.json', standin.port),
    );
    await core.rpc('ai.reloadServices');
    await openApp(page, core);
    await openBook(page, core);
    await openAiPage(page);
    // The stored default is Disabled (FR-001): the list exists for the free choice.
    await page.getByTestId('settings-ai-mode-free').check();
    await page.getByTestId('settings-ai-service').selectOption('keyed');
    await expect(page.getByTestId('settings-ai-entry-key')).toContainText('•••');
    expect(await bodyText(page)).not.toContain('sk-user');
    await standin.scenario({ text: 'OK' });
    await page.getByTestId('settings-ai-test').click();
    await expect(status(page)).toHaveAttribute('data-status', 'verified', { timeout: 15_000 });
    let requests = await requestsOf(standin);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.authorization).toBe('present');
    await okSettings(page);
    await expect.poll(() => settingsJson(core.dataDir!).ai.freeServiceId).toBe('keyed');

    // A popup request with the entry: the key goes with it, nothing of it is shown.
    await turnOn(page);
    await standin.scenario({ text: 'NO CHANGE\nAll fine.' });
    await askFromPopup(page, 'Is this paragraph fine?');
    const popupStatus = page.getByTestId('dialog-ai-ask-status');
    await expect(popupStatus).toHaveAttribute('data-state', 'answered', { timeout: 20_000 });
    requests = await requestsOf(standin);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.headers.authorization).toBe('present');
    await page.keyboard.press('Escape');

    // The key is in the list file alone: not in settings.json, the request record or the log.
    expect(readFileSync(path.join(core.dataDir!, 'settings.json'), 'utf8')).not.toContain(
      'sk-user',
    );
    expect(JSON.stringify(await core.aiRequests())).not.toContain('sk-user');
    const log = path.join(core.dataDir!, 'logs', 'mfbe-errors.log');
    if (existsSync(log)) expect(readFileSync(log, 'utf8')).not.toContain('sk-user');
    expect(await bodyText(page)).not.toContain('sk-user');
  });
});

/* ------------------------------------------------------------------------ */
/* Restart and the portable move: cores of their own                         */
/* ------------------------------------------------------------------------ */

test.describe('US8 (005) - the triple survives a restart and a copied data directory @platform', () => {
  let dir = '';
  let standin: StandinHandle | null = null;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us8-ai-'));
  });

  test.afterAll(async () => {
    await standin?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  async function coreAndPage(
    browser: Browser,
    dataDir: string,
    uiLang: UiLang | undefined,
  ): Promise<{ page: Page; rpc: NodeRpcClient; stop: () => Promise<void> }> {
    const started = await startCoreWith(process.env.MFBE_CORE_BIN!, dataDir, []);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(withUiLang(started.url, uiLang));
    await page.getByTestId('app-root').waitFor();
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    const parsed = new URL(started.url);
    const rpc = new NodeRpcClient(
      `ws://127.0.0.1:${parsed.port}/rpc?token=${parsed.searchParams.get('token') ?? ''}`,
    );
    return {
      page,
      rpc,
      stop: async () => {
        rpc.close();
        await context.close();
        await started.stop();
      },
    };
  }

  /** The page of a core on a data directory with the triple: shown masked, green, used. */
  async function expectTripleInUse(
    page: Page,
    rpc: NodeRpcClient,
    standinHandle: StandinHandle,
    address: string,
  ): Promise<void> {
    const core = {
      enqueueDialog: async (method: string, result: unknown) => {
        await rpc.call('test.enqueueDialog', { method, result });
      },
    } as unknown as CoreHandle;
    await openAiPage(page);
    await expect(page.getByTestId('settings-ai-mode-custom')).toBeChecked();
    await expect(page.getByTestId('settings-ai-address')).toHaveValue(address);
    await expect(page.getByTestId('settings-ai-model')).toHaveValue('standin-chat');
    await expect(page.getByTestId('settings-ai-key')).toHaveAttribute('type', 'password');
    expect(await bodyText(page)).not.toContain(KEY);
    await expect(status(page)).toHaveAttribute('data-status', 'verified');
    await cancelSettings(page);
    // A request carries the key and succeeds.
    await openBook(page, core);
    await turnOn(page);
    await standinHandle.scenario({ text: 'NO CHANGE\nFine.' });
    await askFromPopup(page, 'Anything to fix?');
    await expect(page.getByTestId('dialog-ai-ask-status')).toHaveAttribute(
      'data-state',
      'answered',
      { timeout: 20_000 },
    );
    const requests = await requestsOf(standinHandle);
    expect(requests.at(-1)!.headers.authorization).toBe('present');
    expect((requests.at(-1)!.body as { model: string }).model).toBe('standin-chat');
    await page.keyboard.press('Escape');
  }

  test('1+2. address, key and model entered and verified, OK: a second core shows them masked and green and uses them; a copied data directory the same, nothing written outside', async ({
    browser,
    uiLang,
  }) => {
    standin ??= await startStandin();
    await standin.reset();
    await standin.scenario({ keyRequired: KEY });
    const address = `${standin.url}/v1`;
    const dataDir = mkdtempSync(path.join(dir, 'data-'));

    const first = await coreAndPage(browser, dataDir, uiLang);
    try {
      await openAiPage(first.page);
      await fillCustom(first.page, address, KEY, 'standin-chat');
      await standin.scenario({ text: 'OK' });
      await first.page.getByTestId('settings-ai-test').click();
      await expect(status(first.page)).toHaveAttribute('data-status', 'verified', {
        timeout: 15_000,
      });
      await okSettings(first.page);
      await expect
        .poll(() => settingsJson(dataDir).ai.custom)
        .toEqual({ address, key: KEY, model: 'standin-chat' });
      expect(settingsJson(dataDir).ai.customVerified.fingerprint).toBe(
        fingerprintOf(address, KEY, 'standin-chat'),
      );
    } finally {
      await first.stop();
    }

    // Scenario 1: the second core on the same data directory.
    const second = await coreAndPage(browser, dataDir, uiLang);
    try {
      await expectTripleInUse(second.page, second.rpc, standin, address);
    } finally {
      await second.stop();
    }

    // Scenario 2: the portable move simulated by a copy; nothing is written to the old place.
    const copy = path.join(dir, 'moved-data');
    cpSync(dataDir, copy, { recursive: true });
    const listingBefore = readdirSync(dataDir).sort();
    const settingsBefore = settingsBytes(dataDir);
    const third = await coreAndPage(browser, copy, uiLang);
    try {
      const settings = await third.rpc.call<SettingsJson>('settings.get');
      expect(settings.ai.custom).toEqual({ address, key: KEY, model: 'standin-chat' });
      await expectTripleInUse(third.page, third.rpc, standin, address);
    } finally {
      await third.stop();
    }
    expect(readdirSync(dataDir).sort()).toEqual(listingBefore);
    expect(settingsBytes(dataDir).equals(settingsBefore)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* A hosted custom address: the notice before Fetch models and Test            */
/* ------------------------------------------------------------------------ */

test.describe('US8 (005) - the notice before Fetch models and Test connection on a hosted custom address @platform', () => {
  // A core of its own: `no_proxy` keeps a runner's proxy away from the hosted name.
  test.use({ coreEnv: { no_proxy: 'ai.standin.test' } });

  test.beforeEach(async ({ core, standin }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await standin.reset();
    await core.rpc('settings.set', { patch: { ai: null } });
    await core.setAiResolve([`ai.standin.test:${standin.port}:127.0.0.1`]);
    await core.resetAiRequests();
  });

  test('No sends nothing; Yes records custom:<address> with the host and the GET goes; Test and the first request afterwards ask no more', async ({
    core,
    page,
    standin,
  }) => {
    const host = `ai.standin.test:${standin.port}`;
    const address = `http://${host}/v1`;
    await openApp(page, core);
    await openBook(page, core);
    await openAiPage(page);
    await fillCustom(page, address, '', 'standin-chat');
    // A plain address off this computer: the warning on the page (FR-003).
    await expect(page.getByTestId('settings-ai-http-warning')).toBeVisible();
    const notice = page.getByTestId('dialog-ai-notice');

    // Fetch models: the notice first, naming the host, with the unencrypted sentence; No.
    await page.getByTestId('settings-ai-fetch-models').click();
    await expect(notice).toBeVisible();
    await expect(page.getByTestId('dialog-ai-notice-service')).toContainText(host);
    await expect(page.getByTestId('dialog-ai-notice-unencrypted')).toBeVisible();
    await expect(page.getByTestId('dialog-ai-notice-terms')).toHaveCount(0);
    await page.getByTestId('dialog-ai-notice-button-no').click();
    await expect(notice).toHaveCount(0);
    expect(await requestsOf(standin)).toEqual([]);
    expect(await core.aiRequests()).toEqual([]);
    expect(settingsJson(core.dataDir!).ai.agreements).toEqual([]);

    // Yes: the agreement at once under `custom:<address>` with the host; the GET goes.
    await page.getByTestId('settings-ai-fetch-models').click();
    await expect(notice).toBeVisible();
    await page.getByTestId('dialog-ai-notice-button-yes').click();
    await expect(notice).toHaveCount(0);
    await expect.poll(() => suggestedModels(page), { timeout: 15_000 }).toHaveLength(2);
    expect(settingsJson(core.dataDir!).ai.agreements).toMatchObject([
      { service: `custom:${address}`, host },
    ]);
    await expect(page.getByTestId(`settings-ai-agreement-custom:${address}-revoke`)).toBeVisible();
    const requests = await requestsOf(standin);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'GET', path: '/v1/models' });
    expect((await core.aiRequests())[0]).toMatchObject({
      method: 'ai.models',
      targetKind: 'custom',
      host,
      outcome: 'ok',
    });

    // Test connection: agreed already - no notice, the request goes.
    await standin.scenario({ text: 'OK' });
    await page.getByTestId('settings-ai-test').click();
    await expect(status(page)).toHaveAttribute('data-status', 'verified', { timeout: 15_000 });
    await expect(notice).toHaveCount(0);
    expect(await requestsOf(standin)).toHaveLength(2);
    await okSettings(page);
    await expect.poll(() => settingsJson(core.dataDir!).ai.mode).toBe('custom');

    // The first request of the assistant afterwards: no notice either (FR-005, FR-021).
    await turnOn(page);
    await standin.scenario({ text: 'NO CHANGE\nFine.' });
    await askFromPopup(page, 'Anything to fix?');
    await expect(page.getByTestId('dialog-ai-ask-status')).toHaveAttribute(
      'data-state',
      'answered',
      { timeout: 20_000 },
    );
    await expect(notice).toHaveCount(0);
    expect(await requestsOf(standin)).toHaveLength(3);
    await page.keyboard.press('Escape');
  });
});
