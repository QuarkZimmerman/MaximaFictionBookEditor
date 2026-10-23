/**
 * User Story 1 (feature 005) - choose a free AI service in Settings (T033).
 *
 * Tagged `@platform`: the whole file runs on the Linux, Windows and macOS e2e legs of CI - the
 * UI -> core -> libcurl -> loopback stand-in path once per operating system (the HTTP backends
 * differ). Needs the real core (`MFBE_CORE_BIN`); skipped in core-less mode. Nothing but the
 * stand-in (`fixtures/ai-standin.mjs`, loopback only) is ever contacted: the bundled entries
 * are tested only after a user list file redirected them to it, and the terms links are
 * asserted by `href` and never clicked (a click would run the runner's URL opener through
 * `app.openUrl` - the click handler is AiPage.test.tsx's unit case).
 *
 * Scenarios (spec.md US1; quickstart §1):
 *  1. a fresh core: the AI assistant page, Free selected, the three bundled entries in order as
 *     `<name> — <model>`, the first selected, the custom fields disabled (FR-001, FR-002)
 *  6. for each entry its limits note in the interface language, its terms link and - for
 *     LLM7.io - the undocumented-keyless remark (FR-002, FR-010)
 *  5. the user list file (FR-012, FR-013): a replaced bundled entry, an added `tools: false`
 *     entry, a hidden entry, a missing field, a truncated file and a duplicate id, each after
 *     *Reload list*
 *  2. *Test connection* against the stand-in: "answered (<model>)", the one recorded request
 *     with the effective entry's model, `stream: false`, no key and no `max_tokens`; the
 *     service's words on a 429; the document unchanged (FR-005)
 *  7. *Edit list* creates the user's copy once and never overwrites it (FR-007, FR-011)
 *  3. the choice survives a restart (a second core on the same data directory) (FR-006)
 *  4. a copied data directory (the portable move) keeps the choice and the list file and nothing
 *     is written to the old place (FR-006, FR-101)
 *  - the first-use notice for a hosted name (`test.setAiResolve`): shown before the first test,
 *    *No* sends nothing, *Yes* is remembered at once and not asked again; the agreements list
 *    and its withdrawal (FR-008, FR-021)
 *  - FR-105: the page by keyboard alone; the Disabled radio hides *Test connection*
 *  - FR-011: the bundled list file is byte-identical after every scenario
 *
 * Projects `chromium-ru` / `chromium-uk` run this file too: every interface text is read from
 * the catalogues (fixtures/i18n.ts).
 */

import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Browser, Locator, Page } from '@playwright/test';

import {
  expect,
  NodeRpcClient,
  startCoreWith,
  startStandin,
  test,
  withUiLang,
  type CoreHandle,
  type StandinHandle,
} from './fixtures/core';
import { pageLang, pageText, type UiLang } from './fixtures/i18n';

/* ------------------------------------------------------------------------ */
/* Fixtures and helpers                                                     */
/* ------------------------------------------------------------------------ */

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/ai-services/', import.meta.url));

interface BundledEntry {
  id: string;
  name: string;
  model: string;
  termsUrl: string;
  limits: Record<UiLang, string>;
}

interface ServicesResult {
  services: { id: string; name: string; model: string; replaced: boolean; source: string }[];
  files: { bundled: string; user: string; userExists: boolean };
}

interface SettingsJson {
  ai: {
    mode: string;
    freeServiceId: string;
    agreements: { service: string; host: string; at: string }[];
  };
}

/** A fixture user list file with the stand-in's port in place of the written one. */
function fixtureText(name: string, standinPort: number): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8').replace(
    /127\.0\.0\.1:8787/g,
    `127.0.0.1:${standinPort}`,
  );
}

function writeUserFile(dataDir: string, content: string): string {
  const file = path.join(dataDir, 'ai-services.json');
  writeFileSync(file, content);
  return file;
}

function removeUserFile(dataDir: string): void {
  const file = path.join(dataDir, 'ai-services.json');
  if (existsSync(file)) unlinkSync(file);
}

function settingsJson(dataDir: string): SettingsJson {
  return JSON.parse(readFileSync(path.join(dataDir, 'settings.json'), 'utf8')) as SettingsJson;
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/** Tools > Settings > the AI assistant page. */
async function openAiPage(page: Page): Promise<Locator> {
  await menu(page, 'tools', 'settings');
  await expect(page.getByTestId('dialog-settings')).toBeVisible();
  await page.getByTestId('settings-tab-ai').click();
  const aiPage = page.getByTestId('settings-page-ai');
  await expect(aiPage).toBeVisible();
  // The list arrived (the select has its options).
  await expect(page.getByTestId('settings-ai-service').locator('option').first()).toBeAttached();
  return aiPage;
}

async function cancelSettings(page: Page): Promise<void> {
  await page.getByTestId('dialog-settings-button-cancel').click();
  await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
}

async function openApp(page: Page, core: CoreHandle): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
}

const optionValues = (select: Locator) =>
  select.locator('option').evaluateAll((options) => options.map((o) => o.getAttribute('value')));

const optionTexts = (select: Locator) =>
  select.locator('option').evaluateAll((options) => options.map((o) => o.textContent));

declare const window: {
  __mfbeTest?: { scripts?: { toXml(): Promise<string> } };
};

const documentXml = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.toXml());

/** The entries of the bundled list file, read from the file the core names. */
async function bundledEntries(
  core: CoreHandle,
): Promise<{ path: string; entries: BundledEntry[] }> {
  const services = await core.rpc<ServicesResult>('ai.services');
  const file = services.files.bundled;
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { services: BundledEntry[] };
  return { path: file, entries: parsed.services };
}

/** The core's `ai.services` with the user file reloaded first. */
async function reloadServices(core: CoreHandle): Promise<ServicesResult> {
  return core.rpc<ServicesResult>('ai.reloadServices');
}

/** A page URL's port and token as the RPC client needs them. */
function rpcClientOf(url: string): NodeRpcClient {
  const parsed = new URL(url);
  return new NodeRpcClient(
    `ws://127.0.0.1:${parsed.port}/rpc?token=${parsed.searchParams.get('token') ?? ''}`,
  );
}

/* ------------------------------------------------------------------------ */
/* The journeys on the worker's core                                        */
/* ------------------------------------------------------------------------ */

test.describe('US1 (005) - choose a free AI service in Settings @platform', () => {
  let bundledPath = '';
  let bundledBytes: Buffer | null = null;

  test.beforeEach(async ({ core, standin }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await standin.reset();
    await core.resetAiRequests();
    await core.setAiResolve([]);
    // The AI settings back to their defaults, no user list file.
    await core.rpc('settings.set', { patch: { ai: null } });
    removeUserFile(core.dataDir!);
    await reloadServices(core);
    const bundled = await bundledEntries(core);
    bundledPath = bundled.path;
    bundledBytes = readFileSync(bundledPath);
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    // FR-011: the bundled file is never modified by the editor.
    expect(readFileSync(bundledPath).equals(bundledBytes!)).toBe(true);
    removeUserFile(core.dataDir!);
    await reloadServices(core).catch(() => {});
    await core.rpc('settings.set', { patch: { ai: null } }).catch(() => {});
  });

  test('1+6. a fresh core: Free selected, the three bundled entries with limits, terms and the LLM7 remark; the page by keyboard', async ({
    core,
    page,
  }) => {
    const { entries } = await bundledEntries(core);
    expect(entries.map((e) => e.id)).toEqual(['ovhcloud', 'pollinations', 'llm7']);
    await openApp(page, core);
    await openAiPage(page);
    const lang = await pageLang(page);

    // Scenario 1: the free radio, the bundled order with "<name> — <model>", the first
    // selected, the custom fields disabled.
    await expect(page.getByTestId('settings-ai-mode-free')).toBeChecked();
    await expect(page.getByTestId('settings-ai-mode-custom')).not.toBeChecked();
    await expect(page.getByTestId('settings-ai-mode-disabled')).not.toBeChecked();
    const select = page.getByTestId('settings-ai-service');
    expect(await optionValues(select)).toEqual(['ovhcloud', 'pollinations', 'llm7']);
    expect(await optionTexts(select)).toEqual(entries.map((e) => `${e.name} — ${e.model}`));
    await expect(select).toHaveValue('ovhcloud');
    for (const field of ['settings-ai-address', 'settings-ai-key', 'settings-ai-model']) {
      await expect(page.getByTestId(field), field).toBeDisabled();
    }
    // The list files are named (FR-007): the bundled one and the user file's place.
    await expect(page.getByTestId('settings-ai-list-path')).toContainText(bundledPath);
    await expect(page.getByTestId('settings-ai-list-path')).toContainText(
      path.join(core.dataDir!, 'ai-services.json'),
    );
    await expect(page.getByTestId('settings-ai-list-issues')).toHaveCount(0);
    // No agreement yet on a fresh core (FR-008).
    await expect(page.locator('[data-testid^="settings-ai-agreement-"]')).toHaveCount(0);
    await expect(page.getByTestId('settings-ai-agreements')).toContainText(
      await pageText(page, 'dialog.settings.ai.agreements.none'),
    );

    // Scenario 6: for each entry the limits note in the interface language, the terms link by
    // href (never clicked), the LLM7 remark inside its note; all three can use the tools.
    for (const entry of entries) {
      await select.selectOption(entry.id);
      await expect(page.getByTestId('settings-ai-limits')).toContainText(entry.limits[lang]);
      await expect(page.getByTestId('settings-ai-terms')).toHaveAttribute('href', entry.termsUrl);
      await expect(page.getByTestId('settings-ai-terms')).not.toHaveAttribute('target', /.+/);
      await expect(page.getByTestId('settings-ai-tools-note')).toHaveCount(0);
      await expect(page.getByTestId('settings-ai-replaced')).toHaveCount(0);
    }
    const llm7 = entries.find((e) => e.id === 'llm7')!;
    expect(llm7.limits.en).toMatch(/keyless use is undocumented/);
    await expect(page.getByTestId('settings-ai-limits')).toContainText(llm7.limits[lang]);
    await expect(page.getByTestId('settings-ai-status')).toHaveAttribute('data-status', 'untested');
    await expect(page.getByTestId('settings-ai-status')).toHaveAttribute('aria-live', 'polite');

    // The Disabled radio: no Test connection button while it is chosen; back with Free.
    await page.getByTestId('settings-ai-mode-disabled').check();
    await expect(page.getByTestId('settings-ai-test')).toHaveCount(0);
    await page.getByTestId('settings-ai-mode-free').check();
    await expect(page.getByTestId('settings-ai-test')).toBeVisible();

    // FR-105 by keyboard alone: the arrows move the radio, Tab reaches the select, the Test
    // button and the list buttons (none pressed: the bundled addresses are real services).
    await page.getByTestId('settings-ai-mode-free').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('settings-ai-mode-custom')).toBeChecked();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('settings-ai-mode-disabled')).toBeChecked();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('settings-ai-mode-free')).toBeChecked();
    await expect(page.getByTestId('settings-ai-mode-free')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(select).toBeFocused();
    const reached: string[] = [];
    for (let i = 0; i < 12 && reached.length < 3; i += 1) {
      await page.keyboard.press('Tab');
      // A string snippet: the e2e tsconfig has no DOM lib.
      const id = await page.evaluate<string>(
        `document.activeElement?.getAttribute('data-testid') ?? ''`,
      );
      if (['settings-ai-test', 'settings-ai-edit-list', 'settings-ai-reload-list'].includes(id)) {
        reached.push(id);
      }
    }
    expect(reached).toEqual([
      'settings-ai-test',
      'settings-ai-edit-list',
      'settings-ai-reload-list',
    ]);

    await cancelSettings(page);
    expect(await core.aiRequests()).toEqual([]);
  });

  test('5. a user list file: replaced, added (answers only), hidden, missing field, truncated, duplicate id', async ({
    core,
    page,
    standin,
  }) => {
    await openApp(page, core);
    await openAiPage(page);
    const select = page.getByTestId('settings-ai-service');
    const reload = async () => {
      await page.getByTestId('settings-ai-reload-list').click();
    };
    const userFile = path.join(core.dataDir!, 'ai-services.json');

    // (a) a bundled id replaced by the user file: the page says so, the model is the file's.
    writeUserFile(core.dataDir!, fixtureText('user-override.json', standin.port));
    await reload();
    await expect(select.locator('option').first()).toHaveText(
      'OVHcloud AI Endpoints (stand-in) — standin-chat',
    );
    expect(await optionValues(select)).toEqual(['ovhcloud', 'pollinations', 'llm7']);
    await expect(page.getByTestId('settings-ai-replaced')).toBeVisible();
    await expect(page.getByTestId('settings-ai-replaced')).toHaveText(
      await pageText(page, 'dialog.settings.ai.replaced'),
    );
    await expect(page.getByTestId('settings-ai-list-issues')).toHaveCount(0);
    await expect(page.getByTestId('settings-ai-list-path')).toContainText(userFile);

    // (b) an added entry with `tools: false`: listed after the bundled ones, "answers only".
    writeUserFile(core.dataDir!, fixtureText('user-added-no-tools.json', standin.port));
    await reload();
    await expect
      .poll(() => optionValues(select))
      .toEqual(['ovhcloud', 'pollinations', 'llm7', 'my-local']);
    await expect(page.getByTestId('settings-ai-replaced')).toHaveCount(0);
    await select.selectOption('my-local');
    await expect(page.getByTestId('settings-ai-tools-note')).toHaveText(
      await pageText(page, 'dialog.settings.ai.toolsNote'),
    );
    await expect(page.getByTestId('settings-ai-limits')).toContainText(
      'no limits: the model runs on this computer',
    );
    // No terms link for an entry without one.
    await expect(page.getByTestId('settings-ai-terms')).toHaveCount(0);
    await select.selectOption('ovhcloud');
    await expect(page.getByTestId('settings-ai-tools-note')).toHaveCount(0);

    // (c) a hidden bundled entry is absent; the others keep their order.
    writeUserFile(core.dataDir!, fixtureText('user-hidden-pollinations.json', standin.port));
    await reload();
    await expect.poll(() => optionValues(select)).toEqual(['ovhcloud', 'llm7']);

    // (d) an entry without a model: the issue names the file, the entry and the field; the
    // rest stays usable.
    writeUserFile(core.dataDir!, fixtureText('user-missing-model.json', standin.port));
    await reload();
    const issues = page.getByTestId('settings-ai-list-issues');
    await expect(issues).toBeVisible();
    await expect(issues).toContainText(userFile);
    await expect(issues).toContainText(
      await pageText(page, 'dialog.settings.ai.issues.entry', {
        file: userFile,
        index: 0,
        reason: await pageText(page, 'ai.listIssue.missingField', { field: 'model' }),
      }),
    );
    expect(await optionValues(select)).toEqual(['ovhcloud', 'pollinations', 'llm7']);

    // (e) a truncated file: `invalidJson` named with the file, the three bundled entries back.
    writeUserFile(core.dataDir!, fixtureText('user-truncated.json', standin.port));
    await reload();
    await expect(issues).toContainText(
      await pageText(page, 'dialog.settings.ai.issues.file', {
        file: userFile,
        reason: await pageText(page, 'ai.listIssue.invalidJson'),
      }),
    );
    expect(await optionValues(select)).toEqual(['ovhcloud', 'pollinations', 'llm7']);

    // (f) two entries with one id: the first wins, the second is a `duplicateId` issue.
    writeUserFile(core.dataDir!, fixtureText('user-duplicate-id.json', standin.port));
    await reload();
    await expect
      .poll(() => optionValues(select))
      .toEqual(['ovhcloud', 'pollinations', 'llm7', 'standin']);
    await expect(issues).toContainText(
      await pageText(page, 'dialog.settings.ai.issues.entry', {
        file: userFile,
        index: 1,
        reason: await pageText(page, 'ai.listIssue.duplicateId'),
      }),
    );
    await select.selectOption('standin');
    await expect(select.locator('option[value="standin"]')).toHaveText(
      'Stand-in (first entry wins) — standin-chat',
    );

    await cancelSettings(page);
    expect(await core.aiRequests()).toEqual([]);
  });

  test('2. Test connection against the stand-in: answered (model), the recorded request, the service words on a limit, the document unchanged', async ({
    core,
    page,
    standin,
  }) => {
    writeUserFile(core.dataDir!, fixtureText('user-override.json', standin.port));
    await reloadServices(core);
    const version = (await core.rpc<{ version: string }>('app.info')).version;
    await openApp(page, core);
    const xmlBefore = await documentXml(page);
    await openAiPage(page);
    await expect(page.getByTestId('settings-ai-service')).toHaveValue('ovhcloud');
    await expect(page.getByTestId('settings-ai-replaced')).toBeVisible();
    const status = page.getByTestId('settings-ai-status');
    await expect(status).toHaveAttribute('data-status', 'untested');

    // A success: "answered (standin-chat)" in green - by keyboard: the button pressed with Enter.
    await standin.scenario({ text: 'OK' });
    await page.getByTestId('settings-ai-test').focus();
    await page.keyboard.press('Enter');
    await expect(status).toHaveAttribute('data-status', 'verified', { timeout: 15_000 });
    await expect(status).toHaveText(
      await pageText(page, 'dialog.settings.ai.status.verified', { model: 'standin-chat' }),
    );
    await expect(status).toHaveCSS('color', 'rgb(16, 124, 16)');
    const requests = await standin.requests();
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/v1/chat/completions');
    expect(request.headers.authorization).toBe('absent');
    expect(request.headers['user-agent']).toBe(`MaximaFictionBookEditor/${version}`);
    const body = request.body as { model: string; stream: boolean; max_tokens?: unknown };
    expect(body.model).toBe('standin-chat'); // the effective entry's, not the bundled gpt-oss-120b
    expect(body.stream).toBe(false);
    expect(body).not.toHaveProperty('max_tokens');
    const recorded = await core.aiRequests();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      method: 'ai.test',
      targetKind: 'free',
      serviceId: 'ovhcloud',
      outcome: 'ok',
      status: 200,
    });

    // A limit answer: the service's own words, in red.
    await standin.scenario({
      status: 429,
      retryAfter: 3,
      body: { message: 'API rate limit exceeded' },
    });
    await page.getByTestId('settings-ai-test').click();
    await expect(status).toHaveAttribute('data-status', 'failed', { timeout: 15_000 });
    await expect(status).toContainText('API rate limit exceeded');
    await expect(status).toHaveCSS('color', 'rgb(196, 43, 28)');
    expect(await standin.requests()).toHaveLength(2);

    await cancelSettings(page);
    // Nothing in the document changed (FR-005).
    expect(await documentXml(page)).toBe(xmlBefore);
    await expect(page).not.toHaveTitle(/\*/);
  });

  test('7. Edit list creates the user file from the bundled one once and never overwrites it', async ({
    core,
    page,
  }) => {
    const userFile = path.join(core.dataDir!, 'ai-services.json');
    expect(existsSync(userFile)).toBe(false);
    await openApp(page, core);
    await openAiPage(page);
    await expect(page.getByTestId('settings-ai-list-path')).toContainText(
      await pageText(page, 'dialog.settings.ai.files.userMissing', { path: userFile }),
    );

    // The folder opener answers 1050 `dialog.unavailable` headless (no shell) - tolerated.
    await page.getByTestId('settings-ai-edit-list').click();
    await expect(page.getByTestId('settings-ai-list-note')).toHaveText(
      await pageText(page, 'dialog.settings.ai.files.created'),
    );
    expect(existsSync(userFile)).toBe(true);
    expect(readFileSync(userFile).equals(bundledBytes!)).toBe(true);
    expect((await core.rpc<ServicesResult>('ai.services')).files.userExists).toBe(true);
    await expect(page.getByTestId('settings-ai-list-path')).toContainText(
      await pageText(page, 'dialog.settings.ai.files.user', { path: userFile }),
    );
    // The entries now come from the user file and replace the bundled ones.
    await expect(page.getByTestId('settings-ai-replaced')).toBeVisible();

    // A second press: nothing written, the file byte-identical.
    writeFileSync(userFile, readFileSync(userFile)); // keep as is; the mtime is irrelevant
    const before = readFileSync(userFile);
    await page.getByTestId('settings-ai-edit-list').click();
    await expect(page.getByTestId('settings-ai-list-note')).toHaveText(
      await pageText(page, 'dialog.settings.ai.files.exists'),
    );
    expect(readFileSync(userFile).equals(before)).toBe(true);
    await expect(page.getByTestId('dialog-folder-unavailable')).toHaveCount(0);
    await cancelSettings(page);
  });

  test('agreements: a seeded agreement is listed and withdrawn at once (FR-008)', async ({
    core,
    page,
  }) => {
    const at = '2026-10-22T10:00:00.000Z';
    await core.rpc('settings.set', {
      patch: { ai: { agreements: [{ service: 'standin', host: 'ai.standin.test:8787', at }] } },
    });
    await openApp(page, core);
    await openAiPage(page);
    const list = page.getByTestId('settings-ai-agreements');
    await expect(list).toContainText('standin');
    await expect(list).toContainText('ai.standin.test:8787');
    const revoke = page.getByTestId('settings-ai-agreement-standin-revoke');
    await expect(revoke).toBeVisible();
    await revoke.click();
    await expect(revoke).toHaveCount(0);
    // Written immediately, before OK (FR-008): settings.json has no agreement any more.
    await expect.poll(() => settingsJson(core.dataDir!).ai.agreements).toEqual([]);
    await expect(list).toContainText(await pageText(page, 'dialog.settings.ai.agreements.none'));
    await cancelSettings(page);
    expect(settingsJson(core.dataDir!).ai.agreements).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* Restart and the portable move: cores of their own                         */
/* ------------------------------------------------------------------------ */

test.describe('US1 (005) - the choice survives a restart and a portable move @platform', () => {
  let dir = '';
  let standin: StandinHandle | null = null;

  test.beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us1-ai-'));
  });

  test.afterAll(async () => {
    await standin?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  /** A core on `dataDir` and a page on it; the caller stops both. */
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
    const rpc = rpcClientOf(started.url);
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

  test('3+4. Pollinations chosen and OK: a second core shows it; a copied data directory keeps the choice and the list file', async ({
    browser,
    uiLang,
  }) => {
    standin ??= await startStandin();
    const dataDir = mkdtempSync(path.join(dir, 'data-'));
    const userFile = writeUserFile(dataDir, fixtureText('user-override.json', standin.port));

    // Scenario 3, first core: choose Pollinations, OK -> settings.json has the choice.
    const first = await coreAndPage(browser, dataDir, uiLang);
    try {
      await openAiPage(first.page);
      await expect(first.page.getByTestId('settings-ai-service')).toHaveValue('ovhcloud');
      await first.page.getByTestId('settings-ai-service').selectOption('pollinations');
      await first.page.getByTestId('dialog-settings-button-ok').click();
      await expect(first.page.getByTestId('dialog-settings')).toHaveCount(0);
      await expect
        .poll(() => settingsJson(dataDir).ai)
        .toMatchObject({ mode: 'free', freeServiceId: 'pollinations' });
    } finally {
      await first.stop();
    }

    // The second core on the same data directory: the same entry selected and in use.
    const second = await coreAndPage(browser, dataDir, uiLang);
    try {
      await openAiPage(second.page);
      await expect(second.page.getByTestId('settings-ai-mode-free')).toBeChecked();
      await expect(second.page.getByTestId('settings-ai-service')).toHaveValue('pollinations');
      // The user file of that directory is the one in use (the replaced ovhcloud is listed).
      await expect(
        second.page.getByTestId('settings-ai-service').locator('option').first(),
      ).toHaveText('OVHcloud AI Endpoints (stand-in) — standin-chat');
      await cancelSettings(second.page);
    } finally {
      await second.stop();
    }

    // Scenario 4, the portable move simulated by a copy: a third core on the copy uses the same
    // settings and the same list file; nothing is written to the old place.
    const copy = path.join(dir, 'moved-data');
    cpSync(dataDir, copy, { recursive: true });
    const listingBefore = readdirSync(dataDir).sort();
    const settingsBefore = readFileSync(path.join(dataDir, 'settings.json'));
    const third = await coreAndPage(browser, copy, uiLang);
    try {
      const services = await third.rpc.call<ServicesResult>('ai.services');
      expect(services.files.user).toBe(path.join(copy, 'ai-services.json'));
      expect(services.files.userExists).toBe(true);
      expect(services.services[0]).toMatchObject({
        id: 'ovhcloud',
        replaced: true,
        source: 'user',
      });
      await openAiPage(third.page);
      await expect(third.page.getByTestId('settings-ai-service')).toHaveValue('pollinations');
      await expect(third.page.getByTestId('settings-ai-list-path')).toContainText(
        path.join(copy, 'ai-services.json'),
      );
      await expect(third.page.getByTestId('settings-ai-list-path')).not.toContainText(userFile);
      await cancelSettings(third.page);
    } finally {
      await third.stop();
    }
    expect(readdirSync(dataDir).sort()).toEqual(listingBefore);
    expect(readFileSync(path.join(dataDir, 'settings.json')).equals(settingsBefore)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* The first-use notice: the stand-in under a hosted name                     */
/* ------------------------------------------------------------------------ */

test.describe('US1 (005) - the first-use notice before testing a hosted service @platform', () => {
  // A core of its own: `no_proxy` keeps a runner's proxy away from the hosted name.
  test.use({ coreEnv: { no_proxy: 'ai.standin.test' } });

  test.beforeEach(async ({ core, standin }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await standin.reset();
    await core.rpc('settings.set', { patch: { ai: null } });
    writeUserFile(
      core.dataDir!,
      JSON.stringify({
        version: 1,
        services: [
          {
            id: 'standin',
            name: 'Stand-in (hosted)',
            address: `http://ai.standin.test:${standin.port}/v1`,
            model: 'standin-chat',
            termsUrl: 'https://ai.standin.test/terms',
            limits: { en: 'none', ru: 'нет', uk: 'немає' },
          },
        ],
      }),
    );
    await reloadServices(core);
    await core.setAiResolve([`ai.standin.test:${standin.port}:127.0.0.1`]);
    await core.resetAiRequests();
  });

  test('No sends nothing; Yes is remembered at once and not asked again; withdrawal asks again', async ({
    core,
    page,
    standin,
  }) => {
    const host = `ai.standin.test:${standin.port}`;
    await openApp(page, core);
    await openAiPage(page);
    const select = page.getByTestId('settings-ai-service');
    await select.selectOption('standin');
    const status = page.getByTestId('settings-ai-status');
    const notice = page.getByTestId('dialog-ai-notice');

    // The notice: the service and its host, what leaves the computer, the terms link by href,
    // the plain-http sentence (a hosted http address).
    await page.getByTestId('settings-ai-test').click();
    await expect(notice).toBeVisible();
    await expect(page.getByTestId('dialog-ai-notice-service')).toContainText('Stand-in (hosted)');
    await expect(page.getByTestId('dialog-ai-notice-service')).toContainText(host);
    const sent = page.getByTestId('dialog-ai-notice-sent');
    for (const item of ['instruction', 'conversation', 'outline', 'parts', 'editor']) {
      await expect(sent).toContainText(await pageText(page, `ai.notice.sent.${item}`));
    }
    await expect(page.getByTestId('dialog-ai-notice-terms')).toHaveAttribute(
      'href',
      'https://ai.standin.test/terms',
    );
    await expect(page.getByTestId('dialog-ai-notice-unencrypted')).toBeVisible();
    // No (by keyboard: Escape): nothing is sent, nothing recorded, nothing agreed.
    await page.keyboard.press('Escape');
    await expect(notice).toHaveCount(0);
    await expect(status).toHaveAttribute('data-status', 'untested');
    expect(await standin.requests()).toEqual([]);
    expect(await core.aiRequests()).toEqual([]);
    expect(settingsJson(core.dataDir!).ai.agreements).toEqual([]);

    // Yes: the agreement is written at once (service and host), the test runs.
    await standin.scenario({ text: 'OK' });
    await page.getByTestId('settings-ai-test').click();
    await expect(notice).toBeVisible();
    await page.getByTestId('dialog-ai-notice-button-yes').click();
    await expect(notice).toHaveCount(0);
    await expect(status).toHaveAttribute('data-status', 'verified', { timeout: 15_000 });
    expect(settingsJson(core.dataDir!).ai.agreements).toMatchObject([{ service: 'standin', host }]);
    expect(await standin.requests()).toHaveLength(1);
    const revoke = page.getByTestId('settings-ai-agreement-standin-revoke');
    await expect(revoke).toBeVisible();
    await expect(page.getByTestId('settings-ai-agreements')).toContainText(host);

    // Not asked again for the same service and host: the request goes out at once.
    await standin.scenario({ text: 'OK' });
    await page.getByTestId('settings-ai-test').click();
    await expect.poll(async () => (await standin.requests()).length, { timeout: 15_000 }).toBe(2);
    await expect(status).toHaveAttribute('data-status', 'verified', { timeout: 15_000 });
    await expect(notice).toHaveCount(0);

    // Withdrawn: the notice returns before the next test; No again sends nothing.
    await revoke.click();
    await expect(revoke).toHaveCount(0);
    await expect.poll(() => settingsJson(core.dataDir!).ai.agreements).toEqual([]);
    await page.getByTestId('settings-ai-test').click();
    await expect(notice).toBeVisible();
    await page.getByTestId('dialog-ai-notice-button-no').click();
    await expect(notice).toHaveCount(0);
    expect(await standin.requests()).toHaveLength(2);
    expect((await core.aiRequests()).filter((r) => r.outcome === 'refused')).toEqual([]);

    // Cancel keeps the dialog's draft out of the settings: the choice was never saved.
    await cancelSettings(page);
    expect(settingsJson(core.dataDir!).ai.freeServiceId).toBe('ovhcloud');
  });
});
