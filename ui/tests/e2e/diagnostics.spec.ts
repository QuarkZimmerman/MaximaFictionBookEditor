/**
 * Diagnostics journey (T152, FR-131, quickstart scenario 18): a script error and a failed save
 * each append exactly one entry to `<data dir>/logs/mfbe-errors.log` with a stable code and
 * context (script id / docId / path) and never with book text. Also checks that `app.info`
 * points at the log folder the About dialog opens and that an uncaught UI error is logged.
 * Needs the real core; skipped otherwise.
 */

import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fileNew, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SCRIPT_FIXTURES = path.join(REPO_ROOT, 'tests', 'scripts', 'fixtures');

interface LogEntry {
  ts: string;
  level: string;
  source: string;
  code: string;
  message: string;
  context: Record<string, string>;
  stack?: string;
}

interface ScriptHooks {
  run(id: string): Promise<{ status: string }>;
}

declare const window: { __mfbeTest?: { scripts?: ScriptHooks } };

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

/**
 * Entries appended after the first `count` ones. With `code`, waits until an entry with that
 * code is among them: another entry may land first (an entry of the previous test's page
 * written as it closed, a warning of the core), and the first new line is then not the one the
 * test is about - the caller's filter decides, this only waits for the right moment.
 */
async function newEntries(
  core: CoreHandle,
  count: number,
  min = 1,
  code?: string,
): Promise<LogEntry[]> {
  await expect
    .poll(
      () => {
        const added = readLog(core).slice(count);
        if (code) return added.filter((entry) => entry.code === code).length;
        return added.length;
      },
      { timeout: 10_000, message: `log entries after ${count}${code ? ` with code ${code}` : ''}` },
    )
    .toBeGreaterThanOrEqual(min);
  return readLog(core).slice(count);
}

async function openApp(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
}

test.beforeAll(async ({ coreServer }) => {
  if (!coreServer.hasCore || !coreServer.dataDir) return;
  const target = path.join(coreServer.dataDir, 'scripts', '03_Errors');
  if (!existsSync(target)) {
    cpSync(path.join(SCRIPT_FIXTURES, '03_Errors'), target, { recursive: true });
  }
});

test.beforeEach(async ({ core }) => {
  test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
});

test.describe('diagnostics log (FR-131)', () => {
  test('app.info names the log folder and the log is JSON lines', async ({ core, page }) => {
    await openApp(core, page);
    const info = await core.rpc<{ logDir: string; version: string }>('app.info');
    expect(path.resolve(info.logDir)).toBe(path.resolve(path.dirname(logFile(core))));
    for (const entry of readLog(core)) {
      expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(['error', 'warning']).toContain(entry.level);
      expect(entry.context.version).toBe(info.version);
    }
  });

  test('a failing script appends one script.error entry with the script id, not the text', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await expect
      .poll(async () => page.evaluate(() => typeof window.__mfbeTest?.scripts?.run), {
        timeout: 15_000,
      })
      .toBe('function');
    await fileNew(page);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    const before = readLog(core).length;

    // The run settles once the error dialog is dismissed: start it without waiting.
    await page.evaluate(() => {
      void window.__mfbeTest!.scripts!.run('test.errors.throws');
    });
    const dialog = page.getByTestId('dialog-script-error');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('dialog-script-error-text')).toContainText('boom');
    await dialog.getByTestId('dialog-script-error-button-ok').click();

    const entries = await newEntries(core, before);
    const scriptErrors = entries.filter((entry) => entry.code === 'script.error');
    expect(scriptErrors, JSON.stringify(entries)).toHaveLength(1);
    const [entry] = scriptErrors;
    expect(entry!.level).toBe('error');
    expect(entry!.source).toBe('script');
    expect(entry!.message).toContain('boom');
    expect(entry!.context.scriptId).toBe('test.errors.throws');
    expect(entry!.context.line).toBe('4');
    expect(entry!.context.platform).toBeTruthy();
    // The paragraph the script inserted before failing is book text: never logged.
    expect(logText(core)).not.toContain('before the error');
  });

  test('a failed save appends one rpc.doc.ioError entry with docId and path, not the text', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await core.enqueueDialog('dialog.openFile', { paths: [fixtureBook('modern-utf8.fb2')] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await waitForBook(page, 'modern-utf8.fb2');
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    const docId = await page.getByTestId('body-view').getAttribute('data-doc-id');
    expect(docId).toBeTruthy();

    // A regular file where the target's directory should be: the atomic write cannot create
    // its temporary file there, so doc.save fails with doc.ioError.
    const blocker = path.join(core.dataDir!, 'not-a-directory');
    writeFileSync(blocker, 'x');
    const target = path.join(blocker, 'copy.fb2');
    const before = readLog(core).length;
    await core.enqueueDialog('dialog.saveFile', { path: target, encoding: 'utf-8' });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-saveAs').click();
    const failed = page.getByTestId('dialog-save-failed');
    await expect(failed).toBeVisible();
    await expect(page.getByTestId('dialog-save-failed-text')).toContainText(target);
    await failed.getByTestId('dialog-save-failed-button-ok').click();
    await expect(page).toHaveTitle(/^modern-utf8\.fb2/); // the document stays open

    const entries = await newEntries(core, before);
    expect(entries, JSON.stringify(entries)).toHaveLength(1); // exactly one line per failure
    const [entry] = entries;
    expect(entry!.level).toBe('error');
    expect(entry!.source).toBe('core');
    expect(entry!.code).toBe('rpc.doc.ioError');
    expect(entry!.context.method).toBe('doc.save');
    expect(entry!.context.docId).toBe(docId);
    expect(entry!.context.path).toBe(target);
    expect(entry!.context.reason).toBeTruthy();
    const text = logText(core);
    expect(text).not.toContain('Современная'); // book title / paragraph text
    expect(text).not.toContain(core.token!); // nor the session token
  });

  test('an uncaught UI error is logged with the document context', async ({ core, page }) => {
    await openApp(core, page);
    const before = readLog(core).length;
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('diagnostics-spec uncaught');
      }, 0);
    });
    const entries = await newEntries(core, before, 1, 'ui.unhandledError');
    const uncaught = entries.filter((entry) => entry.code === 'ui.unhandledError');
    expect(uncaught, JSON.stringify(entries)).toHaveLength(1);
    expect(uncaught[0]!.source).toBe('ui');
    expect(uncaught[0]!.message).toBe('diagnostics-spec uncaught');
    expect(uncaught[0]!.context.view).toBeTruthy();
    expect(uncaught[0]!.stack).toBeTruthy();

    // Rejections too, and the page URL (with the token) never ends up in the log.
    const count = readLog(core).length;
    await page.evaluate(() => {
      void Promise.reject(new Error('diagnostics-spec rejected'));
    });
    const added = await newEntries(core, count, 1, 'ui.unhandledRejection');
    const rejected = added.filter((entry) => entry.code === 'ui.unhandledRejection');
    expect(rejected, JSON.stringify(added)).toHaveLength(1);
    expect(logText(core)).not.toContain(core.token!);
  });
});
