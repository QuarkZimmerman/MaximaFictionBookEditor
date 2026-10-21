/**
 * Feature 004, User Story 8 - "Restore position" restores the position (T064; spec FR-100 to
 * FR-102, SC-008; research R5). The caret is asserted through the status-bar path, the Body
 * selection and `doc.position` / `positions.json`.
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`);
 * skipped in core-less mode. The scenarios:
 *
 *  1. leaving routes within one core: File > New, Open (queued dialog), Recent Files, Save,
 *     Save As (the position follows the new name, the old name's record stays), the reload of
 *     a book that changed on disk answered Yes (caret and view kept, even with the setting off),
 *     the restart after a language change (`test.restartRequests` + the `?open=` reload, the
 *     position remembered before `app.restart`);
 *  2. File > Exit and the window's close request (`test.requestClose`, the save prompt
 *     answered No), each on a dedicated core that really quits (`app.quit`); a second core on
 *     the same data folder reopens the book - from the command line (`--open`, the
 *     `app.openPaths` notification the shell sends for FILE arguments, a double-click and a
 *     file passed to the running editor) and from Recent Files - with the caret in the
 *     paragraph;
 *  3. opening routes and edge cases: the setting off (the book opens at its start,
 *     `positions.json` untouched); the Description view active when opening (the view stays,
 *     the first switch to Body shows the caret in place and scrolled into view); a Source visit
 *     and a split paragraph before leaving (the node-id failures of 0.0.3); a changed file (a
 *     paragraph removed -> the paragraph now at that place, clamped; a section removed -> the
 *     section now at that place; the body emptied -> the document's start) without any message;
 *     the eleventh book still restored (a 100-entry record of its own); a never-saved document
 *     records nothing; two spellings of a path on Linux make two records; a malformed file
 *     restores and records nothing.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import {
  expect,
  fixtureBook,
  NodeRpcClient,
  startCoreWith,
  test,
  waitForBook,
  waitForStartupDocument,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';

/* ------------------------------------------------------------------------ */
/* Books                                                                    */
/* ------------------------------------------------------------------------ */

interface BookShape {
  sections: number;
  paragraphs: number;
  /** `[section, paragraph]` pairs (1-based) left out of the written file. */
  drop?: [number, number][];
  /** Sections (1-based) left out of the written file. */
  dropSections?: number[];
  /** `<body><section/></body>` instead of the sections. */
  emptyBody?: boolean;
}

/** The text of paragraph `p` of section `s`: unique, long enough to hold a caret offset. */
function paragraphText(s: number, p: number): string {
  return `S${s}P${p} Paragraph ${p} of section ${s}: the quick brown fox jumps over the lazy dog.`;
}

/** Writes a FictionBook of `shape` to `file` (sections with titles, numbered paragraphs). */
function writeBook(file: string, shape: BookShape, title = path.basename(file)): string {
  let body: string;
  if (shape.emptyBody) {
    body = '<body><section/></body>';
  } else {
    body = '<body>\n';
    for (let s = 1; s <= shape.sections; s += 1) {
      if (shape.dropSections?.includes(s)) continue;
      body += `<section><title><p>Section ${s}</p></title>\n`;
      for (let p = 1; p <= shape.paragraphs; p += 1) {
        if (shape.drop?.some(([ds, dp]) => ds === s && dp === p)) continue;
        body += `<p>${paragraphText(s, p)}</p>\n`;
      }
      body += '</section>\n';
    }
    body += '</body>';
  }
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Test</first-name><last-name>Author</last-name></author>
<book-title>${title}</book-title>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>e2e</nickname></author>
<program-used>us8-restore-position.spec</program-used>
<date value="2026-10-20">2026-10-20</date>
<id>us8-${path.basename(file).replace(/\W/g, '-')}</id>
<version>1.0</version>
</document-info>
</description>
${body}
</FictionBook>
`,
    'utf8',
  );
  return file;
}

/** A book of three sections with forty paragraphs each: a caret deep inside is off screen. */
function longBook(dir: string, name: string): string {
  return writeBook(path.join(dir, name), { sections: 3, paragraphs: 40 });
}

/* ------------------------------------------------------------------------ */
/* Records                                                                  */
/* ------------------------------------------------------------------------ */

interface StoredPosition {
  path: string;
  offset: number;
}

interface PositionItem {
  path: string;
  at: string;
  position: StoredPosition;
}

/** The items of `positions.json` in `dataDir` (empty when the file does not exist). */
function storedPositions(dataDir: string): PositionItem[] {
  const file = path.join(dataDir, 'positions.json');
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { items?: PositionItem[] };
  return parsed.items ?? [];
}

/** The remembered position of `file` in `dataDir`, or null. */
function recordOf(dataDir: string, file: string): StoredPosition | null {
  return storedPositions(dataDir).find((item) => item.path === file)?.position ?? null;
}

/** The raw text of `positions.json` ('' when absent): for "unchanged" checks. */
function positionsText(dataDir: string): string {
  const file = path.join(dataDir, 'positions.json');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

/* ------------------------------------------------------------------------ */
/* Page helpers                                                             */
/* ------------------------------------------------------------------------ */

interface ModelNode {
  type: string;
  attrs?: { nodeId?: string };
  content?: ModelNode[];
}

interface ModelDocument {
  docId: string;
  bodies: ModelNode[];
  description: {
    titleInfo: { annotation?: ModelNode };
    documentInfo: { history?: ModelNode };
  };
}

interface ModelPoint {
  nodeId: string;
  offset: number;
}

async function supportsDocuments(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('doc.recent')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

/** The Document JSON the UI holds (`__mfbeTest.scripts.document()`). */
function model(page: Page): Promise<ModelDocument> {
  return page.evaluate<ModelDocument>('window.__mfbeTest.scripts.document()');
}

/** The node id at a structural path of the model (the journeys name positions by path). */
function nodeIdAt(doc: ModelDocument, pathOfNode: string): string {
  const segments = pathOfNode.split('/');
  let current: ModelNode | undefined;
  let rest: string[];
  if (segments[0] === 'title-info') {
    current = doc.description.titleInfo.annotation;
    rest = segments.slice(2);
  } else if (segments[0] === 'document-info') {
    current = doc.description.documentInfo.history;
    rest = segments.slice(2);
  } else {
    const match = /^body\[(\d+)\]$/.exec(segments[0] ?? '');
    current = match ? doc.bodies[Number(match[1]) - 1] : undefined;
    rest = segments.slice(1);
  }
  for (const segment of rest) {
    const match = /^([a-z-]+)\[(\d+)\]$/.exec(segment);
    if (!match || !current) throw new Error(`bad path ${pathOfNode}`);
    const [, type, index] = match;
    const candidates = (current.content ?? []).filter((child) => child.type === type);
    current = candidates[Number(index) - 1];
  }
  const id = current?.attrs?.nodeId;
  if (!id) throw new Error(`no node at ${pathOfNode}`);
  return id;
}

/** Puts the Body caret at `offset` inside the text block at `pathOfNode` (status path checked). */
async function placeCaret(page: Page, pathOfNode: string, offset: number): Promise<void> {
  const nodeId = nodeIdAt(await model(page), pathOfNode);
  const placed = await page.evaluate<boolean>(
    `window.__mfbeTest.scripts.select(${JSON.stringify(nodeId)}, ${offset}, ${offset})`,
  );
  expect(placed, `caret placed at ${pathOfNode}:${offset}`).toBe(true);
  await expect(page.getByTestId('status-path')).toHaveText(pathOfNode);
  await expect.poll(() => bodyCaret(page).then((caret) => caret.offset)).toBe(offset);
}

/** The Body caret as the status bar shows its path and the editor its offset. */
async function bodyCaret(page: Page): Promise<StoredPosition> {
  const pathShown = await page.getByTestId('status-path').innerText();
  const selection = await page.evaluate<{ head: ModelPoint } | null>(
    'window.__mfbeTest.sourceMapping.bodySelection()',
  );
  return { path: pathShown, offset: selection?.head.offset ?? -1 };
}

/** Waits until the Body caret is at `position` (path and offset). */
async function expectCaret(page: Page, position: StoredPosition): Promise<void> {
  await expect(page.getByTestId('status-path')).toHaveText(position.path);
  await expect.poll(() => bodyCaret(page)).toEqual(position);
}

/** The id of the open document, null while none is (between a close and the next load). */
function currentDocId(page: Page): Promise<string | null> {
  return page.evaluate<string | null>('window.__mfbeTest.scripts.document()?.docId ?? null');
}

/** The id of the open document (whatever the active view; a Source-only one included). */
async function openDocId(page: Page): Promise<string> {
  const id = await currentDocId(page);
  if (!id) throw new Error('no document is open');
  return id;
}

/** `doc.position` of the open document through the core. */
async function positionOfOpenDocument(
  rpc: (method: string, params?: unknown) => Promise<unknown>,
  page: Page,
): Promise<StoredPosition | null> {
  const result = (await rpc('doc.position', { docId: await openDocId(page) })) as {
    position?: StoredPosition;
  };
  return result.position ?? null;
}

async function openApp(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await waitForStartupDocument(page);
}

/** Opens `file` through File > Open with the queued native dialog and waits for the title. */
async function openViaDialog(
  enqueue: (method: string, result: unknown) => Promise<void>,
  page: Page,
  file: string,
): Promise<void> {
  await enqueue('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
}

/** Opens `file` through File > Recent Files (it must be listed there). */
async function openViaRecent(page: Page, file: string): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-recent').hover();
  const popup = page.getByTestId('menu-file-recent-popup');
  await expect(popup).toBeVisible();
  // A case-sensitive match on the whole path: two spellings of one name are two entries.
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await popup
    .locator('[data-testid^="menu-file-recent-recent"]')
    .filter({ hasText: new RegExp(`\\d+\\. ${escaped}$`) })
    .first()
    .click();
  await waitForBook(page, file);
}

/** File > New; a modified document's save prompt is answered with No (Don't save). */
async function fileNew(page: Page, options: { modified?: boolean } = {}): Promise<void> {
  const before = await openDocId(page);
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-new').click();
  if (options.modified) {
    const prompt = page.getByTestId('dialog-save-changes');
    await expect(prompt).toBeVisible();
    await prompt.getByTestId('dialog-save-changes-button-no').click();
  }
  // The new document's id: between the close of the old document and the arrival of the new
  // one no document is open at all - that moment keeps the poll waiting instead of failing it.
  await expect.poll(async () => (await currentDocId(page)) ?? before).not.toBe(before);
  await waitForStartupDocument(page);
}

/** The paragraph element holding `text` (the Body editor's `p.fb-p`). */
function paragraphWith(page: Page, text: string) {
  return page.getByTestId('body-editor').locator('p.fb-p').filter({ hasText: text });
}

/** Rewrites `file` so that its modification time differs from the previous write. */
function rewrite(file: string, shape: BookShape, title?: string): void {
  writeBook(file, shape, title);
  const later = new Date(Date.now() + 2000);
  utimesSync(file, later, later);
}

/* ------------------------------------------------------------------------ */
/* A core of a test's own (quits for real, restarted on the same folder)    */
/* ------------------------------------------------------------------------ */

interface OwnCore {
  url: string;
  dataDir: string;
  rpc: NodeRpcClient;
  /** Lets the quit core go (or stops it) and starts another on the same data folder. */
  restart(extraArgs?: string[]): Promise<void>;
  stop(): Promise<void>;
  /** Resolves once the current core process has ended (after app.quit). */
  waitForExit(): Promise<void>;
}

async function ownCore(): Promise<OwnCore> {
  const binary = process.env.MFBE_CORE_BIN!;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mfbe-us8-position-'));
  const connect = async (extraArgs: string[]) => {
    const started = await startCoreWith(binary, dataDir, extraArgs);
    const url = new URL(started.url);
    const rpc = new NodeRpcClient(
      `ws://127.0.0.1:${url.port}/rpc?token=${url.searchParams.get('token') ?? ''}`,
    );
    return { ...started, rpc };
  };
  let current = await connect([]);
  const own: OwnCore = {
    url: current.url,
    dataDir,
    rpc: current.rpc,
    async restart(extraArgs = []) {
      current.rpc.close();
      await current.stop();
      current = await connect(extraArgs);
      own.url = current.url;
      own.rpc = current.rpc;
    },
    async stop() {
      current.rpc.close();
      await current.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
    async waitForExit() {
      // app.info answers while the process lives; once it has quit the connection fails.
      await expect
        .poll(
          () =>
            current.rpc
              .call('app.info', undefined, 2_000)
              .then(() => 'alive')
              .catch(() => 'gone'),
          { timeout: 15_000, message: 'the core quits after app.quit' },
        )
        .toBe('gone');
    },
  };
  return own;
}

async function openOwn(page: Page, core: OwnCore): Promise<void> {
  await page.goto(core.url);
  await page.getByTestId('app-root').waitFor();
}

/* ------------------------------------------------------------------------ */
/* 1. Leaving routes within one core                                        */
/* ------------------------------------------------------------------------ */

test.describe('US8 - the position is remembered on every leaving route', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us8-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.*');
    test.skip(!core.dataDir, 'needs the data folder of the worker core');
    await core.rpc('settings.set', { patch: { other: { restorePosition: true } } });
  });

  test('1a. File > New remembers the Body caret; Recent Files brings it back, scrolled into view', async ({
    core,
    page,
  }) => {
    const book = longBook(dir, 'leave-new.fb2');
    await openApp(core, page);
    await openViaDialog(core.enqueueDialog, page, book);
    const position = { path: 'body[1]/section[2]/p[30]', offset: 7 };
    await placeCaret(page, position.path, position.offset);
    expect(await positionOfOpenDocument(core.rpc, page)).toBeNull(); // nothing yet

    await fileNew(page);
    expect(recordOf(core.dataDir!, book)).toEqual(position);

    await openViaRecent(page, book);
    await expectCaret(page, position);
    expect(await positionOfOpenDocument(core.rpc, page)).toEqual(position);
    await expect(paragraphWith(page, paragraphText(2, 30))).toBeInViewport();
    // Typing continues there.
    await page.keyboard.type('X');
    await expect(paragraphWith(page, 'S2P30 PXaragraph')).toHaveCount(1);
  });

  test('1b. Open and Recent Files remember the book that is left, the new one opens at its own place', async ({
    core,
    page,
  }) => {
    const first = longBook(dir, 'leave-open-1.fb2');
    const second = longBook(dir, 'leave-open-2.fb2');
    await openApp(core, page);
    await openViaDialog(core.enqueueDialog, page, first);
    await placeCaret(page, 'body[1]/section[1]/p[12]', 3);
    // Open another book through the dialog: the first is remembered, the second has no record.
    await openViaDialog(core.enqueueDialog, page, second);
    expect(recordOf(core.dataDir!, first)).toEqual({ path: 'body[1]/section[1]/p[12]', offset: 3 });
    expect(recordOf(core.dataDir!, second)).toBeNull();
    await placeCaret(page, 'body[1]/section[3]/p[5]', 9);
    // Back to the first through Recent Files: the second is remembered, the first restored.
    await openViaRecent(page, first);
    expect(recordOf(core.dataDir!, second)).toEqual({ path: 'body[1]/section[3]/p[5]', offset: 9 });
    await expectCaret(page, { path: 'body[1]/section[1]/p[12]', offset: 3 });
    await openViaRecent(page, second);
    await expectCaret(page, { path: 'body[1]/section[3]/p[5]', offset: 9 });
  });

  test('1c. Save remembers; Save As records under the new name and keeps the old name', async ({
    core,
    page,
  }) => {
    const book = longBook(dir, 'leave-save.fb2');
    const renamed = path.join(dir, 'leave-save-as.fb2');
    await openApp(core, page);
    await openViaDialog(core.enqueueDialog, page, book);
    await placeCaret(page, 'body[1]/section[2]/p[7]', 4);
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-save').click();
    await expect(page.getByTestId('status-message')).toHaveText(/saved|errors? found/i);
    await expect
      .poll(() => recordOf(core.dataDir!, book))
      .toEqual({ path: 'body[1]/section[2]/p[7]', offset: 4 });

    await placeCaret(page, 'body[1]/section[2]/p[8]', 2);
    await core.enqueueDialog('dialog.saveFile', { path: renamed, encoding: 'utf-8' });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-saveAs').click();
    await waitForBook(page, renamed);
    await expect
      .poll(() => recordOf(core.dataDir!, renamed))
      .toEqual({ path: 'body[1]/section[2]/p[8]', offset: 2 });
    expect(recordOf(core.dataDir!, book)).toEqual({ path: 'body[1]/section[2]/p[7]', offset: 4 });
    // The record follows the new name from now on.
    await placeCaret(page, 'body[1]/section[3]/p[1]', 1);
    await fileNew(page);
    expect(recordOf(core.dataDir!, renamed)).toEqual({
      path: 'body[1]/section[3]/p[1]',
      offset: 1,
    });
    expect(recordOf(core.dataDir!, book)).toEqual({ path: 'body[1]/section[2]/p[7]', offset: 4 });
    await openViaRecent(page, renamed);
    await expectCaret(page, { path: 'body[1]/section[3]/p[1]', offset: 1 });
  });

  test('1d. the reload of a book changed on disk keeps the active view and the caret, even with the setting off', async ({
    core,
    page,
  }) => {
    const book = longBook(dir, 'leave-reload.fb2');
    await openApp(core, page);
    await openViaDialog(core.enqueueDialog, page, book);
    const position = { path: 'body[1]/section[2]/p[20]', offset: 6 };
    await placeCaret(page, position.path, position.offset);
    await core.rpc('settings.set', { patch: { other: { restorePosition: false } } });
    try {
      // The Description view is active when another program rewrites the file.
      await page.getByTestId('view-description').click();
      await expect(page.getByTestId('view-description')).toHaveAttribute('aria-selected', 'true');
      await page.waitForTimeout(1100); // a distinct mtime second
      rewrite(book, { sections: 3, paragraphs: 40 }, 'Rewritten by another program');
      const prompt = page.getByTestId('dialog-file-changed');
      await expect(prompt).toBeVisible({ timeout: 15_000 });
      await prompt.getByTestId('dialog-file-changed-button-yes').click();
      await expect(prompt).toBeHidden();
      await expect(page.getByTestId('view-description')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('description-book-title')).toHaveValue(
        'Rewritten by another program',
      );
      // The in-session caret, carried over the reload - not the record (there is none: the
      // setting is off).
      await expectCaret(page, position);
      expect(recordOf(core.dataDir!, book)).toBeNull();
      await page.getByTestId('view-body').click();
      await expect(page.getByTestId('body-editor')).toBeVisible();
      await expectCaret(page, position);
      await expect(paragraphWith(page, paragraphText(2, 20))).toBeInViewport();
    } finally {
      await core.rpc('settings.set', { patch: { other: { restorePosition: true } } });
    }
  });

  test('1e. the restart after a language change remembers the position and the ?open= reload restores it', async ({
    core,
    page,
  }) => {
    const book = longBook(dir, 'leave-restart.fb2');
    await core.rpc('settings.set', { patch: { view: { uiLanguage: 'en' } } });
    try {
      await openApp(core, page);
      await openViaDialog(core.enqueueDialog, page, book);
      const position = { path: 'body[1]/section[3]/p[33]', offset: 11 };
      await placeCaret(page, position.path, position.offset);
      const before = (await core.rpc<unknown[]>('test.restartRequests')).length;

      await page.getByTestId('menu-tools').click();
      await page.getByTestId('menu-tools-settings').click();
      await page.getByTestId('settings-view-language').selectOption('ru');
      await page.getByTestId('dialog-settings-button-ok').click();
      const prompt = page.getByTestId('dialog-restart-prompt');
      await expect(prompt).toBeVisible();
      await prompt.getByTestId('dialog-restart-prompt-button-yes').click();

      // The position is remembered before the restart is requested ...
      await expect.poll(() => core.rpc<unknown[]>('test.restartRequests')).toHaveLength(before + 1);
      expect(recordOf(core.dataDir!, book)).toEqual(position);
      // ... and the page, reloaded with ?open=<book> (no shell headless), restores it.
      await expect.poll(() => new URL(page.url()).searchParams.get('open')).toBe(book);
      await page.getByTestId('app-root').waitFor();
      await waitForBook(page, book);
      await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
      await expectCaret(page, position);
      await expect(paragraphWith(page, paragraphText(3, 33))).toBeInViewport();
    } finally {
      await core.rpc('settings.set', { patch: { view: { uiLanguage: 'en' } } });
    }
  });
});

/* ------------------------------------------------------------------------ */
/* 2. Exit and the window's close request: cores that really quit           */
/* ------------------------------------------------------------------------ */

test.describe('US8 - Exit and the close request remember; the next start restores', () => {
  let dir: string;
  let core: OwnCore | null = null;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us8-quit-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(() => {
    test.skip(!process.env.MFBE_CORE_BIN, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(
      !/mfbe-core/.test(path.basename(process.env.MFBE_CORE_BIN ?? '')),
      'needs the real mfbe-core binary (the fake core cannot quit and restart)',
    );
  });

  test.afterEach(async () => {
    await core?.stop();
    core = null;
  });

  test('2a. File > Exit with an unmodified book; the next start opens it from the command line at the caret', async ({
    page,
  }) => {
    const book = longBook(dir, 'exit.fb2');
    core = await ownCore();
    await openOwn(page, core);
    await waitForStartupDocument(page);
    await openViaDialog(
      (method, result) => core!.rpc.call('test.enqueueDialog', { method, result }),
      page,
      book,
    );
    const position = { path: 'body[1]/section[2]/p[25]', offset: 5 };
    await placeCaret(page, position.path, position.offset);
    expect(recordOf(core.dataDir, book)).toBeNull();

    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-exit').click();
    await core.waitForExit();
    expect(recordOf(core.dataDir, book)).toEqual(position);

    // The second start on the same data folder: the book given on the command line (the
    // shell's app.openPaths notification) opens at the remembered place.
    await core.restart(['--open', book]);
    await openOwn(page, core);
    await waitForBook(page, book);
    await expectCaret(page, position);
    await expect(paragraphWith(page, paragraphText(2, 25))).toBeInViewport();
    expect(await positionOfOpenDocument((m, p) => core!.rpc.call(m, p), page)).toEqual(position);
  });

  test('2b. the window\'s close request with "Don\'t save"; the next start restores from Recent Files', async ({
    page,
  }) => {
    const book = longBook(dir, 'close-request.fb2');
    core = await ownCore();
    await openOwn(page, core);
    await waitForStartupDocument(page);
    await openViaDialog(
      (method, result) => core!.rpc.call('test.enqueueDialog', { method, result }),
      page,
      book,
    );
    await placeCaret(page, 'body[1]/section[3]/p[14]', 4);
    // A modification: the caret moves one character on, the title carries the marker.
    await page.keyboard.type('Q');
    await expect(page).toHaveTitle(/\* - /);
    const position = { path: 'body[1]/section[3]/p[14]', offset: 5 };
    await expectCaret(page, position);

    // The shell's close request (the title-bar button, a shutdown): the save prompt, No.
    await core.rpc.call('test.requestClose');
    const prompt = page.getByTestId('dialog-save-changes');
    await expect(prompt).toBeVisible();
    await prompt.getByTestId('dialog-save-changes-button-no').click();
    await core.waitForExit();
    expect(recordOf(core.dataDir, book)).toEqual(position);

    await core.restart();
    await openOwn(page, core);
    await waitForStartupDocument(page);
    await openViaRecent(page, book);
    // The file on disk was never changed: the paragraph holds the caret at the same character.
    await expectCaret(page, position);
    await expect(page).not.toHaveTitle(/\* - /);
  });
});

/* ------------------------------------------------------------------------ */
/* 3. Opening routes, the view rule, the fallbacks and the record's limits  */
/* ------------------------------------------------------------------------ */

test.describe('US8 - opening routes, fallbacks and the record', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us8-open-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.*');
    test.skip(!core.dataDir, 'needs the data folder of the worker core');
    await core.rpc('settings.set', { patch: { other: { restorePosition: true } } });
  });

  test('3a. with the setting off the book opens at its start and nothing is recorded', async ({
    core,
    page,
  }) => {
    const book = longBook(dir, 'setting-off.fb2');
    await openApp(core, page);
    await openViaDialog(core.enqueueDialog, page, book);
    const position = { path: 'body[1]/section[2]/p[15]', offset: 3 };
    await placeCaret(page, position.path, position.offset);
    await fileNew(page);
    expect(recordOf(core.dataDir!, book)).toEqual(position);

    await core.rpc('settings.set', { patch: { other: { restorePosition: false } } });
    try {
      const before = positionsText(core.dataDir!);
      await openViaRecent(page, book);
      await expect(page.getByTestId('body-editor')).toBeVisible();
      await page.waitForTimeout(300);
      const caret = await bodyCaret(page);
      expect(caret.path).not.toBe(position.path);
      expect(caret.path).toMatch(/^(title-info\/annotation\[1\]|body\[1\])/);
      expect(await positionOfOpenDocument(core.rpc, page)).toBeNull();
      await placeCaret(page, 'body[1]/section[3]/p[3]', 2);
      await fileNew(page);
      expect(positionsText(core.dataDir!)).toBe(before); // untouched, the old record kept
      // The setting's own value survives: Settings shows it off.
      await page.getByTestId('menu-tools').click();
      await page.getByTestId('menu-tools-settings').click();
      await page.getByTestId('settings-tab-other').click();
      await expect(page.getByTestId('settings-other-restore-position')).not.toBeChecked();
      await page.getByTestId('dialog-settings-button-cancel').click();
    } finally {
      await core.rpc('settings.set', { patch: { other: { restorePosition: true } } });
    }
    // On again: the old record is restored.
    await openViaRecent(page, book);
    await expectCaret(page, position);
  });

  test('3b. opened while the Description view is active: the view stays, the first switch to Body shows the caret', async ({
    core,
    page,
  }) => {
    const book = longBook(dir, 'description-view.fb2');
    await openApp(core, page);
    await openViaDialog(core.enqueueDialog, page, book);
    const position = { path: 'body[1]/section[3]/p[28]', offset: 8 };
    await placeCaret(page, position.path, position.offset);
    // Left from the Description view: the Body caret is what is remembered.
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('view-description')).toHaveAttribute('aria-selected', 'true');
    await fileNew(page);
    expect(recordOf(core.dataDir!, book)).toEqual(position);

    await expect(page.getByTestId('view-description')).toHaveAttribute('aria-selected', 'true');
    await openViaRecent(page, book);
    await expect(page.getByTestId('view-description')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('body-editor')).toHaveCount(0);
    // The caret is in place (the controller holds it unmounted) ...
    await expect(page.getByTestId('status-path')).toHaveText(position.path);
    // ... and the Body view, shown for the first time, has it placed and scrolled into view.
    await page.getByTestId('view-body').click();
    await expect(page.getByTestId('body-editor')).toBeVisible();
    await expectCaret(page, position);
    await expect(paragraphWith(page, paragraphText(3, 28))).toBeInViewport();
  });

  test('3c. a Source visit and a split paragraph before leaving: the place, not a node id, is remembered', async ({
    core,
    page,
  }) => {
    const book = longBook(dir, 'source-visit.fb2');
    await openApp(core, page);
    await openViaDialog(core.enqueueDialog, page, book);
    await placeCaret(page, 'body[1]/section[2]/p[3]', 5);
    // A Source visit re-issues every node id (the primary failure of 0.0.3).
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    await page.getByTestId('view-body').click();
    await expect(page.getByTestId('body-editor')).toBeVisible();
    await expectCaret(page, { path: 'body[1]/section[2]/p[3]', offset: 5 });
    // Splitting the paragraph puts the caret into a paragraph created in the editor (a UI id
    // no reopen has): the fourth paragraph of the section, at its start.
    await page.keyboard.press('Enter');
    await expectCaret(page, { path: 'body[1]/section[2]/p[4]', offset: 0 });
    await expect(page).toHaveTitle(/\* - /);
    await fileNew(page, { modified: true });
    expect(recordOf(core.dataDir!, book)).toEqual({ path: 'body[1]/section[2]/p[4]', offset: 0 });
    // The file on disk is unchanged: the paragraph now at that place is its own fourth one.
    await openViaRecent(page, book);
    await expectCaret(page, { path: 'body[1]/section[2]/p[4]', offset: 0 });
    await expect(paragraphWith(page, paragraphText(2, 4))).toBeInViewport();
  });

  test('3d. a file changed by another program: the paragraph now at that place, clamped; the section now there; the start', async ({
    core,
    page,
  }) => {
    const book = writeBook(path.join(dir, 'changed.fb2'), { sections: 3, paragraphs: 6 });
    await openApp(core, page);
    await openViaDialog(core.enqueueDialog, page, book);
    await placeCaret(page, 'body[1]/section[2]/p[5]', 9);
    await fileNew(page);
    expect(recordOf(core.dataDir!, book)).toEqual({ path: 'body[1]/section[2]/p[5]', offset: 9 });

    // Paragraphs 4 and 5 of section 2 removed: the paragraph now at that place is the last
    // one (p[4] = the former sixth), the character the same.
    rewrite(book, {
      sections: 3,
      paragraphs: 6,
      drop: [
        [2, 4],
        [2, 5],
      ],
    });
    await openViaRecent(page, book);
    await expectCaret(page, { path: 'body[1]/section[2]/p[4]', offset: 9 });
    await expect(paragraphWith(page, paragraphText(2, 6))).toBeInViewport();
    await expect(page.locator('[data-testid^="dialog-"]')).toHaveCount(0);
    await fileNew(page);
    expect(recordOf(core.dataDir!, book)).toEqual({ path: 'body[1]/section[2]/p[4]', offset: 9 });

    // Section 2 removed: the section now at that place is the former third; its fourth
    // paragraph, the same character.
    rewrite(book, { sections: 3, paragraphs: 6, dropSections: [2] });
    await openViaRecent(page, book);
    await expectCaret(page, { path: 'body[1]/section[2]/p[4]', offset: 9 });
    await expect(paragraphWith(page, paragraphText(3, 4))).toBeInViewport();
    await expect(page.locator('[data-testid^="dialog-"]')).toHaveCount(0);
    // A shorter paragraph at that place: the offset is clamped to its length.
    await fileNew(page);
    rewrite(book, { sections: 1, paragraphs: 2 });
    await openViaRecent(page, book);
    await expectCaret(page, { path: 'body[1]/section[1]/p[2]', offset: 9 });
    await fileNew(page);
    writeFileSync(book, readFileSync(book, 'utf8').replace(paragraphText(1, 2), 'Short'), 'utf8');
    await openViaRecent(page, book);
    await expectCaret(page, { path: 'body[1]/section[1]/p[2]', offset: 5 });

    // The body emptied: the document's start, no message.
    await fileNew(page);
    rewrite(book, { sections: 0, paragraphs: 0, emptyBody: true });
    await openViaRecent(page, book);
    await expect(page.getByTestId('body-editor')).toBeVisible();
    await expect(page.locator('[data-testid^="dialog-"]')).toHaveCount(0);
    // An empty body has no text block: the caret settles at the nearest text position to
    // the document's start - the description blocks above the body.
    await expect(page.getByTestId('status-path')).toHaveText(
      /^(title-info\/annotation\[1\]|document-info\/history\[1\]|body\[1\])/,
    );
  });

  test('3e. the eleventh book is still restored: the record is independent of the ten-entry Recent Files list', async ({
    core,
    page,
  }) => {
    const first = longBook(dir, 'eleventh-first.fb2');
    await openApp(core, page);
    await openViaDialog(core.enqueueDialog, page, first);
    const position = { path: 'body[1]/section[2]/p[11]', offset: 2 };
    await placeCaret(page, position.path, position.offset);
    for (let i = 1; i <= 10; i += 1) {
      const other = writeBook(path.join(dir, `eleventh-other-${i}.fb2`), {
        sections: 1,
        paragraphs: 3,
      });
      await openViaDialog(core.enqueueDialog, page, other);
      await placeCaret(page, 'body[1]/section[1]/p[2]', 1);
    }
    // Pushed out of the ten-entry menu ...
    const recent = await core.rpc<{ path: string }[]>('doc.recent');
    expect(recent).toHaveLength(10);
    expect(recent.map((entry) => entry.path)).not.toContain(first);
    // ... the position of the first is still on record and restored through Open.
    expect(recordOf(core.dataDir!, first)).toEqual(position);
    await openViaDialog(core.enqueueDialog, page, first);
    await expectCaret(page, position);
  });

  test('3f. a never-saved document records nothing; a malformed file restores and records nothing', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    const before = positionsText(core.dataDir!);
    // The start-up document: type, place the caret, leave by File > New (Don't save).
    await page.getByTestId('body-editor').locator('p.fb-p').first().click();
    await page.keyboard.type('never saved');
    await expect(page).toHaveTitle(/\* - /);
    await fileNew(page, { modified: true });
    expect(positionsText(core.dataDir!)).toBe(before);

    // A malformed file opens in the Source view only (002 FR-003) and takes no Body caret.
    const malformed = path.join(dir, 'malformed.fb2');
    writeFileSync(malformed, readFileSync(fixtureBook('malformed.fb2')));
    await core.enqueueDialog('dialog.openFile', { paths: [malformed] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    const parseError = page.getByTestId('dialog-parse-error');
    await expect(parseError).toBeVisible();
    await parseError.getByTestId('dialog-parse-error-button-ok').click();
    await waitForBook(page, malformed);
    await expect(page.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');
    expect(await positionOfOpenDocument(core.rpc, page).catch(() => null)).toBeNull();
    await fileNew(page);
    expect(recordOf(core.dataDir!, malformed)).toBeNull();
    expect(positionsText(core.dataDir!)).toBe(before);
  });

  test('3g. two spellings of a path are two records on Linux (the platform compares file names exactly)', async ({
    core,
    page,
  }) => {
    test.skip(process.platform !== 'linux', 'the exact comparison is the Linux rule');
    const lower = longBook(dir, 'spelling.fb2');
    const upper = path.join(dir, 'SPELLING.FB2');
    symlinkSync(lower, upper);
    await openApp(core, page);
    await openViaDialog(core.enqueueDialog, page, lower);
    await placeCaret(page, 'body[1]/section[1]/p[2]', 1);
    await openViaDialog(core.enqueueDialog, page, upper);
    await placeCaret(page, 'body[1]/section[2]/p[2]', 2);
    await fileNew(page);
    expect(recordOf(core.dataDir!, lower)).toEqual({ path: 'body[1]/section[1]/p[2]', offset: 1 });
    expect(recordOf(core.dataDir!, upper)).toEqual({ path: 'body[1]/section[2]/p[2]', offset: 2 });
    await openViaRecent(page, lower);
    await expectCaret(page, { path: 'body[1]/section[1]/p[2]', offset: 1 });
  });
});
