/**
 * Feature 011, User Story 11 - tree scripts list places in the tree (D41; constitution 3.3.0 power
 * (e); contracts/script-api.md, contracts/tree.md §4-§5). Runs against the real core: the tree bar's
 * *Scripts* menu lists the `treeRows` scripts only, with their icons, then *Clean*; a run shows its
 * rows in their places and a click on one goes to its place, the book unchanged; Ctrl+choosing a
 * script clears the other scripts' rows, *Clean* every row; a package copied into the personal
 * scripts folder appears after *Scripts → Reload*; the assistant writes one through the AI
 * stand-in and it appears in the menu.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import {
  ensureAssistantOn,
  expect,
  test,
  waitForBook,
  type CoreHandle,
  type StandinHandle,
} from './fixtures/core';

declare const window: {
  __mfbeTest?: {
    scripts?: {
      list(): { id: string }[];
      treeRows(): { scriptId: string; nodeId: string; caption?: string }[];
      toXml(): Promise<string>;
    };
  };
};

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const EXAMPLE = path.join(REPO_ROOT, 'scripts', 'tree', 'example-1');
const EXAMPLE_ID = 'tree/example-1';

const BOOK = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info><genre>prose</genre><author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Tree scripts</book-title><lang>en</lang></title-info>
<document-info><author><nickname>maker</nickname></author><date>2026</date><id>tree-scripts-1</id><version>1.0</version></document-info>
</description>
<body>
<section><title><p>One</p></title><p>No stop here</p><p>Has a stop.</p><subtitle>* * *</subtitle><p>Also none</p></section>
<section><title><p>Two</p></title><p>Another line</p></section>
</body>
</FictionBook>
`;

/** A `treeRows` package listing the `index`-th paragraph of the book as one row. */
function rowsPackage(folder: string, id: string, label: string, index: number): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, 'script.json'),
    `${JSON.stringify(
      {
        manifestVersion: 1,
        id,
        name: { en: label, ru: label, uk: label },
        description: { en: `Shows ${label}`, ru: `Показывает ${label}`, uk: `Показує ${label}` },
        kind: 'treeRows',
        entry: 'index.js',
        icon: 'icon.png',
        needsSelection: false,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(folder, 'index.js'),
    `export default async function run() {
  const paragraphs = await mfbe.doc.getElementsByTagName('p');
  await mfbe.tree.showRows(paragraphs.slice(${index}, ${index + 1}).map((node) => ({ node, caption: ${JSON.stringify(label)} })));
}
`,
  );
  cpSync(path.join(EXAMPLE, 'icon.png'), path.join(folder, 'icon.png'));
}

const scriptsFolder = (dataDir: string) => path.join(dataDir, 'scripts');
/**
 * A group folder of this journey's own in the shared core's personal scripts folder: other
 * journeys copy their fixture groups (`tree` among them) only when absent and count the `test.`
 * ids, so this journey neither takes their folder names nor uses that prefix, and removes its
 * folder afterwards.
 */
const GROUP = 'us11_tree-scripts';
const treeRows = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.treeRows());
const xml = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.toXml());
const scriptIds = (page: Page) =>
  page.evaluate(() => window.__mfbeTest!.scripts!.list().map((script) => script.id));
const entry = (page: Page, id: string) => page.getByTestId(`tree-menu-scripts-popup-${id}`);

async function openScriptsMenu(page: Page): Promise<void> {
  await page.getByTestId('tree-menu-scripts').click();
  await expect(page.getByTestId('tree-menu-scripts-popup')).toBeVisible();
}

async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.openApp(page);
  await expect.poll(() => scriptIds(page), { timeout: 15_000 }).toContain(EXAMPLE_ID);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

test.describe('US11 (feature 011) - tree scripts', () => {
  let dir: string;
  let file: string;

  test.beforeAll(({ coreServer }) => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-011-us11-'));
    file = path.join(dir, 'tree-scripts.fb2');
    writeFileSync(file, BOOK, 'utf8');
    if (!coreServer.hasCore || !coreServer.dataDir) return;
    // The sample in the personal layer (its bundled copy, when the core has one, is replaced) and
    // two more tree scripts.
    const group = path.join(scriptsFolder(coreServer.dataDir), GROUP);
    cpSync(EXAMPLE, path.join(group, 'example-1'), { recursive: true });
    rowsPackage(path.join(group, 'rows-a'), 'us11.rows-a', 'Row A', 1);
    rowsPackage(path.join(group, 'rows-b'), 'us11.rows-b', 'Row B', 2);
  });

  test.afterAll(({ coreServer }) => {
    rmSync(dir, { recursive: true, force: true });
    if (coreServer.dataDir) {
      rmSync(path.join(scriptsFolder(coreServer.dataDir), GROUP), { recursive: true, force: true });
    }
  });

  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('1-3. the tree bar lists them; rows in their places; Ctrl+choose and Clean', async ({
    core,
    page,
  }) => {
    await openBook(core, page, file);
    const before = await xml(page);
    // 1. The tree bar's Scripts: the tree scripts with their icons, then Clean.
    await openScriptsMenu(page);
    await expect(entry(page, `script-${EXAMPLE_ID}`)).toBeVisible();
    await expect(entry(page, `script-${EXAMPLE_ID}`).locator('img')).toHaveAttribute(
      'src',
      /icon\.png/,
    );
    await expect(entry(page, 'script-us11.rows-a')).toBeVisible();
    await expect(entry(page, 'clean')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    // ... and neither the main Scripts menu nor a row's right-click menu lists them.
    await page.getByTestId('menu-scripts').click();
    await expect(
      page.locator('[data-testid^="menu-scripts"][data-testid*="example-1"]'),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    const section = page.locator('[data-row-kind="section"]').first();
    await section.click({ button: 'right' });
    await expect(page.getByTestId('tree-menu')).toBeVisible();
    await expect(page.getByTestId(`tree-menu-script-${EXAMPLE_ID}`)).toHaveCount(0);
    await page.keyboard.press('Escape');

    // 2. A run: a row per paragraph without a full stop, in its place, with the script's icon.
    await openScriptsMenu(page);
    await entry(page, `script-${EXAMPLE_ID}`).click();
    await expect.poll(async () => (await treeRows(page)).length).toBe(6);
    const scriptRows = page.locator('[data-row-kind="script"]');
    await expect(scriptRows).toHaveCount(6);
    await expect(scriptRows.first().locator('img')).toHaveAttribute('src', /icon\.png/);
    const also = scriptRows.filter({ hasText: 'Also none' });
    await expect(also).toHaveAttribute(
      'data-depth',
      String(Number(await section.getAttribute('data-depth')) + 1),
    );
    await also.click();
    await expect(page.getByTestId('status-path')).toContainText('section[1]/p[3]');
    expect(await xml(page)).toBe(before);

    // 3. Rows of two scripts; Ctrl+choosing a third leaves its rows alone; Clean removes all.
    await openScriptsMenu(page);
    await entry(page, 'script-us11.rows-a').click();
    await expect.poll(async () => (await treeRows(page)).length).toBe(7);
    await openScriptsMenu(page);
    await entry(page, 'script-us11.rows-b').click({ modifiers: ['ControlOrMeta'] });
    await expect
      .poll(async () => (await treeRows(page)).map((row) => row.scriptId))
      .toEqual(['us11.rows-b']);
    await expect(page.locator('[data-row-kind="script"]')).toHaveCount(1);
    await openScriptsMenu(page);
    await entry(page, 'clean').click();
    await expect(page.locator('[data-row-kind="script"]')).toHaveCount(0);
    expect(await treeRows(page)).toEqual([]);
    expect(await xml(page)).toBe(before);
  });

  test('4. a package copied into the personal folder appears after Scripts > Reload', async ({
    core,
    page,
  }) => {
    await openBook(core, page, file);
    rowsPackage(
      path.join(scriptsFolder(core.dataDir!), GROUP, 'rows-c'),
      'us11.rows-c',
      'Row C',
      3,
    );
    try {
      await page.getByTestId('menu-scripts').click();
      await page.getByTestId('menu-scripts-reload').click();
      await expect.poll(() => scriptIds(page), { timeout: 15_000 }).toContain('us11.rows-c');
      await openScriptsMenu(page);
      await entry(page, 'script-us11.rows-c').click();
      await expect
        .poll(async () => (await treeRows(page)).map((row) => row.caption))
        .toEqual(['Row C']);
    } finally {
      rmSync(path.join(scriptsFolder(core.dataDir!), GROUP, 'rows-c'), {
        recursive: true,
        force: true,
      });
      await core.rpc('scripts.reload');
    }
  });

  test('5. the assistant writes a tree script into its folder and it appears', async ({
    core,
    page,
    standin,
  }) => {
    await standin.reset();
    await core.resetAiRequests();
    await core.setAiResolve([]);
    const assistant = path.join(scriptsFolder(core.dataDir!), '90_assistant');
    rmSync(assistant, { recursive: true, force: true });
    await core.rpc('scripts.reload');
    await useStandin(core, standin);
    try {
      await openBook(core, page, file);
      await ensureAssistantOn(page);
      const manifest = {
        manifestVersion: 1,
        id: 'assistant/stop-rows',
        name: { en: 'Lines Without a Stop', ru: 'Строки без точки', uk: 'Рядки без крапки' },
        description: { en: 'Lists the lines without a full stop in the Document tree' },
        kind: 'treeRows',
        entry: 'index.js',
      };
      await standin.scenarios([
        {
          toolCalls: [
            {
              id: 'c-propose',
              name: 'propose_script',
              arguments: {
                id: 'assistant/stop-rows',
                summary: 'Lists the lines without a full stop as rows of the Document tree',
                files: [
                  { path: 'script.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
                  {
                    path: 'index.js',
                    content:
                      "export default async function run() {\n  const ps = await mfbe.doc.getElementsByTagName('p');\n  await mfbe.tree.showRows(ps.map((node) => ({ node })));\n}\n",
                  },
                ],
              },
            },
          ],
        },
        { text: 'The tree script is written.' },
      ]);
      await page
        .getByTestId('ai-input')
        .fill('Write a tree script that lists the lines without a stop');
      await page.getByTestId('ai-input').press('Enter');
      const dialog = page.getByTestId('dialog-ai-script-proposal');
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await dialog.getByTestId('dialog-ai-script-proposal-button-write').click();
      await expect
        .poll(() => scriptIds(page), { timeout: 15_000 })
        .toContain('assistant/stop-rows');
      await expect(page.getByTestId('ai-send')).toBeVisible({ timeout: 30_000 });
      await openScriptsMenu(page);
      await expect(entry(page, 'script-assistant/stop-rows')).toBeVisible();
      await page.keyboard.press('Escape');
    } finally {
      rmSync(assistant, { recursive: true, force: true });
      await core.rpc('scripts.reload');
      await core.rpc('settings.set', { patch: { ai: null } }).catch(() => undefined);
    }
  });
});

/** The assistant talks to the stand-in (custom mode, its own model). */
async function useStandin(core: CoreHandle, standin: StandinHandle): Promise<void> {
  await core.rpc('settings.set', {
    patch: {
      ai: {
        mode: 'custom',
        custom: { address: `${standin.url}/v1`, key: '', model: 'standin-chat' },
      },
    },
  });
}
