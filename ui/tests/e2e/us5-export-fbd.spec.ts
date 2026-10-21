/**
 * Feature 004, User Story 5 - Export the description as an FBD file (T045; spec FR-040 to
 * FR-044, SC-005).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`);
 * skipped in core-less mode. File > Export > Export as FBD... is answered through the queued
 * native save dialog (`test.enqueueDialog`). The scenarios:
 *
 *  1. a saved book: the recorded save request offers the one type "FictionBook descriptors
 *     (*.fbd)", no encoding choice, `<folder>/<stem>.fbd`; the written file is UTF-8, its
 *     description is what Save writes for the same document (an unsaved edit included), its
 *     body exactly `<body><section/></body>`, the cover binary alone, no stylesheet, no
 *     paragraph beyond the annotation and the history; the file passes the FB2 2.1 validation;
 *     title bar, modified state and Recent Files are unchanged;
 *  2. a never-saved document: the bare proposed name with `.fbd` in the remembered folder, the
 *     chosen folder remembered afterwards (FR-053); an incomplete description gets Save's own
 *     prompt - No writes nothing, Yes writes;
 *  3. the exported role entries equal the library's expected fixture (FR-044, SC-003);
 *  4. the open document's own file is refused with a message, before any validation prompt;
 *  5. the exported file imported into a new untouched document reproduces the description
 *     (FR-044);
 *  6. pending Source edits are committed first; a malformed Source refuses with the usual
 *     message (FR-043);
 *  7. the item is disabled while a script runs (FR-043).
 *
 * No `@perf` section: the export has no time budget (requester, 2026-10-20).
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import {
  expect,
  fileNew,
  fixtureBook,
  NodeRpcClient,
  startCoreWith,
  test,
  waitForBook,
  waitForStartupDocument,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import { pageAnyPattern, pagePattern, pageText } from './fixtures/i18n';
import { MOD } from './fixtures/keys';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SCHEMA = path.join(REPO_ROOT, 'resources', 'schema', 'FictionBook.xsd');
const SCRIPT_FIXTURES = path.join(REPO_ROOT, 'tests', 'scripts', 'fixtures');

interface Row {
  infoType: string;
  text: string;
}

const EXPECTED_ROLES: { rows: Row[] } = JSON.parse(
  readFileSync(fixtureBook('maxlib-roles.expected.json'), 'utf8'),
) as { rows: Row[] };

interface ScriptHooks {
  list(): { id: string }[];
  run(id: string): Promise<unknown>;
}

declare const window: { __mfbeTest?: { scripts?: ScriptHooks } };

interface DialogRequest {
  method: string;
  filters?: { name: string; extensions: string[] }[];
  selectedFilter?: number;
  folder?: string;
  defaultPath?: string;
  encodingChoices?: string[];
  selectedEncoding?: string;
}

async function supportsDocuments(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('doc.recent')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

async function openApp(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
  await waitForStartupDocument(page);
}

async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
}

/** File > Export > Export as FBD... (the menu item alone). */
async function clickExport(page: Page): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-export').hover();
  await page.getByTestId('menu-file-export-exportFbd').click();
}

/** Every file dialog request the core recorded. */
async function dialogRequests(core: CoreHandle): Promise<DialogRequest[]> {
  return core.rpc<DialogRequest[]>('test.dialogRequests');
}

/** Runs `action` and returns the first file dialog request it caused, as the core got it. */
async function requestOf(core: CoreHandle, action: () => Promise<void>): Promise<DialogRequest> {
  const before = (await dialogRequests(core)).length;
  await action();
  let requests: DialogRequest[] = [];
  await expect
    .poll(async () => {
      requests = await dialogRequests(core);
      return requests.length;
    })
    .toBeGreaterThan(before);
  return requests[before]!;
}

const validationPrompt = (page: Page): Locator =>
  page.getByTestId('dialog-export-validation-failed');

/** The status bar's "Description exported to ..." in the page's language. */
async function expectExported(page: Page, file: string): Promise<void> {
  await expect(page.getByTestId('status-message')).toHaveText(
    await pageAnyPattern(page, 'transfer.export.done', 'transfer.export.doneWithErrors'),
  );
  await expect(page.getByTestId('status-message')).toContainText(file);
}

/**
 * File > Export > Export as FBD... answered with `file`; an incomplete description gets Save's
 * "export anyway?" prompt, answered with Yes. Returns the recorded save request.
 */
async function exportTo(core: CoreHandle, page: Page, file: string): Promise<DialogRequest> {
  await core.enqueueDialog('dialog.saveFile', { path: file });
  const request = await requestOf(core, () => clickExport(page));
  const status = page.getByTestId('status-message');
  const done = await pageAnyPattern(page, 'transfer.export.done', 'transfer.export.doneWithErrors');
  await expect
    .poll(
      async () => (await validationPrompt(page).count()) > 0 || done.test(await status.innerText()),
    )
    .toBe(true);
  if ((await validationPrompt(page).count()) > 0) {
    await page.getByTestId('dialog-export-validation-failed-button-yes').click();
  }
  await expectExported(page, file);
  return request;
}

async function showDescription(page: Page): Promise<void> {
  await page.getByTestId('view-description').click();
  await expect(page.getByTestId('description-view')).toBeVisible();
}

async function showSource(page: Page): Promise<void> {
  await page.getByTestId('view-source').click();
  await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
}

/** Types into a Description field and commits it (the form writes on blur). */
async function fillField(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).fill(value);
  await page.getByTestId(testId).blur();
}

/** Replaces the whole Source text (select all + insert). */
async function replaceSourceText(page: Page, text: string): Promise<void> {
  await showSource(page);
  await page.getByTestId('source-editor').click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.insertText(text);
}

/** The Source text of `file` as the core serialises it (elided binaries). */
async function serialisedText(core: CoreHandle, file: string): Promise<string> {
  const opened = await core.rpcJob<{ document: { docId: string } }>('doc.open', { path: file });
  try {
    const { text } = await core.rpc<{ text: string }>('doc.toXml', {
      docId: opened.document.docId,
      document: opened.document,
      elideBinaries: true,
    });
    return text;
  } finally {
    await core.rpc('doc.close', { docId: opened.document.docId });
  }
}

async function docId(page: Page): Promise<string> {
  const id = await page.getByTestId('body-view').getAttribute('data-doc-id');
  if (!id) throw new Error('no document shown');
  return id;
}

async function recentPaths(core: CoreHandle): Promise<string[]> {
  const items = await core.rpc<{ path: string }[]>('doc.recent');
  return items.map((item) => item.path);
}

/** The `<description>...</description>` element of a FictionBook text. */
function descriptionOf(xml: string): string {
  const match = /<description>[\s\S]*?<\/description>/.exec(xml);
  if (!match) throw new Error('no <description> in the text');
  return match[0];
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** The `custom-info` elements of a saved file, in file order, with their text as written. */
function customInfoRows(xml: string): Row[] {
  const rows: Row[] = [];
  for (const match of descriptionOf(xml).matchAll(
    /<custom-info\b([^>]*?)(?:\/>|>([\s\S]*?)<\/custom-info>)/g,
  )) {
    const infoType = /info-type="([^"]*)"/.exec(match[1] ?? '')?.[1] ?? '';
    rows.push({ infoType: unescapeXml(infoType), text: unescapeXml(match[2] ?? '') });
  }
  return rows;
}

/** `<p>` elements outside the annotation and the history: the book's text, if any leaked. */
function paragraphsOutsideDescriptionBlocks(xml: string): number {
  const stripped = xml
    .replace(/<annotation\b[\s\S]*?<\/annotation>/g, '')
    .replace(/<history\b[\s\S]*?<\/history>/g, '');
  return (stripped.match(/<p[\s>]/g) ?? []).length;
}

/** `xmllint --schema` when libxml2's tool is installed; null when it is not. */
function xmllintValidates(file: string): boolean | null {
  const result = spawnSync('xmllint', ['--noout', '--schema', SCHEMA, file], { encoding: 'utf8' });
  if (result.error) return null;
  return result.status === 0 && /validates/.test(result.stderr);
}

/** Save As through the queued native dialog (the usual prompt answered with Yes). */
async function saveAs(core: CoreHandle, page: Page, file: string): Promise<string> {
  await core.enqueueDialog('dialog.saveFile', { path: file, encoding: 'utf-8' });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-saveAs').click();
  const prompt = page.getByTestId('dialog-validation-failed');
  const title = new RegExp(`^${path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} - `);
  await expect
    .poll(async () => (await prompt.count()) > 0 || title.test(await page.title()))
    .toBe(true);
  if ((await prompt.count()) > 0)
    await page.getByTestId('dialog-validation-failed-button-yes').click();
  await expect(page).toHaveTitle(title);
  return readFileSync(file, 'utf8');
}

test.describe('US5 (004) - export the description as an FBD file', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us5-export-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.* yet');
  });

  test('1. a saved book: the one descriptors type, no encoding choice, <stem>.fbd in its folder; the file holds the description, one empty section and the cover alone, as UTF-8; the document is untouched', async ({
    core,
    page,
  }) => {
    const books = path.join(dir, 'Книги');
    mkdirSync(books, { recursive: true });
    const book = path.join(books, 'book.fb2');
    copyFileSync(fixtureBook('modern-utf8.fb2'), book);
    const exported = path.join(books, 'exported.fbd');
    await openApp(core, page);
    await openBook(core, page, book);
    const id = await docId(page);
    // An unsaved edit: the export writes the description as it is in the editor (FR-041).
    await showDescription(page);
    await fillField(page, 'description-book-title', 'Современная книга (экспорт)');
    await expect(page).toHaveTitle(/^book\.fb2\* - /);
    const recentBefore = await recentPaths(core);

    const request = await exportTo(core, page, exported);
    expect(request).toMatchObject({
      method: 'dialog.saveFile',
      filters: [{ name: 'FictionBook descriptors (*.fbd)', extensions: ['fbd'] }],
      selectedFilter: 0,
      defaultPath: path.join(books, 'book.fbd'),
    });
    expect(request.encodingChoices ?? []).toEqual([]);
    expect(request.selectedEncoding).toBeUndefined();
    expect(request.folder).toBeUndefined(); // the full default path names the folder
    await expect(page.getByTestId('dialog-encoding')).toHaveCount(0);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'transfer.export.done', { path: exported }),
    );

    // The written file.
    const bytes = readFileSync(exported);
    expect(bytes.subarray(0, 38).toString('latin1')).toBe('<?xml version="1.0" encoding="utf-8"?>');
    const text = bytes.toString('utf8');
    expect(text).toContain('<book-title>Современная книга (экспорт)</book-title>');
    expect(text).toMatch(/\t<body>\n\t\t<section\/>\n\t<\/body>\n/);
    expect(text.match(/<body[\s>]/g)).toHaveLength(1);
    expect(text.match(/<section[\s>/]/g)).toHaveLength(1);
    expect(paragraphsOutsideDescriptionBlocks(text)).toBe(0);
    expect(text).not.toContain('Текст с');
    expect(text).not.toContain('<stylesheet');
    expect(text.match(/<binary /g)).toHaveLength(1);
    expect(text).toContain('<binary id="cover.png" content-type="image/png">');
    expect(text).not.toContain('dot.gif');
    expect(text).toContain('<custom-info info-type="source">corpus fixture</custom-info>');
    expect(text).toContain('<history>');

    // FB2 2.1 validation of the exported content: 0 errors (SC-005).
    const report = await core.rpcJob<{ errorCount: number }>('doc.validate', { docId: id, text });
    expect(report.errorCount).toBe(0);
    const lint = xmllintValidates(exported);
    if (lint !== null) expect(lint).toBe(true);

    // The open document is untouched: name, modified state, Recent Files (FR-042).
    await expect(page).toHaveTitle(/^book\.fb2\* - /);
    expect(await recentPaths(core)).toEqual(recentBefore);
    expect(recentBefore).not.toContain(exported);

    // Its description is what Save writes for the same document.
    const saved = await saveAs(core, page, path.join(books, 'saved.fb2'));
    expect(descriptionOf(text)).toBe(descriptionOf(saved));
  });

  test('2. a never-saved document: the proposed name with .fbd in the remembered folder, the chosen folder remembered; an incomplete description asks - No writes nothing, Yes writes', async ({
    core,
    page,
  }) => {
    const remembered = path.join(dir, 'remembered');
    const chosen = path.join(dir, 'chosen');
    mkdirSync(remembered, { recursive: true });
    mkdirSync(chosen, { recursive: true });
    const proposed = 'Толстой Лев - Война и мир.fbd';
    const target = path.join(chosen, proposed);
    await openApp(core, page);
    await fileNew(page);
    await showDescription(page);
    await fillField(page, 'description-author-0-last', 'Толстой');
    await fillField(page, 'description-author-0-first', 'Лев');
    await fillField(page, 'description-author-0-middle', 'Николаевич');
    await fillField(page, 'description-book-title', 'Война и мир');
    await core.rpc('settings.set', { patch: { session: { lastFileDialogFolder: remembered } } });
    const titleBefore = await page.title();
    expect(titleBefore).toMatch(/\*/);

    // No: nothing is written, the status bar says nothing about an export.
    await core.enqueueDialog('dialog.saveFile', { path: target });
    const request = await requestOf(core, () => clickExport(page));
    expect(request).toMatchObject({
      method: 'dialog.saveFile',
      filters: [{ name: 'FictionBook descriptors (*.fbd)', extensions: ['fbd'] }],
      selectedFilter: 0,
      defaultPath: proposed,
    });
    expect(request.encodingChoices ?? []).toEqual([]);
    if (process.platform !== 'win32') expect(request.folder).toBe(remembered);
    const prompt = validationPrompt(page);
    await expect(prompt).toBeVisible();
    await expect(page.getByTestId('dialog-export-validation-failed-text')).toHaveText(
      await pagePattern(page, 'transfer.export.validationFailed'),
    );
    await page.getByTestId('dialog-export-validation-failed-button-no').click();
    await expect(prompt).toHaveCount(0);
    expect(existsSync(target)).toBe(false);
    await expect(page.getByTestId('status-message')).not.toHaveText(
      await pageAnyPattern(page, 'transfer.export.done', 'transfer.export.doneWithErrors'),
    );

    // Yes: written, the errors counted in the status bar; the chosen folder is remembered.
    await core.enqueueDialog('dialog.saveFile', { path: target });
    await clickExport(page);
    await expect(prompt).toBeVisible();
    await page.getByTestId('dialog-export-validation-failed-button-yes').click();
    await expectExported(page, target);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageAnyPattern(page, 'transfer.export.doneWithErrors'),
    );
    expect(existsSync(target)).toBe(true);
    const text = readFileSync(target, 'utf8');
    expect(text).toContain('<last-name>Толстой</last-name>');
    expect(text).toContain('<book-title>Война и мир</book-title>');
    expect(text).toMatch(/\t<body>\n\t\t<section\/>\n\t<\/body>\n/);
    const settings = await core.rpc<{ session: { lastFileDialogFolder: string } }>('settings.get');
    if (process.platform !== 'win32') expect(settings.session.lastFileDialogFolder).toBe(chosen);
    // Still the never-saved, modified document: the export is a copy.
    expect(await page.title()).toBe(titleBefore);
    expect(await recentPaths(core)).not.toContain(target);
  });

  test("3. the exported role entries equal the library's expected fixture (FR-044)", async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await openBook(core, page, fixtureBook('maxlib-roles.fbd'));
    const exported = path.join(dir, 'roles-export.fbd');
    const request = await exportTo(core, page, exported);
    expect(request.defaultPath).toBe(
      path.join(path.dirname(fixtureBook('maxlib-roles.fbd')), 'maxlib-roles.fbd'),
    );
    const text = readFileSync(exported, 'utf8');
    expect(customInfoRows(text)).toEqual(EXPECTED_ROLES.rows);
    expect(text).toMatch(/\t<body>\n\t\t<section\/>\n\t<\/body>\n/);
    await expect(page).toHaveTitle(/^maxlib-roles\.fbd - /);
  });

  test("4. the open document's own file is refused with a message, before any prompt", async ({
    core,
    page,
  }) => {
    const own = path.join(dir, 'own.fbd');
    copyFileSync(fixtureBook('maxlib-roles-edge.fbd'), own);
    const before = readFileSync(own);
    await openApp(core, page);
    await openBook(core, page, own);
    const recentBefore = await recentPaths(core);

    await core.enqueueDialog('dialog.saveFile', { path: own });
    const request = await requestOf(core, () => clickExport(page));
    expect(request.defaultPath).toBe(own);
    const message = page.getByTestId('dialog-export-same-file');
    await expect(message).toBeVisible();
    await expect(page.getByTestId('dialog-export-same-file-text')).toHaveText(
      await pagePattern(page, 'transfer.export.sameFile'),
    );
    await expect(page.getByTestId('dialog-export-same-file-text')).toContainText(own);
    // The identity check comes first: the incomplete description was not even asked about.
    await expect(validationPrompt(page)).toHaveCount(0);
    await page.getByTestId('dialog-export-same-file-button-ok').click();
    await expect(message).toHaveCount(0);
    expect(readFileSync(own).equals(before)).toBe(true);
    await expect(page).toHaveTitle(/^own\.fbd - /);
    expect(await recentPaths(core)).toEqual(recentBefore);
    await expect(page.getByTestId('status-message')).not.toHaveText(
      await pageAnyPattern(page, 'transfer.export.done', 'transfer.export.doneWithErrors'),
    );
  });

  test('5. the exported file imported into a new untouched document reproduces the description (FR-044)', async ({
    core,
    page,
  }) => {
    const exported = path.join(dir, 'round.fbd');
    await openApp(core, page);
    await openBook(core, page, fixtureBook('modern-utf8.fb2'));
    await exportTo(core, page, exported);
    const exportedText = readFileSync(exported, 'utf8');

    await fileNew(page);
    await core.enqueueDialog('dialog.openFile', { paths: [exported] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    await page.getByTestId('menu-file-import-importDescription').click();
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageAnyPattern(page, 'transfer.import.done'),
    );
    await expect(page.getByTestId('body-block-annotation')).toContainText('Аннотация с курсивом.');
    await expect(page.getByTestId('body-block-history')).toContainText('v2.1 — вычитка');
    await showDescription(page);
    await expect(page.getByTestId('description-book-title')).toHaveValue('Современная книга');
    await expect(page.getByTestId('description-author-0-last')).toHaveValue('Иванова');
    await expect(page.getByTestId('description-cover-0-href')).toHaveValue('#cover.png');
    await expect(page.getByTestId('description-sti-book-title')).toHaveValue('A Modern Book');

    // Saved, the new document carries the exported description element for element.
    const saved = await saveAs(core, page, path.join(dir, 'round-trip.fb2'));
    expect(descriptionOf(saved)).toBe(descriptionOf(exportedText));
    expect(saved).toContain('<binary id="cover.png" content-type="image/png">');
  });

  test('6. pending Source edits are committed first; a malformed Source refuses with the usual message (FR-043)', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    const book = fixtureBook('modern-utf8.fb2');
    await openBook(core, page, book);
    const original = await serialisedText(core, book);
    expect(original).toContain('</book-title>');
    await replaceSourceText(page, original.replace('</book-title>', ' (edited)</book-title>'));
    await expect(page).toHaveTitle(/^modern-utf8\.fb2\* - /);

    const exported = path.join(dir, 'from-source.fbd');
    await exportTo(core, page, exported);
    expect(readFileSync(exported, 'utf8')).toContain(
      '<book-title>Современная книга (edited)</book-title>',
    );
    // The Source view still shows, the document still modified.
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'source');
    await expect(page).toHaveTitle(/^modern-utf8\.fb2\* - /);

    // Malformed Source text: refused before the dialog is even asked for (no answer is queued:
    // it would wait for the next dialog).
    await replaceSourceText(
      page,
      original.replace('</book-title>', ' (edited)</book-title>').replace('</p>', ''),
    );
    const requestsBefore = (await dialogRequests(core)).length;
    await clickExport(page);
    const badXml = page.getByTestId('dialog-bad-xml');
    await expect(badXml).toBeVisible();
    await page.getByTestId('dialog-bad-xml-button-ok').click();
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'source');
    await expect(page.getByTestId('source-parse-error')).toBeVisible();
    expect((await dialogRequests(core)).length).toBe(requestsBefore);
  });
});

test.describe('US5 (004) - the export while a script runs', () => {
  let dataDir: string;
  let own: { url: string; stop: () => Promise<void> } | null = null;
  let rpc: NodeRpcClient | null = null;

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.* yet');
  });

  test.afterEach(async () => {
    rpc?.close();
    rpc = null;
    if (own) await own.stop();
    own = null;
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  test('7. the item is disabled while a script runs (FR-043)', async ({ page }) => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'mfbe-us5-export-run-'));
    cpSync(path.join(SCRIPT_FIXTURES, '06_Runs'), path.join(dataDir, 'scripts', '06_Runs'), {
      recursive: true,
    });
    own = await startCoreWith(process.env.MFBE_CORE_BIN!, dataDir, []);
    const url = new URL(own.url);
    rpc = new NodeRpcClient(
      `ws://127.0.0.1:${url.port}/rpc?token=${url.searchParams.get('token') ?? ''}`,
    );
    await page.goto(own.url);
    await waitForStartupDocument(page);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    const item = page.getByTestId('menu-file-export-exportFbd');
    // Available before the run.
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-export').hover();
    await expect(item).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window.__mfbeTest?.scripts?.list() ?? []).some((s) => s.id === 'runs.longSilent'),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.evaluate(() => {
      void window.__mfbeTest!.scripts!.run('runs.longSilent');
    });
    const banner = page.getByTestId('script-run-banner');
    await expect(banner).toBeVisible();
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-export').hover();
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await banner.getByTestId('script-run-cancel').click();
    await expect(banner).toHaveCount(0, { timeout: 15_000 });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-export').hover();
    await expect(item).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });
});
