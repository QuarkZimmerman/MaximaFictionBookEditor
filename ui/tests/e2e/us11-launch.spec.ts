/**
 * User Story 11 - Install and launch from the operating system (T137), scenarios 4-6 as far as
 * they are observable through the core and the UI without a desktop:
 *
 *  4a. a file path given at start-up is opened: `mfbe-core serve --open <file>` emits the same
 *      `app.openPaths` notification the shell sends for FILE arguments, OS file associations
 *      and a second instance (contracts/cli.md), and the UI opens the document;
 *  4b. invalid options produce "Invalid command line option: '<opt>'" and exit code 2 - for
 *      `mfbe-core` always and for the `mfbe` shell when a build of it is available
 *      (MFBE_APP_BIN or build/linux-app-*\/bin/mfbe; the shell parses its command line before
 *      the browser engine starts, so no display is needed);
 *  5.  previously opened files are listed under File > Recent Files (newest first, numbered)
 *      and open on click;
 *  6.  a genre file dropped into the per-user genres folder (<data-dir>/genres/*.genres.tsv -
 *      the layered lookup of contracts/resource-formats.md §2) appears in the genre picker with
 *      its source and is accepted by validation after the list is reloaded.
 *
 * Needs the real core (`MFBE_CORE_BIN=../build/linux-app-debug/bin/mfbe-core`); skipped in
 * core-less mode and against the fake core.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  expect,
  fileNew,
  startCoreWith,
  test,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import type { Page } from '@playwright/test';

const APP_TITLE = 'Maxima Fiction Book Editor';
const UI_DIR = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = path.resolve(UI_DIR, '..');

interface DocumentJson {
  docId: string;
  description: { titleInfo: { genres: { code: string }[] } };
}

interface ValidationJson {
  errorCount: number;
  warningCount: number;
  issues: { code?: string; message?: string }[];
}

interface GenreCatalog {
  entries: { code: string; source: string; names: Record<string, string> }[];
  userFiles: string[];
}

/** A minimal valid FB2 2.1 book using `genre` (default: a standard one). */
function smallBook(dir: string, name: string, genre = 'sf', title = 'Launch test'): string {
  const file = path.join(dir, name);
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>${genre}</genre>
<author><first-name>Test</first-name><last-name>Author</last-name></author>
<book-title>${title}</book-title>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>e2e</nickname></author>
<program-used>us11-launch.spec</program-used>
<date value="2026-10-13">2026-10-13</date>
<id>us11-${name.replace(/\W/g, '-')}</id>
<version>1.0</version>
</document-info>
</description>
<body>
<section><title><p>${title}</p></title><p>Opened from the command line: ${name}.</p></section>
</body>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

async function supportsDocuments(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('doc.recent')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

/** Opens `file` through File > Open with the queued native dialog and waits for the Body. */
async function openViaDialog(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await expect(page.getByTestId('body-view')).toBeVisible();
  await expect(page).toHaveTitle(`${path.basename(file)} - ${APP_TITLE}`);
}

/** The shell executable when a build exists (null otherwise). */
function shellBinary(): string | null {
  const candidates = [
    process.env.MFBE_APP_BIN,
    path.join(REPO_ROOT, 'build', 'linux-app-debug', 'bin', 'mfbe'),
    path.join(REPO_ROOT, 'build', 'linux-app-release', 'bin', 'mfbe'),
  ].filter((candidate): candidate is string => !!candidate);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

test.describe('US11 - launch from the operating system', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us11-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.*');
  });

  test('4a. a file given at start-up (--open / app.openPaths) is opened in the editor', async ({
    browser,
  }) => {
    const binary = process.env.MFBE_CORE_BIN!;
    test.skip(!/mfbe-core/.test(path.basename(binary)), 'needs the real mfbe-core binary');
    const book = smallBook(dir, 'from-command-line.fb2', 'sf', 'Opened at start-up');
    const dataDir = mkdtempSync(path.join(dir, 'data-open-'));
    const second = await startCoreWith(binary, dataDir, ['--open', book]);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(second.url);
      await page.getByTestId('app-root').waitFor();
      await expect(page.getByTestId('body-view')).toBeVisible();
      await expect(page.getByTestId('body-editor')).toContainText('Opened from the command line');
      await expect(page).toHaveTitle(`from-command-line.fb2 - ${APP_TITLE}`);
      // The file is now the newest recent entry of that profile.
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-recent').hover();
      await expect(page.getByTestId('menu-file-recent-recent1')).toContainText(
        'from-command-line.fb2',
      );
      await page.keyboard.press('Escape');
    } finally {
      await context.close();
      await second.stop();
    }
  });

  test('4b. an invalid option prints the contract message and exits with code 2', async () => {
    const binary = process.env.MFBE_CORE_BIN!;
    test.skip(!/mfbe-core/.test(path.basename(binary)), 'needs the real mfbe-core binary');

    const bad = spawnSync(binary, ['--bogus-option'], { encoding: 'utf8' });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("Invalid command line option: '--bogus-option'");

    const badServe = spawnSync(binary, ['serve', '--bogus-option'], { encoding: 'utf8' });
    expect(badServe.status).toBe(2);
    expect(badServe.stderr).toContain("Invalid command line option: '--bogus-option'");

    const version = spawnSync(binary, ['--version'], { encoding: 'utf8' });
    expect(version.status).toBe(0);
    expect(version.stdout).toMatch(/^mfbe-core \d+\.\d+\.\d+/);

    // The desktop shell parses its own command line the same way (no display needed).
    const shell = shellBinary();
    test.info().annotations.push({
      type: 'shell',
      description: shell ? `checked ${shell}` : 'no mfbe build found - shell checks skipped',
    });
    if (shell) {
      const shellBad = spawnSync(shell, ['--bogus-option'], { encoding: 'utf8', timeout: 30_000 });
      expect(shellBad.status).toBe(2);
      expect(shellBad.stderr).toContain("Invalid command line option: '--bogus-option'");
      const shellLang = spawnSync(shell, ['--lang', 'de'], { encoding: 'utf8', timeout: 30_000 });
      expect(shellLang.status).toBe(2);
      expect(shellLang.stderr).toContain('Invalid value for --lang');
      const shellVersion = spawnSync(shell, ['--version'], { encoding: 'utf8', timeout: 30_000 });
      expect(shellVersion.status).toBe(0);
      expect(shellVersion.stdout).toContain(APP_TITLE);
      expect(shellVersion.stdout).toMatch(/CEF \d+\.\d+/);
      const shellHelp = spawnSync(shell, ['--help'], { encoding: 'utf8', timeout: 30_000 });
      expect(shellHelp.status).toBe(0);
      expect(shellHelp.stdout).toContain('Usage: mfbe [options] [FILE...]');
    }
  });

  test('5. File > Recent Files lists the most recent files and opens them on click', async ({
    core,
    page,
  }) => {
    const first = smallBook(dir, 'recent-one.fb2', 'sf', 'Recent one');
    const second = smallBook(dir, 'recent-two.fb2', 'sf', 'Recent two');
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');

    await openViaDialog(core, page, first);
    await openViaDialog(core, page, second);

    // Newest first, numbered like the original MRU list.
    const recent = await core.rpc<{ path: string }[]>('doc.recent');
    expect(recent.slice(0, 2).map((entry) => entry.path)).toEqual([second, first]);

    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-recent').hover();
    const popup = page.getByTestId('menu-file-recent-popup');
    await expect(popup).toBeVisible();
    await expect(page.getByTestId('menu-file-recent-recent1')).toContainText(`1. ${second}`);
    const entry = page.getByTestId('menu-file-recent-recent2');
    await expect(entry).toContainText(`2. ${first}`);
    await entry.click();

    await expect(page).toHaveTitle(`recent-one.fb2 - ${APP_TITLE}`);
    await expect(page.getByTestId('body-editor')).toContainText('Recent one');
  });

  test('6. a genre file added to the per-user genres folder shows up in the picker and passes validation', async ({
    core,
    page,
  }) => {
    test.skip(!core.dataDir, 'needs the data directory of the worker core');
    const genresDir = path.join(core.dataDir!, 'genres');
    mkdirSync(genresDir, { recursive: true });
    const code = 'sf_litrpg_e2e';
    const book = smallBook(dir, 'user-genre.fb2', code, 'User genre');

    // Before the file exists the genre is unknown to validation.
    const before = await core.rpcJob<{ document: DocumentJson }>('doc.open', { path: book });
    const beforeReport = await core.rpcJob<ValidationJson>('doc.validate', {
      docId: before.document.docId,
      document: before.document,
    });
    expect(beforeReport.errorCount + beforeReport.warningCount).toBeGreaterThan(0);
    await core.rpc('doc.close', { docId: before.document.docId });

    writeFileSync(
      path.join(genresDir, 'e2e.genres.tsv'),
      `# code\tcategory\tname_en\tname_ru\n${code}\tsf\tLitRPG (e2e)\tЛитРПГ (e2e)\n`,
      'utf8',
    );

    // Reloading the list (resources.genres) picks the file up: additive, with its source.
    const catalog = await core.rpc<GenreCatalog>('resources.genres');
    const added = catalog.entries.find((entry) => entry.code === code);
    expect(added, 'user genre present in the effective list').toBeTruthy();
    expect(added!.source).toMatch(/^user:/);
    expect(catalog.entries.some((entry) => entry.code === 'sf')).toBe(true); // standard list intact
    expect(catalog.userFiles.some((file) => file.endsWith('e2e.genres.tsv'))).toBe(true);

    // ... and validation accepts it.
    const after = await core.rpcJob<{ document: DocumentJson }>('doc.open', { path: book });
    const afterReport = await core.rpcJob<ValidationJson>('doc.validate', {
      docId: after.document.docId,
      document: after.document,
    });
    expect(afterReport.errorCount, JSON.stringify(afterReport.issues)).toBe(0);
    expect(
      afterReport.issues.filter((issue) => JSON.stringify(issue).includes(code)),
      'no issue mentions the user genre',
    ).toEqual([]);
    await core.rpc('doc.close', { docId: after.document.docId });

    // The genre picker (Description view) offers it, marked as coming from a user file.
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
    await fileNew(page);
    await page.getByTestId('view-description').click();
    await page.getByTestId('description-genre-add').click();
    const picker = page.getByTestId('genre-picker');
    await expect(picker).toBeVisible();
    await page.getByTestId('genre-picker-filter').fill('e2e');
    const option = page.getByTestId(`genre-picker-option-${code}`);
    await expect(option).toHaveAttribute('data-source', /^user:/);
    await page.getByTestId('genre-picker-list').selectOption(code);
    await page.getByTestId('genre-picker-button-ok').click();
    await expect(picker).toBeHidden();
    // The blank document template starts with one empty <genre/> row; the pick is appended.
    await expect(page.getByTestId('description-genres')).toContainText(code);
    await expect(page.getByTestId('description-genres')).toContainText('LitRPG (e2e)');

    // Where the file lives is reported through the layers (FR-127: "show where genres come from").
    const layers =
      await core.rpc<{ kind: string; layer: string; path: string }[]>('resources.layers');
    const userGenres = layers.find((layer) => layer.kind === 'genres' && layer.layer === 'user');
    expect(userGenres?.path).toBe(genresDir);
  });
});
