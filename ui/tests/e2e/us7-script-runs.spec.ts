/**
 * Feature 002, User Story 7 - scripts stay under the user's control (T055; FR-051 to FR-053,
 * SC-009). On the 1 MB book of `tests/bench/gen-text-book.py` (5,000 paragraphs, generated into a
 * temporary folder) with the fixture scripts of `tests/scripts/fixtures/05_Runs` copied into
 * the user scripts folder:
 *
 *  - the run bar shows the progress and Cancel; the editor refuses typing during the run;
 *    Cancel restores the document within 2 s, also while the script is busy;
 *  - one Undo restores a run that changed 5,000 paragraphs exactly and Redo applies it again
 *    (0.0.1 lost the oldest changes: the editor kept 100 history steps);
 *  - a prompt in the middle of a run shows the changes made so far; Cancel while the script
 *    waits in it closes the prompt and restores the document.
 *
 * Feature 003, User Story 2 - a running script is unmistakable and can be stopped (T026;
 * FR-010 to FR-015), with the fixture scripts of `tests/scripts/fixtures/06_Runs`:
 *
 *  - the run banner above the document appears within half a second of the start - wherever
 *    the run is started from, with the status bar shown or hidden - with the script's name,
 *    the elapsed time counting up and Cancel, and shows the reported progress (phase and
 *    percentage, then phase and count);
 *  - the quiet lock: edits refused in the Body view and the Document Tree, the document- and
 *    view-changing commands unavailable, Find usable, Replace's buttons disabled, a second
 *    script refused, the busy pointer only while the script computes, a highlighted place
 *    fully visible while the script waits in its prompt;
 *  - Exit and the window-close request ask to cancel the run first (No keeps it running, Yes
 *    cancels and the save prompt follows);
 *  - the end of a run: the banner gone within half a second, "finished in N s" in the status
 *    bar, a transient notice after a run longer than 5 s that goes away by itself, no notice
 *    after a short run, a failure reported with the document as before the run.
 *
 * Needs the real core and `python3`; skipped otherwise.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import { expect, test, type CoreHandle } from './fixtures/core';
import { MOD, REPLACE } from './fixtures/keys';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FIXTURES = path.join(REPO_ROOT, 'tests', 'scripts', 'fixtures', '05_Runs');
const FIXTURES_003 = path.join(REPO_ROOT, 'tests', 'scripts', 'fixtures', '06_Runs');
const GENERATOR = path.join(REPO_ROOT, 'tests', 'bench', 'gen-text-book.py');

/** FR-051: Cancel restores the document within 2 seconds. */
const CANCEL_BUDGET_MS = 2_000;

/** FR-010 / FR-014: the banner appears and disappears within half a second. */
const BANNER_BUDGET_MS = 500;

interface ScriptHooks {
  list(): { id: string }[];
  run(id: string): Promise<{ status: string; message?: string }>;
  state(): {
    status: string;
    waiting?: boolean;
    elapsedMs?: number;
    durationMs?: number;
  } | null;
  document(): { path?: string } | null;
  toXml(): Promise<string>;
  select(nodeId: string, from?: number, to?: number): boolean;
}

declare const window: { __mfbeTest?: { scripts?: ScriptHooks } };

let booksDir = '';
let book = '';

test.beforeAll(async ({ coreServer }) => {
  booksDir = mkdtempSync(path.join(tmpdir(), 'mfbe-us7-'));
  spawnSync('python3', [GENERATOR, '--out-dir', booksDir, '--only', '1mb'], { encoding: 'utf8' });
  book = path.join(booksDir, 'clean-1mb.fb2');
  if (!coreServer.hasCore || !coreServer.dataDir) return;
  const target = path.join(coreServer.dataDir, 'scripts', '05_Runs');
  if (!existsSync(target)) cpSync(FIXTURES, target, { recursive: true });
  const target003 = path.join(coreServer.dataDir, 'scripts', '06_Runs');
  if (!existsSync(target003)) cpSync(FIXTURES_003, target003, { recursive: true });
});

test.afterAll(() => {
  rmSync(booksDir, { recursive: true, force: true });
});

test.beforeEach(async ({ core }) => {
  test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  test.skip(!existsSync(book), 'python3 / the book generator are not available');
});

interface SessionSettings {
  session: { toolbars: { status: boolean } };
}

async function openBook(page: Page, core: CoreHandle): Promise<void> {
  // A journey that failed with the status bar hidden must not take the next ones down: the
  // visibility is a saved session setting of this worker's core.
  const settings = await core.rpc<SessionSettings>('settings.get');
  if (!settings.session.toolbars.status) {
    await core.rpc('settings.set', { patch: { session: { toolbars: { status: true } } } });
  }
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  // Both fixture groups are listed (the catalogue follows the copied folders).
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const ids = new Set((window.__mfbeTest?.scripts?.list() ?? []).map((s) => s.id));
          return ids.has('runs.busy') && ids.has('runs.longSilent');
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await expect
    .poll(() => page.evaluate(() => window.__mfbeTest?.scripts?.document()?.path ?? null), {
      timeout: 30_000,
    })
    .toBe(book);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

const toXml = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.toXml());

async function start(page: Page, id: string): Promise<void> {
  await page.evaluate((scriptId) => {
    void window.__mfbeTest!.scripts!.run(scriptId);
  }, id);
}

const status = (page: Page) =>
  page.evaluate(() => window.__mfbeTest!.scripts!.state()?.status ?? 'none');

/** The first paragraph of the Body view (after the first section's title). */
const firstParagraph = (page: Page) =>
  page.getByTestId('body-editor').locator('.fb-section > p.fb-p').first();

/**
 * Every paragraph of the Body view in document order, the section titles included - the
 * order of `mfbe.doc.getElementsByTagName('p')` the fixture scripts use (index 0 is the first
 * section's title "Глава 1").
 */
const allParagraphs = (page: Page) => page.getByTestId('body-editor').locator('.fb-section p.fb-p');

// In-page snippets touching the DOM are string expressions: the e2e tsconfig has no DOM lib.
const BANNER_SELECTOR = '[data-testid="script-run-banner"]';

/**
 * Starts the script and measures, inside the page, the time from the call until the run
 * banner is in the document (ms; -1 when it did not appear within 10 s).
 */
const START_TIMED = `(scriptId) => {
  const t0 = performance.now();
  void window.__mfbeTest.scripts.run(scriptId);
  return new Promise((resolve) => {
    const check = () => {
      if (document.querySelector(${JSON.stringify(BANNER_SELECTOR)})) resolve(performance.now() - t0);
      else if (performance.now() - t0 > 10000) resolve(-1);
      else setTimeout(check, 10);
    };
    check();
  });
}`;

async function startTimed(page: Page, id: string): Promise<number> {
  return page.evaluate<number>(`(${START_TIMED})(${JSON.stringify(id)})`);
}

/**
 * Waits (inside the page) for the running script to end and measures the time from its end
 * until the run banner is gone (ms; -1 when the run did not end within the limit).
 */
const END_TIMED = `async (limit) => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const started = performance.now();
  while ((window.__mfbeTest.scripts.state() || {}).status === 'running') {
    if (performance.now() - started > limit) return -1;
    await wait(10);
  }
  const ended = performance.now();
  while (document.querySelector(${JSON.stringify(BANNER_SELECTOR)})) {
    if (performance.now() - ended > 5000) return performance.now() - ended;
    await wait(5);
  }
  return performance.now() - ended;
}`;

async function endTimed(page: Page, limitMs: number): Promise<number> {
  return page.evaluate<number>(`(${END_TIMED})(${limitMs})`);
}

/**
 * Effective opacity of the `index`-th element matching `selector`: the product of its own and
 * its ancestors' computed opacities; -1 when any of them is hidden or filtered (a greyed-out
 * place would show here), -2 without such an element.
 */
const EFFECTIVE_OPACITY = `(selector, index) => {
  const node = document.querySelectorAll(selector)[index];
  if (!node) return -2;
  let opacity = 1;
  for (let current = node; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.visibility === 'hidden' || style.filter !== 'none') return -1;
    opacity *= Number(style.opacity);
  }
  return opacity;
}`;

async function effectiveOpacity(page: Page, selector: string, index = 0): Promise<number> {
  return page.evaluate<number>(`(${EFFECTIVE_OPACITY})(${JSON.stringify(selector)}, ${index})`);
}

/** Simulates a paste of `text` into the Body editor (the editor's paste handler is the target). */
const PASTE_INTO_BODY = `(text) => {
  const editor = document.querySelector('[data-testid="body-editor"]');
  const data = new DataTransfer();
  data.setData('text/plain', text);
  editor.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
  );
}`;

async function pasteIntoBody(page: Page, text: string): Promise<void> {
  await page.evaluate(`(${PASTE_INTO_BODY})(${JSON.stringify(text)})`);
}

const BODY_PARAGRAPHS_SELECTOR = '[data-testid="body-editor"] .fb-section p.fb-p';

/** Opens the top-level menu `menu` and returns its popup. */
async function openMenu(page: Page, menu: string): Promise<Locator> {
  await page.getByTestId(`menu-${menu}`).click();
  const popup = page.getByTestId(`menu-${menu}-popup`);
  await expect(popup).toBeVisible();
  return popup;
}

/** Closes the open menu (Escape closes one level: an open submenu first). */
async function closeMenu(page: Page): Promise<void> {
  const popups = page.locator('.mfbe-menu-popup');
  for (let level = 0; level < 3 && (await popups.count()) > 0; level += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
  }
  await expect(popups).toHaveCount(0);
}

/** `data-testid` (or tag name) of the focused element; null without one. */
const ACTIVE_ELEMENT = `(() => {
  const el = document.activeElement;
  return el ? el.getAttribute('data-testid') || el.tagName : null;
})()`;

const activeElement = (page: Page) => page.evaluate<string | null>(ACTIVE_ELEMENT);

/** Makes the document modified: a word typed at the end of the first body paragraph. */
async function editFirstParagraph(page: Page): Promise<void> {
  const paragraph = allParagraphs(page).nth(1);
  const box = (await paragraph.boundingBox())!;
  await paragraph.click({ position: { x: box.width - 4, y: box.height / 2 } });
  await page.keyboard.press('End');
  await page.keyboard.type(' edited');
  await expect(paragraph).toHaveText(/ edited$/);
  await expect(page).toHaveTitle(/^clean-1mb\.fb2\* - /);
}

test.describe('US7 script runs', () => {
  test('run bar with progress and Cancel; no typing during the run; Cancel restores within 2 s', async ({
    page,
    core,
  }) => {
    await openBook(page, core);
    const before = await toXml(page);
    const original = await firstParagraph(page).innerText();
    await start(page, 'runs.busy');

    const runText = page.getByTestId('script-run-text');
    await expect(page.getByTestId('script-run-cancel')).toBeVisible();
    await expect(runText).toHaveText(/^Marking: \d+%$|^Busy: \d+$/);
    // Every paragraph changed and shown; the script keeps the worker busy now.
    await expect(runText).toHaveText(/^Busy: \d+$/, { timeout: 30_000 });
    await expect(firstParagraph(page)).toHaveText(/^#\d+ /);

    // The user cannot change the document meanwhile.
    const editor = page.getByTestId('body-editor');
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await firstParagraph(page).click();
    await page.keyboard.type('typed');
    await page.keyboard.press('Enter');
    await expect(firstParagraph(page)).not.toContainText('typed');
    await expect(page.getByTestId('toolbar-edit.undo')).toBeDisabled();

    const cancelled = Date.now();
    await page.getByTestId('script-run-cancel').click();
    await expect.poll(() => status(page), { timeout: CANCEL_BUDGET_MS }).toBe('cancelled');
    await expect(firstParagraph(page)).toHaveText(original, { timeout: CANCEL_BUDGET_MS });
    expect(Date.now() - cancelled, 'Cancel restores the document').toBeLessThan(CANCEL_BUDGET_MS);
    expect(await toXml(page)).toBe(before);
    await expect(page.getByTestId('script-run-bar')).toHaveCount(0);
    await expect(page.getByTestId('status-message')).toHaveText(/cancelled/);
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(page.getByTestId('toolbar-edit.undo')).toBeDisabled();
  });

  test('one Undo restores a run that changed 5,000 paragraphs; Redo applies it again', async ({
    page,
    core,
  }) => {
    await openBook(page, core);
    const before = await toXml(page);
    const result = await page.evaluate(() => window.__mfbeTest!.scripts!.run('runs.bulk'));
    expect(result.status).toBe('done');
    const after = await toXml(page);
    expect(after.match(/<p>#\d+ /g)?.length ?? 0).toBeGreaterThanOrEqual(5_000);
    await expect(firstParagraph(page)).toHaveText(/^#\d+ /);

    const undo = page.getByTestId('toolbar-edit.undo');
    await undo.click();
    await expect(undo).toBeDisabled();
    expect(await toXml(page)).toBe(before);
    await expect(firstParagraph(page)).not.toHaveText(/^#\d+ /);

    const redo = page.getByTestId('toolbar-edit.redo');
    await redo.click();
    await expect(redo).toBeDisabled();
    expect(await toXml(page)).toBe(after);
    await expect(firstParagraph(page)).toHaveText(/^#\d+ /);
  });

  test('a prompt in the middle of a run shows the changes so far; Cancel closes it and restores', async ({
    page,
    core,
  }) => {
    await openBook(page, core);
    const paragraphs = page.getByTestId('body-editor').locator('.fb-section p.fb-p');
    const original = await paragraphs.nth(1).innerText();

    // OK: the run goes on and finishes.
    await start(page, 'runs.prompt');
    const message = page.getByTestId('dialog-script-message');
    await expect(message).toBeVisible();
    await expect(paragraphs.nth(1)).toHaveText('Changed 1');
    await message.getByTestId('dialog-script-message-button-ok').click();
    await expect.poll(() => status(page)).toBe('done');
    const finished = await toXml(page);
    expect(finished).toContain('<p>Changed 9</p>');
    expect(finished).toContain('<p>Second 19</p>');

    // Cancel on the run bar while the script waits in its message box.
    const undo = page.getByTestId('toolbar-edit.undo');
    await undo.click();
    await expect(undo).toBeDisabled();
    const before = await toXml(page);
    await start(page, 'runs.prompt');
    await expect(message).toBeVisible();
    await expect(paragraphs.nth(1)).toHaveText('Changed 1');
    await page.getByTestId('script-run-cancel').click();
    await expect(message).toHaveCount(0);
    await expect.poll(() => status(page)).toBe('cancelled');
    await expect(paragraphs.nth(1)).toHaveText(original);
    expect(await toXml(page)).toBe(before);
  });
});

/* ------------------------------------------------------------------------ */
/* Feature 003, User Story 2                                                */
/* ------------------------------------------------------------------------ */

test.describe('US2 (003) a running script is unmistakable and can be stopped', () => {
  test('1. the banner appears within 500 ms wherever the run starts, with the status bar shown or hidden, and counts the time', async ({
    page,
    core,
  }) => {
    test.setTimeout(120_000);
    await openBook(page, core);
    const banner = page.getByTestId('script-run-banner');
    const elapsed = page.getByTestId('script-run-elapsed');

    // Body view, status bar shown: name, elapsed time counting up, Cancel; the status-bar
    // line of 0.0.2 remains in addition.
    const latency = await startTimed(page, 'runs.longSilent');
    expect(latency, 'banner shown within 500 ms').toBeGreaterThanOrEqual(0);
    expect(latency).toBeLessThan(BANNER_BUDGET_MS);
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-script-id', 'runs.longSilent');
    await expect(page.getByTestId('script-run-name')).toContainText('Long silent run');
    await expect(elapsed).toHaveText(/^00:0[0-1]$/);
    await expect(elapsed).toHaveText(/^00:0[1-9]$/, { timeout: 3_000 });
    const shown = await elapsed.textContent();
    await expect(elapsed).not.toHaveText(shown!, { timeout: 3_000 });
    await expect(banner.getByTestId('script-run-cancel')).toBeVisible();
    await expect(page.getByTestId('script-run-bar')).toBeVisible();
    // The banner takes its own room above the document: nothing of the document is covered.
    const bannerBox = (await banner.boundingBox())!;
    const contentBox = (await page.locator('.mfbe-view-content').boundingBox())!;
    expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(contentBox.y + 1);
    expect(await effectiveOpacity(page, '[data-testid="body-editor"]')).toBe(1);

    // Cancel from the banner: the run ends, the banner goes within 500 ms.
    const cancelled = Date.now();
    await banner.getByTestId('script-run-cancel').click();
    await expect.poll(() => status(page), { timeout: CANCEL_BUDGET_MS }).toBe('cancelled');
    await expect(banner).toHaveCount(0, { timeout: BANNER_BUDGET_MS });
    expect(Date.now() - cancelled).toBeLessThan(CANCEL_BUDGET_MS);
    await expect(page.getByTestId('status-message')).toHaveText(/cancelled/);

    // Status bar hidden, the run started from the Source view: the banner is there all the
    // same (the run itself takes place in the Body view).
    await (await openMenu(page, 'view')).getByTestId('menu-view-statusBar').click();
    await expect(page.getByTestId('statusbar')).toHaveCount(0);
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'source');
    const fromSource = await startTimed(page, 'runs.longSilent');
    expect(fromSource).toBeGreaterThanOrEqual(0);
    expect(fromSource).toBeLessThan(BANNER_BUDGET_MS);
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'body');
    await expect(elapsed).toHaveText(/^00:0[1-9]$/, { timeout: 3_000 });
    // The status bar's panes stay hidden (the run line of 0.0.2 may show on its own).
    await expect(page.getByTestId('status-path')).toHaveCount(0);
    await expect(page.getByTestId('status-insmode')).toHaveCount(0);
    await banner.getByTestId('script-run-cancel').click();
    await expect(banner).toHaveCount(0, { timeout: BANNER_BUDGET_MS });
    await expect.poll(() => status(page)).toBe('cancelled');
    await expect(page.getByTestId('statusbar')).toHaveCount(0);

    // ... and started from the Description view.
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'description');
    const fromDescription = await startTimed(page, 'runs.longSilent');
    expect(fromDescription).toBeGreaterThanOrEqual(0);
    expect(fromDescription).toBeLessThan(BANNER_BUDGET_MS);
    await expect(banner).toBeVisible();
    await expect(banner.getByTestId('script-run-cancel')).toBeVisible();
    await expect(page.getByTestId('status-path')).toHaveCount(0);
    await banner.getByTestId('script-run-cancel').click();
    await expect(banner).toHaveCount(0, { timeout: BANNER_BUDGET_MS });
    await expect.poll(() => status(page)).toBe('cancelled');
    await (await openMenu(page, 'view')).getByTestId('menu-view-statusBar').click();
    await expect(page.getByTestId('statusbar')).toBeVisible();
    // The visibility is a session setting saved with a delay: wait for it, so the next test
    // of this worker starts with the status bar shown.
    await expect
      .poll(async () => (await core.rpc<SessionSettings>('settings.get')).session.toolbars.status)
      .toBe(true);
  });

  test('2. progress: phase and percentage with a total, phase and count without; a long run ends with the duration and a notice', async ({
    page,
    core,
  }) => {
    test.setTimeout(120_000);
    await openBook(page, core);
    const banner = page.getByTestId('script-run-banner');
    const progress = page.getByTestId('script-run-progress');

    await start(page, 'runs.longProgress');
    await expect(banner).toBeVisible();
    await expect(progress).toHaveText(/^Counting — \d+\/40 \(\d+ %\)$/);
    await expect(progress).toHaveText(/^Still working — \d+$/, { timeout: 8_000 });
    await expect(page.getByTestId('script-run-elapsed')).toHaveText(/^00:0[4-9]$/);
    // Where the focus is while the run goes on: the notice must not take it.
    const focusedBefore = await activeElement(page);

    // The end: the banner gone within 500 ms, "finished in N s" in the status bar and, the
    // run being longer than 5 s, as a notice in the work area.
    const gone = await endTimed(page, 15_000);
    expect(gone, 'the run ended').toBeGreaterThanOrEqual(0);
    expect(gone).toBeLessThan(BANNER_BUDGET_MS);
    expect(await status(page)).toBe('done');
    const finishedIn = /^Script "Long run with progress" finished in (\d+) s$/;
    await expect(page.getByTestId('status-message')).toHaveText(finishedIn);
    const seconds = Number(
      finishedIn.exec((await page.getByTestId('status-message').textContent())!)![1],
    );
    expect(seconds).toBeGreaterThanOrEqual(8);
    expect(seconds).toBeLessThanOrEqual(12);
    const notice = page.getByTestId('transient-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText(finishedIn);
    await expect(notice).toHaveAttribute('role', 'status');
    // Never focused: the focus is where it was, nothing in the notice can take it; the
    // document is editable again.
    expect(await activeElement(page)).toBe(focusedBefore);
    expect(await activeElement(page)).not.toBe('transient-notice');
    expect(await notice.locator('button, a, input, [tabindex]').count()).toBe(0);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    await expect(allParagraphs(page).nth(0)).toHaveText('Changed by the long run with progress');
    // It stays for a while, then goes away by itself.
    await page.waitForTimeout(2_000);
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCount(0, { timeout: 6_000 });
    expect(await activeElement(page)).toBe(focusedBefore);
  });

  test('3. a short run: the status bar says how long it took, no notice, the banner gone within 500 ms', async ({
    page,
    core,
  }) => {
    await openBook(page, core);
    await start(page, 'runs.short');
    await expect(page.getByTestId('script-run-banner')).toBeVisible();
    await expect(page.getByTestId('script-run-name')).toContainText('Short run');
    const gone = await endTimed(page, 10_000);
    expect(gone).toBeGreaterThanOrEqual(0);
    expect(gone).toBeLessThan(BANNER_BUDGET_MS);
    expect(await status(page)).toBe('done');
    await expect(page.getByTestId('status-message')).toHaveText(
      /^Script "Short run" finished in [12] s$/,
    );
    await expect(allParagraphs(page).nth(0)).toHaveText('Changed by the short run');
    // No notice for a run of about a second (the threshold is 5 s).
    await expect(page.getByTestId('transient-notice')).toHaveCount(0);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('transient-notice')).toHaveCount(0);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
  });

  test('4. a failing run: the error is reported, the banner is gone and the document is as before', async ({
    page,
    core,
  }) => {
    await openBook(page, core);
    const before = await toXml(page);
    const title = await allParagraphs(page).nth(0).innerText();
    await start(page, 'runs.failing');
    await expect(page.getByTestId('script-run-banner')).toBeVisible();
    const gone = await endTimed(page, 10_000);
    expect(gone).toBeGreaterThanOrEqual(0);
    expect(gone).toBeLessThan(BANNER_BUDGET_MS);
    expect(await status(page)).toBe('failed');
    const error = page.getByTestId('dialog-script-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Script error: Failing fixture: deliberate failure');
    await error.getByTestId('dialog-script-error-button-ok').click();
    await expect(error).toHaveCount(0);
    await expect(page.getByTestId('status-message')).toHaveText(/failed/);
    await expect(allParagraphs(page).nth(0)).toHaveText(title);
    expect(await toXml(page)).toBe(before);
    await expect(page.getByTestId('transient-notice')).toHaveCount(0);
    await expect(page.getByTestId('toolbar-edit.undo')).toBeDisabled();
  });

  test('5. the quiet lock during a long silent run: edits refused, commands unavailable, Find usable, no second script', async ({
    page,
    core,
  }) => {
    test.setTimeout(150_000);
    await openBook(page, core);
    const editor = page.getByTestId('body-editor');
    const paragraphs = allParagraphs(page);
    const before = await toXml(page);
    const paragraphCount = await paragraphs.count();
    const original = await paragraphs.nth(1).innerText();

    // The Replace dialog is open before the run: its Replace buttons go unavailable.
    await page.keyboard.press(REPLACE);
    const replace = page.getByTestId('dialog-replace');
    await expect(replace).toBeVisible();
    await page.getByTestId('dialog-replace-query').fill('книга');
    await expect(page.getByTestId('dialog-replace-button-replace')).toBeEnabled();

    await start(page, 'runs.longSilent');
    const banner = page.getByTestId('script-run-banner');
    await expect(banner).toBeVisible();
    // The script computes: the pointer over the document shows the busy state.
    await expect(page.locator('.mfbe-view-content.mfbe-busy')).toHaveCount(1);
    expect(await effectiveOpacity(page, '[data-testid="body-editor"]')).toBe(1);

    await expect(page.getByTestId('dialog-replace-button-replace')).toBeDisabled();
    await expect(page.getByTestId('dialog-replace-button-replaceAll')).toBeDisabled();
    await expect(page.getByTestId('dialog-replace-button-findNext')).toBeEnabled();
    await page.getByTestId('dialog-replace-button-cancel').click();
    await expect(replace).toHaveCount(0);

    // Typing, Enter, inserted and pasted text change nothing in the Body view.
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await paragraphs.nth(1).click();
    await page.keyboard.type('typed');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('inserted');
    await pasteIntoBody(page, 'pasted');
    await page.keyboard.press(`${MOD}+b`);
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await expect(paragraphs.nth(1)).toHaveText(original);
    await expect(paragraphs).toHaveCount(paragraphCount);
    expect(await toXml(page)).toBe(before);

    // Document Tree: the operations are unavailable; a drag and Delete change nothing.
    for (const button of ['right', 'right-smart', 'left', 'merge', 'delete']) {
      await expect(page.getByTestId(`tree-toolbar-${button}`)).toBeDisabled();
    }
    const rows = page.locator('[data-testid^="tree-row-"]');
    await expect(rows.nth(2)).toBeVisible();
    const from = (await rows.nth(1).boundingBox())!;
    const to = (await rows.nth(2).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height - 1, { steps: 4 });
    await page.mouse.up();
    await rows.nth(1).click();
    await page.getByTestId('tree-content').focus();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('tree-delete-confirm')).toHaveCount(0);
    await rows.nth(1).click({ button: 'right' });
    await expect(page.getByTestId('tree-menu')).toBeVisible();
    await expect(page.getByTestId('tree-menu-delete')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('tree-menu-moveRight')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tree-menu')).toHaveCount(0);
    expect(await toXml(page)).toBe(before);

    // Edit and Add: the document-changing items are unavailable; Find and Copy stay (Copy
    // needs a selection: a paragraph selected the way the harness does it).
    const selectedId = (await paragraphs.nth(2).getAttribute('data-node-id'))!;
    expect(await page.evaluate((id) => window.__mfbeTest!.scripts!.select(id), selectedId)).toBe(
      true,
    );
    await expect(page.getByTestId('body-view')).toHaveAttribute('data-selected-text', /\S/);
    const edit = await openMenu(page, 'edit');
    for (const item of ['undo', 'cut', 'paste', 'replace', 'clone', 'split', 'merge']) {
      await expect(edit.getByTestId(`menu-edit-${item}`)).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(edit.getByTestId('menu-edit-find')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(edit.getByTestId('menu-edit-copy')).not.toHaveAttribute('aria-disabled', 'true');
    await closeMenu(page);
    const add = await openMenu(page, 'add');
    for (const item of ['body', 'title', 'epigraph', 'image', 'poem', 'table', 'binary']) {
      await expect(add.getByTestId(`menu-add-${item}`)).toHaveAttribute('aria-disabled', 'true');
    }
    await closeMenu(page);

    // View switching refused: tabs, menu and hotkeys leave the Body view in place.
    await expect(page.getByTestId('view-source')).toBeDisabled();
    await expect(page.getByTestId('view-description')).toBeDisabled();
    const view = await openMenu(page, 'view');
    await expect(view.getByTestId('menu-view-source')).toHaveAttribute('aria-disabled', 'true');
    await expect(view.getByTestId('menu-view-description')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await closeMenu(page);
    await page.keyboard.press('Alt+F3');
    await page.keyboard.press('Alt+F1');
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'body');

    // File: New, Open, the recent files, Save and Save As unavailable; Exit available.
    const file = await openMenu(page, 'file');
    for (const item of ['new', 'open', 'save', 'saveAs']) {
      await expect(file.getByTestId(`menu-file-${item}`)).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(file.getByTestId('menu-file-exit')).not.toHaveAttribute('aria-disabled', 'true');
    await file.getByTestId('menu-file-recent').hover();
    const recent = page
      .getByTestId('menu-file-recent-popup')
      .locator('[data-testid^="menu-file-recent-recent"]');
    await expect(recent.first()).toBeVisible();
    for (const item of await recent.all()) {
      await expect(item).toHaveAttribute('aria-disabled', 'true');
    }
    await closeMenu(page);
    await page.keyboard.press(`${MOD}+s`);
    await page.keyboard.press(`${MOD}+o`);
    await page.keyboard.press(`${MOD}+n`);
    await expect(page.getByTestId('dialog-save-changes')).toHaveCount(0);
    await expect(page).toHaveTitle(/^clean-1mb\.fb2 - /);
    await expect(page.getByTestId('toolbar-file.save')).toBeDisabled();
    await expect(page.getByTestId('toolbar-file.open')).toBeDisabled();
    await expect(page.getByTestId('toolbar-file.new')).toBeDisabled();

    // Settings unavailable; Help > About opens.
    const tools = await openMenu(page, 'tools');
    await expect(tools.getByTestId('menu-tools-settings')).toHaveAttribute('aria-disabled', 'true');
    await closeMenu(page);
    await (await openMenu(page, 'help')).getByTestId('menu-help-about').click();
    const about = page.getByTestId('dialog-about');
    await expect(about).toBeVisible();
    await expect(banner).toBeVisible();
    await about.getByTestId('dialog-about-button-close').click();
    await expect(about).toHaveCount(0);

    // Find works: a match is selected in the (locked) text.
    await page.keyboard.press(`${MOD}+f`);
    const find = page.getByTestId('dialog-find');
    await expect(find).toBeVisible();
    await page.getByTestId('dialog-find-query').fill('книга');
    await page.getByTestId('dialog-find-button-findNext').click();
    await expect(page.getByTestId('body-view')).toHaveAttribute('data-selected-text', /книга/i);
    await page.getByTestId('dialog-find-button-cancel').click();
    await expect(find).toHaveCount(0);

    // No second script: the menu items are unavailable and a run attempt says so.
    const scripts = await openMenu(page, 'scripts');
    await scripts.getByTestId('menu-scripts-06_Runs').hover();
    await expect(page.getByTestId('menu-scripts-06_Runs-runs.short')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(scripts.getByTestId('menu-scripts-last')).toHaveAttribute('aria-disabled', 'true');
    await closeMenu(page);
    await start(page, 'runs.short');
    const busy = page.getByTestId('dialog-script-busy');
    await expect(busy).toBeVisible();
    await expect(busy).toContainText('"Long silent run"');
    await busy.getByTestId('dialog-script-busy-button-ok').click();
    await expect(busy).toHaveCount(0);

    // Still the same run, still computing; Cancel ends it and the document is as before.
    expect(await status(page)).toBe('running');
    await expect(banner).toHaveAttribute('data-script-id', 'runs.longSilent');
    await expect(page.locator('.mfbe-view-content.mfbe-busy')).toHaveCount(1);
    expect(await toXml(page)).toBe(before);
    await banner.getByTestId('script-run-cancel').click();
    await expect.poll(() => status(page), { timeout: CANCEL_BUDGET_MS }).toBe('cancelled');
    await expect(banner).toHaveCount(0);
    await expect(page.locator('.mfbe-view-content.mfbe-busy')).toHaveCount(0);
    expect(await toXml(page)).toBe(before);
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(page.getByTestId('view-source')).toBeEnabled();
  });

  test('6. while the script waits in its prompt: no busy pointer, the highlighted place fully visible, the dialog works', async ({
    page,
    core,
  }) => {
    await openBook(page, core);
    const paragraphs = allParagraphs(page);
    const before = await toXml(page);
    await start(page, 'runs.prompting');
    const prompt = page.getByTestId('dialog-script-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('Prompting fixture');

    // Waiting, not computing: the banner stays, the busy pointer does not.
    const banner = page.getByTestId('script-run-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-waiting', 'true');
    await expect(page.locator('.mfbe-view-content.mfbe-busy')).toHaveCount(0);
    expect(await page.evaluate(() => window.__mfbeTest!.scripts!.state()?.waiting)).toBe(true);

    // The highlighted paragraph is shown, selected and not greyed.
    const highlighted = paragraphs.nth(1);
    await expect(highlighted).toHaveText('Highlighted by the prompting fixture');
    await expect(highlighted).toBeInViewport();
    expect(await effectiveOpacity(page, BODY_PARAGRAPHS_SELECTOR, 1)).toBe(1);
    expect(await effectiveOpacity(page, '.mfbe-view-content')).toBe(1);
    await expect(page.getByTestId('body-view')).toHaveAttribute(
      'data-selected-text',
      'Highlighted by the prompting fixture',
    );

    // The prompt works; its answer lands in the third paragraph and the run finishes.
    await prompt.getByTestId('dialog-script-prompt-input').fill('Answered in the prompt');
    await prompt.getByTestId('dialog-script-prompt-button-ok').click();
    await expect(prompt).toHaveCount(0);
    await expect.poll(() => status(page)).toBe('done');
    await expect(banner).toHaveCount(0);
    await expect(paragraphs.nth(2)).toHaveText('Answered in the prompt');
    expect(await toXml(page)).toContain('<p>Answered in the prompt</p>');

    // Cancel in the banner while the script waits: prompt closed, document as before the run.
    await page.getByTestId('toolbar-edit.undo').click();
    expect(await toXml(page)).toBe(before);
    await start(page, 'runs.prompting');
    await expect(prompt).toBeVisible();
    await banner.getByTestId('script-run-cancel').click();
    await expect(prompt).toHaveCount(0);
    await expect.poll(() => status(page)).toBe('cancelled');
    await expect(banner).toHaveCount(0);
    expect(await toXml(page)).toBe(before);
  });

  test('7. Exit and the window-close request ask to cancel the run first; the save prompt follows', async ({
    page,
    core,
  }) => {
    test.setTimeout(120_000);
    await openBook(page, core);
    await editFirstParagraph(page);
    const edited = await toXml(page);
    const banner = page.getByTestId('script-run-banner');
    const cancelRun = page.getByTestId('cancel-run-prompt');
    const saveChanges = page.getByTestId('dialog-save-changes');

    await start(page, 'runs.longSilent');
    await expect(banner).toBeVisible();

    // File > Exit: "A script is running. Cancel it and exit?" - No keeps the run going.
    await (await openMenu(page, 'file')).getByTestId('menu-file-exit').click();
    await expect(cancelRun).toBeVisible();
    await expect(cancelRun).toContainText('A script is running. Cancel it and exit?');
    await cancelRun.getByTestId('cancel-run-prompt-button-no').click();
    await expect(cancelRun).toHaveCount(0);
    await expect(saveChanges).toHaveCount(0);
    expect(await status(page)).toBe('running');
    await expect(banner).toBeVisible();

    // Yes cancels the run (document restored) and the usual save prompt follows; its Cancel
    // abandons the exit.
    await (await openMenu(page, 'file')).getByTestId('menu-file-exit').click();
    await expect(cancelRun).toBeVisible();
    await cancelRun.getByTestId('cancel-run-prompt-button-yes').click();
    await expect.poll(() => status(page), { timeout: CANCEL_BUDGET_MS }).toBe('cancelled');
    await expect(banner).toHaveCount(0);
    await expect(saveChanges).toBeVisible();
    await expect(saveChanges).toContainText('Save changes to clean-1mb.fb2?');
    expect(await toXml(page)).toBe(edited);
    await saveChanges.getByTestId('dialog-save-changes-button-cancel').click();
    await expect(saveChanges).toHaveCount(0);
    await expect(page).toHaveTitle(/^clean-1mb\.fb2\* - /);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    await expect(page.getByTestId('status-message')).toHaveText(/cancelled/);

    // The window-close request of the shell (`app.closeRequested`, emitted headless by
    // `test.requestClose`) runs the same flow with the same two outcomes.
    await start(page, 'runs.longSilent');
    await expect(banner).toBeVisible();
    await core.rpc('test.requestClose');
    await expect(cancelRun).toBeVisible();
    await cancelRun.getByTestId('cancel-run-prompt-button-no').click();
    await expect(cancelRun).toHaveCount(0);
    await expect(saveChanges).toHaveCount(0);
    expect(await status(page)).toBe('running');
    await expect(banner).toBeVisible();

    await core.rpc('test.requestClose');
    await expect(cancelRun).toBeVisible();
    await cancelRun.getByTestId('cancel-run-prompt-button-yes').click();
    await expect.poll(() => status(page), { timeout: CANCEL_BUDGET_MS }).toBe('cancelled');
    await expect(banner).toHaveCount(0);
    await expect(saveChanges).toBeVisible();
    expect(await toXml(page)).toBe(edited);
    await saveChanges.getByTestId('dialog-save-changes-button-cancel').click();
    await expect(saveChanges).toHaveCount(0);
    await expect(page).toHaveTitle(/^clean-1mb\.fb2\* - /);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
  });
});
