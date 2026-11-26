/**
 * End-to-end Playwright journeys for Feature 021 — Maxima Library Lookup Service v2 integration
 * (`US1`–`US5`: T017, T023, T028, T035, T040).
 *
 * Runs against real `mfbe-core` (`MFBE_CORE_BIN`) and the deterministic loopback mock Lookup
 * Service v2 server (`helpers/mockMaximaLookupServer.ts`). Zero external network calls are made.
 */

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

import type { Page } from '@playwright/test';

import {
  expect,
  startCoreWith,
  test,
  waitForBook,
  waitForStartupDocument,
  type CoreHandle,
} from './fixtures/core';
import { MockMaximaLookupServer } from './helpers/mockMaximaLookupServer';

const VALID_TOKEN = 'e2e-secret-lookup-token-9876543210';

async function openMenu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

async function openMaximaSettings(page: Page): Promise<void> {
  await openMenu(page, 'tools', 'settings');
  await expect(page.getByTestId('dialog-settings')).toBeVisible();
  await page.getByTestId('settings-tab-maximaLibrary').click();
  await expect(page.getByTestId('settings-page-maximaLibrary')).toBeVisible();
}

async function enableMaximaIntegration(page: Page, domain: string, token: string): Promise<void> {
  await openMaximaSettings(page);
  const enableCheckbox = page.getByTestId('settings-maxima-enable');
  if (!(await enableCheckbox.isChecked())) {
    await enableCheckbox.check();
  }
  await page.getByTestId('settings-maxima-domain').fill(domain);
  await page.getByTestId('settings-maxima-token').fill(token);
  await page.getByTestId('settings-maxima-test').click();
  await expect(page.getByTestId('settings-maxima-status')).toHaveAttribute(
    'data-status',
    'verified',
  );
  await expect(page.getByTestId('dialog-settings-button-ok')).toBeEnabled();
  await page.getByTestId('dialog-settings-button-ok').click();
  await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
}

async function showDescription(page: Page): Promise<void> {
  await page.getByTestId('view-description').click();
  await expect(page.getByTestId('description-view')).toBeVisible();
}

async function showSource(page: Page): Promise<void> {
  await page.getByTestId('view-source').click();
  await expect(page.getByTestId('source-view')).toBeVisible();
  await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
}

async function openBookViaDialog(
  core: CoreHandle,
  page: Page,
  file: string,
  discardIfDirty = false,
): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await openMenu(page, 'file', 'open');
  if (discardIfDirty) {
    const noBtn = page.getByRole('dialog').getByRole('button', { name: 'No' });
    await noBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    if (await noBtn.isVisible()) {
      await noBtn.click();
    }
  }
  await waitForBook(page, file);
}

async function saveAsViaDialog(core: CoreHandle, page: Page, file: string): Promise<string> {
  await core.enqueueDialog('dialog.saveFile', { path: file, encoding: 'utf-8' });
  await openMenu(page, 'file', 'saveAs');
  const prompt = page.getByTestId('dialog-validation-failed');
  await expect
    .poll(
      async () =>
        (await prompt.count()) > 0 ||
        /saved|found/i.test(await page.getByTestId('status-message').innerText()),
    )
    .toBe(true);
  if ((await prompt.count()) > 0) {
    await page.getByTestId('dialog-validation-failed-button-yes').click();
  }
  await expect(page.getByTestId('status-message')).toContainText(/saved|found/i);
  return readFileSync(file, 'utf8');
}

function writeMinimalBook(dir: string, filename: string, extraCustomInfoXml = ''): string {
  const file = path.join(dir, filename);
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Lookup Test Book</book-title>
<lang>ru</lang>
</title-info>
<document-info>
<author><first-name>Doc</first-name><last-name>Maker</last-name></author>
<date value="2026-11-26">2026</date>
<id>lookup-test-0001</id>
<version>1.0</version>
</document-info>
${extraCustomInfoXml}
</description>
<body>
<section><p>Body text for lookup test.</p></section>
</body>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

function assertNoPlaintextTokenInDir(dir: string, secret: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      assertNoPlaintextTokenInDir(full, secret);
    } else if (entry.isFile()) {
      const content = readFileSync(full);
      expect(content.includes(Buffer.from(secret, 'utf8'))).toBe(false);
    }
  }
}

test.describe('Maxima Library Lookup Service v2 integration (feature 021)', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async ({ core }) => {
    if (!core.hasCore) return;
    await core
      .rpc('maximaLookup.saveConfig', {
        enabled: false,
        domain: 'https://maxima-library.com',
        clearToken: true,
      })
      .catch(() => {});
    await core.rpc('settings.set', { patch: { view: { theme: 'system' } } }).catch(() => {});
  });

  test('@platform US1: Settings defaults, Apply/OK test gate, errors, tab-leave revert, Cancel mid-test, encrypted persistence across restart, zero plaintext leaks (T017)', async ({
    page,
    core,
    browser,
  }) => {
    test.skip(!core.hasCore, 'requires real mfbe-core binary');
    const mock = new MockMaximaLookupServer();
    mock.setValidToken(VALID_TOKEN);
    const baseUrl = await mock.start();

    try {
      await page.goto(core.baseURL);
      await waitForStartupDocument(page);

      // Zero outbound traffic when disabled and zero Description lookup badges.
      await showDescription(page);
      expect(mock.requests).toHaveLength(0);
      await expect(page.getByTestId('description-author-0-lookup-confirmed')).toHaveCount(0);

      // Open Settings -> Maxima Library integration: verify defaults and disabled controls.
      await openMaximaSettings(page);
      await expect(page.getByTestId('settings-maxima-enable')).not.toBeChecked();
      await expect(page.getByTestId('settings-maxima-domain')).toHaveValue(
        'https://maxima-library.com',
      );
      await expect(page.getByTestId('settings-maxima-domain')).toBeDisabled();
      await expect(page.getByTestId('settings-maxima-token')).toBeDisabled();
      await expect(page.getByTestId('settings-maxima-test')).toBeDisabled();
      await expect(page.getByTestId('dialog-settings-button-apply')).toBeDisabled();
      await expect(page.getByTestId('dialog-settings-button-ok')).toBeEnabled();

      // Enable -> Apply/OK disabled until Test integration passes.
      await page.getByTestId('settings-maxima-enable').check();
      await expect(page.getByTestId('dialog-settings-button-apply')).toBeDisabled();
      await expect(page.getByTestId('dialog-settings-button-ok')).toBeDisabled();

      // External token link uses configured domain and records URL in test.openedUrls().
      await page.getByTestId('settings-maxima-domain').fill(baseUrl);
      const beforeLinks = (await core.rpc<string[]>('test.openedUrls')).length;
      await page.getByTestId('settings-maxima-token-link').click();
      await expect
        .poll(async () => (await core.rpc<string[]>('test.openedUrls')).slice(beforeLinks))
        .toContain(`${baseUrl}/index.php?option=com_maxlib&view=maxlibuserconfig&tab=token`);

      // Invalid token error -> distinct error feedback, Apply/OK remain disabled.
      await page.getByTestId('settings-maxima-token').fill('wrong-token');
      await page.getByTestId('settings-maxima-test').click();
      await expect(page.getByTestId('settings-maxima-status')).toHaveAttribute(
        'data-status',
        'failed',
      );
      await expect(page.getByTestId('dialog-settings-button-apply')).toBeDisabled();
      await expect(page.getByTestId('dialog-settings-button-ok')).toBeDisabled();

      // Tab-leave revert while unverified restores saved disabled state: OK re-enables, Apply stays disabled (no unsaved changes).
      await page.getByTestId('settings-tab-view').click();
      await expect(page.getByTestId('dialog-settings-button-apply')).toBeDisabled();
      await expect(page.getByTestId('dialog-settings-button-ok')).toBeEnabled();
      await page.getByTestId('settings-tab-maximaLibrary').click();
      await expect(page.getByTestId('settings-maxima-enable')).not.toBeChecked();

      // Cancel mid-test aborts in-flight verify cleanly without hanging.
      mock.setDelayMs(4000);
      await page.getByTestId('settings-maxima-enable').check();
      await page.getByTestId('settings-maxima-domain').fill(baseUrl);
      await page.getByTestId('settings-maxima-token').fill(VALID_TOKEN);
      await page.getByTestId('settings-maxima-test').click();
      await expect(page.getByTestId('settings-maxima-status')).toHaveAttribute(
        'data-status',
        'testing',
      );
      await page.getByTestId('dialog-settings-button-cancel').click();
      await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
      mock.setDelayMs(0);

      // Valid test -> Apply & OK unlock -> Save & verify encrypted persistence on disk.
      await enableMaximaIntegration(page, baseUrl, VALID_TOKEN);

      const settingsFile = path.join(core.dataDir!, 'settings.json');
      const tokenFile = path.join(core.dataDir!, 'maxima-lookup-token.json');
      const keyFile = path.join(core.dataDir!, 'maxima-lookup.key');
      expect(existsSync(settingsFile)).toBe(true);
      expect(existsSync(tokenFile)).toBe(true);
      expect(existsSync(keyFile)).toBe(true);

      const tokenJson = JSON.parse(readFileSync(tokenFile, 'utf8')) as Record<string, unknown>;
      expect(tokenJson.scheme).toBe('aes256gcm-keyfile');
      // Zero plaintext secret anywhere in dataDir (settings.json, token JSON, logs).
      assertNoPlaintextTokenInDir(core.dataDir!, VALID_TOKEN);

      // Verify encrypted token persists across a real core restart AND portable directory copy.
      const portableCopy = mkdtempSync(path.join(tmpdir(), 'mfbe-ml-portable-'));
      cpSync(core.dataDir!, portableCopy, { recursive: true });
      const secondCore = await startCoreWith(process.env.MFBE_CORE_BIN!, portableCopy, []);
      const secondPage = await browser.newPage();
      try {
        await secondPage.goto(secondCore.url);
        await waitForStartupDocument(secondPage);
        await openMaximaSettings(secondPage);
        await expect(secondPage.getByTestId('settings-maxima-enable')).toBeChecked();
        await expect(secondPage.getByTestId('settings-maxima-domain')).toHaveValue(baseUrl);
        await expect(secondPage.getByTestId('settings-maxima-status')).toHaveAttribute(
          'data-status',
          'verified',
        );
        // Reveal toggle fetches decrypted stored token on demand.
        await secondPage.getByTestId('settings-maxima-reveal').click();
        await expect(secondPage.getByTestId('settings-maxima-token')).toHaveAttribute(
          'type',
          'text',
        );
        await expect(secondPage.getByTestId('settings-maxima-token')).toHaveValue(VALID_TOKEN);
        await secondPage.getByTestId('dialog-settings-button-cancel').click();
      } finally {
        await secondPage.close();
        await secondCore.stop();
        rmSync(portableCopy, { recursive: true, force: true });
      }
    } finally {
      await mock.stop();
    }
  });

  test('US2: Live Person autocomplete, paging, external links, blur exists, edit/role withdrawal, and Document/Source title info silence (T023)', async ({
    page,
    core,
  }) => {
    test.skip(!core.hasCore, 'requires real mfbe-core binary');
    const mock = new MockMaximaLookupServer();
    mock.setValidToken(VALID_TOKEN);
    const baseUrl = await mock.start();

    try {
      await page.goto(core.baseURL);
      await waitForStartupDocument(page);
      await enableMaximaIntegration(page, baseUrl, VALID_TOKEN);
      await showDescription(page);
      mock.resetRequests();

      // 1. Author: first-name-only search (1000 ms debounce), suggestion external URL, pick clears empty middle name.
      await page.getByTestId('description-author-0-middle').fill('TemporaryMiddle');
      await page.getByTestId('description-author-0-last').fill('');
      await page.getByTestId('description-author-0-first').fill('Лев');
      await expect(page.getByTestId('description-author-0-lookup-dropdown')).toBeVisible({
        timeout: 4000,
      });

      const beforeUrls = (await core.rpc<string[]>('test.openedUrls')).length;
      await page.getByTestId('description-author-0-lookup-item-link-101').click();
      await expect
        .poll(async () => (await core.rpc<string[]>('test.openedUrls')).slice(beforeUrls))
        .toContain(
          `${baseUrl}/index.php?option=com_maxlib&view=maxlibbookslist&layout=author&id=101`,
        );

      // Pick Толстой Лев (#103, empty middleName) and verify TemporaryMiddle is explicitly cleared!
      await page.getByTestId('description-author-0-lookup-item-103').click();
      await expect(page.getByTestId('description-author-0-last')).toHaveValue('Толстой');
      await expect(page.getByTestId('description-author-0-first')).toHaveValue('Лев');
      await expect(page.getByTestId('description-author-0-middle')).toHaveValue('');
      await expect(page.getByTestId('description-author-0-lookup-confirmed')).toContainText('#103');

      // 2. Pagination check (35 paged authors "Пагинаторов Имя01..35", IDs 201..235).
      await page.getByTestId('description-author-add').click();
      await page.getByTestId('description-author-1-last').fill('Пагинаторов');
      await expect(page.getByTestId('description-author-1-lookup-dropdown')).toBeVisible({
        timeout: 4000,
      });
      await expect(page.getByTestId('description-author-1-lookup-next')).toBeEnabled();
      await page.getByTestId('description-author-1-lookup-next').click();
      await expect(page.getByTestId('description-author-1-lookup-page')).toContainText('2');
      await page.getByTestId('description-author-1-lookup-item-235').click();
      await expect(page.getByTestId('description-author-1-lookup-confirmed')).toContainText('#235');

      // 3. Translator blur exact-match confirmation + edit withdrawal.
      await page.getByTestId('description-translator-add').click();
      await page.getByTestId('description-translator-0-last').fill('Первомайский');
      await page.getByTestId('description-translator-0-first').fill('Аркадий');
      await page.getByTestId('description-translator-0-middle').fill('Петрович');
      await page.getByTestId('description-book-title').click();
      await expect(page.getByTestId('description-translator-0-lookup-confirmed')).toContainText(
        '#107',
      );
      await page.getByTestId('description-translator-0-first').fill('Аркадий2');
      await expect(page.getByTestId('description-translator-0-lookup-confirmed')).toHaveCount(0);

      // 4. Other persons (RoleList): pick illustrator (#108), then change role -> withdraws mlillustratorid.
      await page.getByTestId('description-role-add').click();
      await page.getByTestId('description-role-0-last').fill('Билиб');
      await expect(page.getByTestId('description-role-0-lookup-dropdown')).toBeVisible({
        timeout: 4000,
      });
      await page.getByTestId('description-role-0-lookup-item-108').click();
      await expect(page.getByTestId('description-role-0-lookup-confirmed')).toContainText('#108');
      await page.getByTestId('description-role-0-role').selectOption('editor');
      await expect(page.getByTestId('description-role-0-lookup-confirmed')).toHaveCount(0);

      // 5. Document info and Source title info MUST send zero lookup requests.
      await page.getByTestId('description-src-title-info-add').click();
      await page.getByTestId('description-sti-author-add').click();
      mock.resetRequests();
      await page.getByTestId('description-doc-author-0-last').fill('Толстой');
      await page.getByTestId('description-sti-author-0-last').fill('Толстой');
      await page.getByTestId('description-book-title').click();
      await page.waitForTimeout(1300);
      expect(mock.requests).toHaveLength(0);
    } finally {
      await mock.stop();
    }
  });

  test('US3: 3-tab Author Series + nested sub-series, Publisher multi-match advisory never blocking Save, 2-tab Publisher Series, and zero calls for Genres/Languages/open (T028)', async ({
    page,
    core,
  }) => {
    test.skip(!core.hasCore, 'requires real mfbe-core binary');
    const mock = new MockMaximaLookupServer();
    mock.setValidToken(VALID_TOKEN);
    const baseUrl = await mock.start();
    const tmp = mkdtempSync(path.join(tmpdir(), 'mfbe-ml-us3-'));

    try {
      await page.goto(core.baseURL);
      await waitForStartupDocument(page);
      await enableMaximaIntegration(page, baseUrl, VALID_TOKEN);

      // Opening a book with integration enabled sends ZERO automatic lookup requests.
      const startBook = writeMinimalBook(tmp, 'us3-start.fb2');
      mock.resetRequests();
      await openBookViaDialog(core, page, startBook);
      await showDescription(page);
      await page.waitForTimeout(500);
      expect(mock.requests).toHaveLength(0);

      // Confirm Author (Толстой Лев Николаевич #101) + Translator (Первомайский #107) -> enables all 3 Author Series tabs.
      await page.getByTestId('description-author-0-last').fill('Толстой');
      await page.getByTestId('description-author-0-first').fill('Лев');
      await page.getByTestId('description-author-0-middle').fill('Николаевич');
      await page.getByTestId('description-translator-add').click();
      await page.getByTestId('description-translator-0-last').fill('Первомайский');
      await page.getByTestId('description-translator-0-first').fill('Аркадий');
      await page.getByTestId('description-translator-0-middle').fill('Петрович');
      await page.getByTestId('description-book-title').click();
      await expect(page.getByTestId('description-author-0-lookup-confirmed')).toContainText('#101');

      // Author Series: empty box opens local "Type to search..." on All with 0 requests; narrowed tab fetches empty query.
      await page.getByTestId('description-sequence-add').click();
      mock.resetRequests();
      await page.getByTestId('description-sequence-0-name').click();
      await expect(page.getByTestId('description-sequence-0-lookup-type-prompt')).toBeVisible();
      await expect(page.getByTestId('description-sequence-0-lookup-tab-all')).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByTestId('description-sequence-0-lookup-tab-authors')).toBeVisible();
      await expect(page.getByTestId('description-sequence-0-lookup-tab-makers')).toBeVisible();
      expect(mock.requests).toHaveLength(0);

      await page.getByTestId('description-sequence-0-lookup-tab-authors').click();
      await expect(page.getByTestId('description-sequence-0-lookup-item-301')).toHaveAttribute(
        'data-highlight',
        'authors',
      );
      await page.getByTestId('description-sequence-0-lookup-item-301').click();
      await expect(page.getByTestId('description-sequence-0-lookup-confirmed')).toContainText(
        '#301',
      );
      await expect(page.getByTestId('description-sequence-0-number')).toBeFocused();

      // Nested sub-series sends excludedSeriesId: 301 and confirms #302 on blur via parentSeriesId: 301.
      await page.getByTestId('description-sequence-0-add-nested').click();
      await page.getByTestId('description-sequence-0-0-name').fill('Война и мир: Тома');
      await expect(page.getByTestId('description-sequence-0-0-lookup-dropdown')).toBeVisible({
        timeout: 4000,
      });
      // Parent series #301 must be excluded from child suggestions.
      await expect(page.getByTestId('description-sequence-0-0-lookup-item-301')).toHaveCount(0);
      await page.getByTestId('description-book-title').click();
      await expect(page.getByTestId('description-sequence-0-0-lookup-confirmed')).toContainText(
        '#302',
      );

      // Publisher: "Наука" has 2 homonyms (#403, #404) -> blur triggers advisory disambiguation, NEVER blocks Save!
      await page.getByTestId('description-publish-publisher').fill('Наука');
      await page.getByTestId('description-publish-city').click();
      await expect(
        page.getByTestId('description-publish-publisher-lookup-unresolved'),
      ).toBeVisible();
      await expect(
        page.getByTestId('description-publish-publisher-lookup-disambiguation'),
      ).toBeVisible();

      // File -> Save As succeeds completely unblocked even with unresolved Publisher!
      const savedUnresolved = path.join(tmp, 'us3-unresolved-save.fb2');
      await saveAsViaDialog(core, page, savedUnresolved);
      expect(existsSync(savedUnresolved)).toBe(true);

      // Now pick Publisher АСТ (#401, bookCount 15420) -> drives Publisher Series 2-tab lookup (All + By publisher).
      await page.getByTestId('description-publish-publisher').fill('АСТ');
      await expect(page.getByTestId('description-publish-publisher-lookup-item-401')).toContainText(
        '15420',
      );
      await page.getByTestId('description-publish-publisher-lookup-item-401').click();
      await expect(
        page.getByTestId('description-publish-publisher-lookup-confirmed'),
      ).toContainText('#401');

      await page.getByTestId('description-publish-sequence-add').click();
      await page.getByTestId('description-publish-sequence-0-name').click();
      await expect(
        page.getByTestId('description-publish-sequence-0-lookup-type-prompt'),
      ).toBeVisible();
      await page.getByTestId('description-publish-sequence-0-lookup-tab-publisher').click();
      await expect(
        page.getByTestId('description-publish-sequence-0-lookup-item-501'),
      ).toHaveAttribute('data-highlight', 'linked');
      await expect(
        page.getByTestId('description-publish-sequence-0-lookup-item-502'),
      ).toHaveAttribute('data-highlight', 'nameMatch');
      await page.getByTestId('description-publish-sequence-0-lookup-item-501').click();
      await expect(
        page.getByTestId('description-publish-sequence-0-lookup-confirmed'),
      ).toContainText('#501');

      // Blur exact-match on homonym "Золотой фонд" prioritizes #504 (linked to АСТ #401) over #505 (Эксмо).
      await page.getByTestId('description-publish-sequence-add').click();
      await page.getByTestId('description-publish-sequence-1-name').fill('Золотой фонд');
      await page.getByTestId('description-publish-city').click();
      await expect(
        page.getByTestId('description-publish-sequence-1-lookup-confirmed'),
      ).toContainText('#504');

      // Genres & Languages remain local and emit zero Lookup Service v2 requests.
      mock.resetRequests();
      await page.getByTestId('description-lang').selectOption('en');
      await page.waitForTimeout(600);
      expect(mock.requests).toHaveLength(0);
    } finally {
      await mock.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('US4: FB2 2.1 persistence, XSD validation, Custom info live sync, single-step Undo/Redo, zero-network reopen, and Source view Light/Dark highlight (T035)', async ({
    page,
    core,
  }) => {
    test.skip(!core.hasCore, 'requires real mfbe-core binary');
    const mock = new MockMaximaLookupServer();
    mock.setValidToken(VALID_TOKEN);
    const baseUrl = await mock.start();
    const tmp = mkdtempSync(path.join(tmpdir(), 'mfbe-ml-us4-'));

    try {
      await page.goto(core.baseURL);
      await waitForStartupDocument(page);
      await enableMaximaIntegration(page, baseUrl, VALID_TOKEN);

      // Open book with an unrelated <custom-info> and an unmatched pre-existing mlauthorid.
      const inputBook = writeMinimalBook(
        tmp,
        'us4-input.fb2',
        `<custom-info info-type="unrelated">Keep verbatim</custom-info>
<custom-info info-type="mlauthorid">999 Unmatched Historical</custom-info>`,
      );
      await openBookViaDialog(core, page, inputBook);
      await showDescription(page);

      // Pick Author #101 via autocomplete -> single atomic Undo/Redo check!
      await page.getByTestId('description-author-0-first').fill('');
      await page.getByTestId('description-author-0-last').fill('Толс');
      await expect(page.getByTestId('description-author-0-lookup-item-101')).toBeVisible({
        timeout: 4000,
      });
      await page.getByTestId('description-author-0-lookup-item-101').click();
      await expect(page.getByTestId('description-author-0-lookup-confirmed')).toContainText('#101');

      // One Undo step reverts BOTH the picked name parts AND the mlauthorid badge.
      await openMenu(page, 'edit', 'undo');
      await expect(page.getByTestId('description-author-0-last')).toHaveValue('Толс');
      await expect(page.getByTestId('description-author-0-lookup-confirmed')).toHaveCount(0);

      // One Redo step restores BOTH together.
      await openMenu(page, 'edit', 'redo');
      await expect(page.getByTestId('description-author-0-last')).toHaveValue('Толстой');
      await expect(page.getByTestId('description-author-0-lookup-confirmed')).toContainText('#101');

      // Also confirm a Publisher (#401) and verify NO publisher ID custom-info is written.
      await page.getByTestId('description-publish-publisher').fill('АСТ');
      await expect(page.getByTestId('description-publish-publisher-lookup-item-401')).toBeVisible({
        timeout: 4000,
      });
      await page.getByTestId('description-publish-publisher-lookup-item-401').click();

      // Save to disk and validate strictly against FB2 2.1 XSD.
      const savedPath = path.join(tmp, 'us4-saved.fb2');
      const xml = await saveAsViaDialog(core, page, savedPath);
      expect(xml).toContain(
        '<custom-info info-type="mlauthorid">101 Толстой Лев Николаевич</custom-info>',
      );
      expect(xml).toContain(
        '<custom-info info-type="mlauthorid">999 Unmatched Historical</custom-info>',
      );
      expect(xml).toContain('<custom-info info-type="unrelated">Keep verbatim</custom-info>');
      expect(xml).not.toContain('mlpublisherid');

      // Verify FB2 2.1 XSD validity via File -> Validate.
      await openMenu(page, 'file', 'validate');
      await expect(page.getByTestId('status-message')).toContainText(/no errors/i);

      // Live Custom info edit withdraws paired confirmation immediately.
      const customRows = page.locator('[data-testid^="description-custom-"][data-testid$="-text"]');
      const count = await customRows.count();
      let authorIdRowIndex = -1;
      for (let i = 0; i < count; i += 1) {
        const val = await customRows.nth(i).inputValue();
        if (val.includes('101 Толстой Лев Николаевич')) {
          authorIdRowIndex = i;
          break;
        }
      }
      expect(authorIdRowIndex).toBeGreaterThanOrEqual(0);
      await customRows.nth(authorIdRowIndex).fill('101 Edited Name');
      await expect(page.getByTestId('description-author-0-lookup-confirmed')).toHaveCount(0);

      // Close via File -> New (discarding the unsaved Custom info test edit) and reopen saved file:
      // confirmed state restores locally with ZERO network calls (and ephemeral Publisher state resets)!
      await openMenu(page, 'file', 'new');
      const noBtn = page.getByRole('dialog').getByRole('button', { name: 'No' });
      await expect(noBtn).toBeVisible();
      await noBtn.click();
      await waitForStartupDocument(page);

      mock.resetRequests();
      await openBookViaDialog(core, page, savedPath);
      await showDescription(page);
      await expect(page.getByTestId('description-author-0-lookup-confirmed')).toContainText('#101');
      await expect(page.getByTestId('description-publish-publisher-lookup-confirmed')).toHaveCount(
        0,
      );
      expect(mock.requests).toHaveLength(0);

      // Source view: scroll `<custom-info>` into the virtualized viewport, verify `.cm-maxima-custom-info`
      // highlights Maxima tags in Light AND Dark themes, leaves unrelated `<custom-info>` unhighlighted,
      // and remains freely editable with zero edit protection.
      await showSource(page);
      await page.locator('.cm-scroller').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      const marked = page.locator('.cm-maxima-custom-info');
      await expect(marked.first()).toBeVisible();
      const markedText = (await marked.allInnerTexts()).join('\n');
      expect(markedText).toContain('mlauthorid');
      expect(markedText).not.toContain('Keep verbatim');

      // Switch to Dark theme and confirm `.cm-maxima-custom-info` remains visible and styled.
      await openMenu(page, 'tools', 'settings');
      await page.getByTestId('settings-view-theme').selectOption('dark');
      await page.getByTestId('dialog-settings-button-ok').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('.cm-maxima-custom-info').first()).toBeVisible();

      // Confirm direct editing of the highlighted `<custom-info>` succeeds freely.
      await marked.first().click();
      await page.keyboard.type(' ');
      await expect(page).toHaveTitle(/\*/);
    } finally {
      await core.rpc('settings.set', { patch: { view: { theme: 'system' } } }).catch(() => {});
      await mock.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('US5: Graceful offline, 401/403/429/400/500 degradation, non-intrusive banner Retry & Settings shortcut, uninterrupted Save, zero secret leaks (T040)', async ({
    page,
    core,
  }) => {
    test.skip(!core.hasCore, 'requires real mfbe-core binary');
    const mock = new MockMaximaLookupServer();
    mock.setValidToken(VALID_TOKEN);
    const baseUrl = await mock.start();
    const tmp = mkdtempSync(path.join(tmpdir(), 'mfbe-ml-us5-'));

    try {
      await page.goto(core.baseURL);
      await waitForStartupDocument(page);
      await enableMaximaIntegration(page, baseUrl, VALID_TOKEN);
      await showDescription(page);

      // 1. HTTP 401 invalid_token -> non-intrusive banner, Settings... opens maximaLibrary tab.
      mock.setMode('invalid_token');
      await page.getByTestId('description-author-0-last').fill('Тол');
      await expect(page.getByTestId('description-maxima-banner')).toBeVisible({ timeout: 4000 });
      await expect(page.getByTestId('description-maxima-banner')).toHaveAttribute(
        'data-code',
        'invalid_token',
      );
      await page.getByTestId('description-maxima-banner-settings').click();
      await expect(page.getByTestId('dialog-settings')).toBeVisible();
      await expect(page.getByTestId('settings-page-maximaLibrary')).toBeVisible();
      await page.getByTestId('dialog-settings-button-cancel').click();

      // 2. HTTP 403 account_disabled -> banner updates cleanly.
      mock.setMode('account_disabled');
      await page.getByTestId('description-author-0-last').fill('Толс');
      await expect(page.getByTestId('description-maxima-banner')).toHaveAttribute(
        'data-code',
        'account_disabled',
        { timeout: 4000 },
      );

      // 3. HTTP 429 with Retry-After=2 -> suppresses requests during cooldown, resumes cleanly after.
      mock.setMode('rate_limited');
      mock.setRetryAfter(2);
      mock.resetRequests();
      await page.getByTestId('description-author-0-last').fill('Толст');
      await expect(page.getByTestId('description-maxima-banner')).toHaveAttribute(
        'data-code',
        'rate_limited',
        { timeout: 4000 },
      );
      const countAt429 = mock.requests.length;
      expect(countAt429).toBeGreaterThanOrEqual(1);

      // Typing immediately during 2 s cooldown sends ZERO additional server requests.
      await page.getByTestId('description-author-0-last').fill('Толсто');
      await page.waitForTimeout(1100);
      expect(mock.requests.length).toBe(countAt429);

      // Wait for cooldown to expire, restore server, click Retry -> succeeds and clears banner.
      mock.setMode('ok');
      await expect(page.getByTestId('description-maxima-banner-retry')).toBeEnabled({
        timeout: 4000,
      });
      await page.getByTestId('description-maxima-banner-retry').click();
      await expect(page.getByTestId('description-maxima-banner')).toHaveCount(0);

      // 4. HTTP 400 wrong_version & HTTP 500 server_error.
      mock.setMode('wrong_version');
      await page.getByTestId('description-author-0-last').fill('Дост');
      await expect(page.getByTestId('description-maxima-banner')).toHaveAttribute(
        'data-code',
        'wrong_version',
        { timeout: 4000 },
      );

      mock.setMode('server_error');
      await page.getByTestId('description-author-0-last').fill('Досто');
      await expect(page.getByTestId('description-maxima-banner')).toHaveAttribute(
        'data-code',
        'server_error',
        { timeout: 4000 },
      );

      // 5. Complete server drop (offline) -> non-intrusive offline banner, typing & Save unblocked.
      await mock.stop();
      await page.getByTestId('description-author-0-last').fill('Офлайн');
      await page.getByTestId('description-author-0-first').fill('Автор');
      await expect(page.getByTestId('description-maxima-banner')).toBeVisible({ timeout: 4000 });
      await page.getByTestId('description-book-title').fill('Saved While Offline');

      const offlineFile = path.join(tmp, 'us5-offline.fb2');
      const xml = await saveAsViaDialog(core, page, offlineFile);
      expect(xml).toContain('Saved While Offline');
      expect(xml).toContain('Офлайн');

      // Zero plaintext token anywhere in dataDir or logs.
      assertNoPlaintextTokenInDir(core.dataDir!, VALID_TOKEN);
    } finally {
      await mock.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
