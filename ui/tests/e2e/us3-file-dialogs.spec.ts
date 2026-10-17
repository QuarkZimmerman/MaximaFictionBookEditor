/**
 * Feature 002, User Story 3 - File dialogs show book files by default (T031; spec FR-010 to
 * FR-013).
 *
 * Every file dialog request reaches the core, which records it (`test.dialogRequests`) and
 * answers it from the queue (`test.enqueueDialog`). The journeys check what each dialog of the
 * editor asks the platform to show - the file types in order, the selected type, the folder or
 * the proposed file, several files, the encoding choice of Save As - for Open, Save As (saved
 * and never-saved document), block / inline / section image, cover image, Add Binary Object,
 * Save image as and the custom dictionary, in English, with `?lang=ru` and with `?lang=uk`
 * (feature 003, FR-002: the file-type names in Ukrainian). On Linux and macOS
 * the core opens every dialog that names no folder in the folder last used by Open or Save As,
 * Open and Save As in the user's documents folder while none is kept (Windows keeps the folder
 * in the dialogs). The platform dialogs themselves are covered by the shell tests (tests/shell)
 * and the shell's self-test.
 */

import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import {
  expect,
  fileNew,
  fixtureBook,
  test,
  waitForBook,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import { uiText, type UiLang } from './fixtures/i18n';

interface FileType {
  name: string;
  extensions: string[];
}

interface DialogRequest {
  method: string;
  mode: string;
  title: string;
  filters?: FileType[];
  multiple?: boolean;
  selectedFilter?: number;
  folder?: string;
  defaultPath?: string;
  encodingChoices?: string[];
  selectedEncoding?: string;
  encodingLabel?: string;
}

type Language = UiLang;

/** The label of the encoding choice inside Save As, in the interface language. */
const ENCODING_LABEL: Record<Language, string> = {
  en: 'Encoding:',
  ru: 'Кодировка:',
  uk: 'Кодування:',
};

/** The type names the dialogs must show (FR-010, FR-011). */
const NAMES: Record<Language, Record<string, string>> = {
  en: {
    fb2: 'FictionBook files (*.fb2)',
    fbd: 'FictionBook descriptors (*.fbd)',
    all: 'All files (*.*)',
    supported: 'Supported images (*.jpg;*.jpeg;*.png)',
    jpeg: 'JPEG (*.jpg)',
    png: 'PNG (*.png)',
    bmp: 'Bitmap (*.bmp)',
    gif: 'GIF (*.gif)',
    tiff: 'TIFF (*.tif)',
    webp: 'WebP (*.webp)',
    jpegFiles: 'JPEG files (*.jpg)',
    pngFiles: 'PNG files (*.png)',
    dictionaries: 'Dictionaries (*.dic)',
  },
  ru: {
    fb2: 'Файлы FictionBook (*.fb2)',
    fbd: 'Описания FictionBook (*.fbd)',
    all: 'Все файлы (*.*)',
    supported: 'Поддерживаемые изображения (*.jpg;*.jpeg;*.png)',
    jpeg: 'JPEG (*.jpg)',
    png: 'PNG (*.png)',
    bmp: 'Точечные рисунки (*.bmp)',
    gif: 'GIF (*.gif)',
    tiff: 'TIFF (*.tif)',
    webp: 'WebP (*.webp)',
    jpegFiles: 'Файлы JPEG (*.jpg)',
    pngFiles: 'Файлы PNG (*.png)',
    dictionaries: 'Словари (*.dic)',
  },
  uk: {
    fb2: 'Файли FictionBook (*.fb2)',
    fbd: 'Описи FictionBook (*.fbd)',
    all: 'Усі файли (*.*)',
    supported: 'Підтримувані зображення (*.jpg;*.jpeg;*.png)',
    jpeg: 'JPEG (*.jpg)',
    png: 'PNG (*.png)',
    bmp: 'Точкові рисунки (*.bmp)',
    gif: 'GIF (*.gif)',
    tiff: 'TIFF (*.tif)',
    webp: 'WebP (*.webp)',
    jpegFiles: 'Файли JPEG (*.jpg)',
    pngFiles: 'Файли PNG (*.png)',
    dictionaries: 'Словники (*.dic)',
  },
};

/** IDS_ENCODINGS of the original editor, in its order. */
const ENCODINGS = [
  'utf-8',
  'utf-16',
  'windows-1251',
  'windows-1252',
  'iso-8859-1',
  'iso-8859-2',
  'iso-8859-5',
  'iso-8859-15',
  'koi8-r',
];

/** Linux and macOS: the core opens dialogs in the folder last used by Open or Save As. */
const KEEPS_LAST_FOLDER = process.platform !== 'win32';

function documentTypes(names: Record<string, string>): FileType[] {
  return [
    { name: names.fb2!, extensions: ['fb2'] },
    { name: names.fbd!, extensions: ['fbd'] },
    { name: names.all!, extensions: ['*'] },
  ];
}

function imageTypes(names: Record<string, string>): FileType[] {
  return [
    { name: names.supported!, extensions: ['jpg', 'jpeg', 'png'] },
    { name: names.jpeg!, extensions: ['jpg'] },
    { name: names.png!, extensions: ['png'] },
    { name: names.bmp!, extensions: ['bmp'] },
    { name: names.gif!, extensions: ['gif'] },
    { name: names.tiff!, extensions: ['tif'] },
    { name: names.webp!, extensions: ['webp'] },
  ];
}

function image(name: string): string {
  return path.resolve(path.dirname(fixtureBook('x')), '..', 'images', name);
}

async function recordsDialogs(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('test.dialogRequests')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

/** Runs `action` and returns the first file dialog request it caused, as the core got it. */
async function requestOf(core: CoreHandle, action: () => Promise<void>): Promise<DialogRequest> {
  const before = (await core.rpc<DialogRequest[]>('test.dialogRequests')).length;
  await action();
  let requests: DialogRequest[] = [];
  await expect
    .poll(async () => {
      requests = await core.rpc<DialogRequest[]>('test.dialogRequests');
      return requests.length;
    })
    .toBeGreaterThan(before);
  return requests[before]!;
}

async function openApp(core: CoreHandle, page: Page, language: Language): Promise<void> {
  const url = new URL(core.baseURL);
  url.searchParams.set('lang', language);
  await page.goto(url.toString());
  await page.getByTestId('app-root').waitFor();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.getByTestId('status-message')).toHaveText(uiText(language, 'status.ready'));
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/** File > Open answered with `file`; waits until the book is the open document. */
async function openBook(core: CoreHandle, page: Page, file: string): Promise<DialogRequest> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  const request = await requestOf(core, () => menu(page, 'file', 'open'));
  await waitForBook(page, file);
  return request;
}

/** File > Save As, cancelled. */
async function saveAsCancelled(core: CoreHandle, page: Page): Promise<DialogRequest> {
  await core.enqueueDialog('dialog.saveFile', {});
  return requestOf(core, () => menu(page, 'file', 'saveAs'));
}

function paragraph(page: Page): Locator {
  return page.getByTestId('body-editor').locator('.fb-section > p.fb-p').first();
}

/** Puts the caret into the first paragraph (the editor reads the selection asynchronously). */
async function clickIntoParagraph(page: Page): Promise<void> {
  await paragraph(page).click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId('status-path')).toHaveText(/\/p\[\d+\]$/);
  await page.waitForTimeout(80);
}

for (const language of ['en', 'ru', 'uk'] as const) {
  const names = NAMES[language];

  test.describe(`US3 (feature 002) - file dialogs show book files by default (${language})`, () => {
    let dir: string;
    let books: string;

    test.beforeAll(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us3-dialogs-'));
      books = path.join(dir, 'Книги 书');
      mkdirSync(books);
      copyFileSync(fixtureBook('modern-utf8.fb2'), path.join(books, 'book.fb2'));
      copyFileSync(fixtureBook('descriptor.fbd'), path.join(books, 'descriptor.fbd'));
      copyFileSync(fixtureBook('legacy-cp1251.fb2'), path.join(books, 'legacy.fb2'));
    });

    test.afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    test.beforeEach(async ({ core }) => {
      test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
      test.skip(!(await recordsDialogs(core)), 'the core does not record dialog requests');
      // Nothing remembered from earlier journeys of this worker.
      await core.rpc('settings.set', {
        patch: { session: { lastFileDialogFolder: '' }, other: { keepEncoding: false } },
      });
    });

    test('Open and Save As offer the FictionBook types, select the document kind and open on its file or the folder last used', async ({
      core,
      page,
    }) => {
      await openApp(core, page, language);
      const book = path.join(books, 'book.fb2');

      // Open: FictionBook files selected; nothing kept yet (Linux and macOS: the user's documents
      // folder, when there is one).
      const open = await openBook(core, page, book);
      expect(open).toMatchObject({
        method: 'dialog.openFile',
        mode: 'open',
        filters: documentTypes(names),
        selectedFilter: 0,
        multiple: false,
      });
      expect(open.folder).not.toBe(books);

      // Save As of a saved book: its folder and name, FictionBook files selected, the encoding
      // choice inside the dialog - the original's list, the Save encoding selected, labelled in
      // the interface language.
      const saved = await saveAsCancelled(core, page);
      expect(saved).toMatchObject({
        method: 'dialog.saveFile',
        mode: 'save',
        filters: documentTypes(names),
        selectedFilter: 0,
        defaultPath: book,
        encodingChoices: ENCODINGS,
        selectedEncoding: 'utf-8',
        encodingLabel: ENCODING_LABEL[language],
      });
      expect(saved.folder).toBeUndefined();
      await expect(page.getByTestId('dialog-encoding')).toHaveCount(0);

      // The next Open starts in the folder of the last one.
      await core.enqueueDialog('dialog.openFile', { paths: [] });
      const again = await requestOf(core, () => menu(page, 'file', 'open'));
      expect(again.selectedFilter).toBe(0);
      expect(again.folder).toBe(KEEPS_LAST_FOLDER ? books : undefined);

      // A descriptor: Save As selects "FictionBook descriptors".
      const descriptor = path.join(books, 'descriptor.fbd');
      await openBook(core, page, descriptor);
      const fbd = await saveAsCancelled(core, page);
      expect(fbd).toMatchObject({ filters: documentTypes(names), selectedFilter: 1 });
      expect(fbd.defaultPath).toBe(descriptor);

      // "Keep encoding": the book's own encoding is selected, the list keeps its order.
      await core.rpc('settings.set', { patch: { other: { keepEncoding: true } } });
      await openBook(core, page, path.join(books, 'legacy.fb2'));
      const kept = await saveAsCancelled(core, page);
      expect(kept).toMatchObject({ encodingChoices: ENCODINGS, selectedEncoding: 'windows-1251' });

      // A document never saved: no file proposed, the folder last used, FictionBook files.
      await fileNew(page);
      const fresh = await saveAsCancelled(core, page);
      expect(fresh).toMatchObject({ filters: documentTypes(names), selectedFilter: 0 });
      expect(fresh.defaultPath).toBeUndefined();
      expect(fresh.folder).toBe(KEEPS_LAST_FOLDER ? books : undefined);
    });

    test('image, cover, binary object and "Save image as" dialogs offer the original types', async ({
      core,
      page,
    }) => {
      await core.rpc('settings.set', {
        patch: { other: { askOnNonClearImage: false, insertClearImages: false } },
      });
      try {
        await openApp(core, page, language);
        await openBook(core, page, path.join(books, 'book.fb2'));
        await expect(page.getByTestId('body-view')).toBeVisible();
        const folder = KEEPS_LAST_FOLDER ? books : undefined;

        // Block, inline and section image: "Supported images" selected, no "All files".
        await clickIntoParagraph(page);
        await core.enqueueDialog('dialog.openFile', { paths: [image('tiny.jpg')] });
        const block = await requestOf(core, () => menu(page, 'add', 'image'));
        expect(block).toMatchObject({
          method: 'dialog.openFile',
          mode: 'open',
          filters: imageTypes(names),
          selectedFilter: 0,
          multiple: false,
        });
        expect(block.folder).toBe(folder);
        const figure = page.locator('[data-testid="body-image"][data-href="#tiny.jpg"]');
        await expect(figure).toBeVisible();
        for (const command of ['inlineImage', 'sectionImage']) {
          await clickIntoParagraph(page);
          await core.enqueueDialog('dialog.openFile', { paths: [] });
          const request = await requestOf(core, () => menu(page, 'add', command));
          expect(request, command).toMatchObject({
            mode: 'open',
            filters: imageTypes(names),
            selectedFilter: 0,
          });
        }

        // Save image as: JPEG files selected, the image's name proposed.
        await core.enqueueDialog('dialog.saveFile', {});
        const saveImage = await requestOf(core, async () => {
          await figure.click({ button: 'right' });
          await page.getByTestId('context-menu-save-image-as').click();
        });
        expect(saveImage).toMatchObject({
          method: 'dialog.saveFile',
          mode: 'save',
          filters: [
            { name: names.jpegFiles, extensions: ['jpg'] },
            { name: names.pngFiles, extensions: ['png'] },
            { name: names.all, extensions: ['*'] },
          ],
          selectedFilter: 0,
          defaultPath: 'tiny.jpg',
          encodingChoices: [],
        });
        expect(saveImage.folder).toBe(folder);

        // Add Binary Object: "All files" first, "Supported images" selected, several files.
        await core.enqueueDialog('dialog.openFile', { paths: [] });
        const binary = await requestOf(core, () => menu(page, 'add', 'binary'));
        expect(binary).toMatchObject({
          method: 'dialog.openFile',
          mode: 'openMultiple',
          multiple: true,
          filters: [{ name: names.all, extensions: ['*'] }, ...imageTypes(names)],
          selectedFilter: 1,
        });

        // The cover image file: the image types.
        await page.getByTestId('view-description').click();
        await page.getByTestId('description-cover-add').click();
        await expect(page.getByTestId('cover-picker')).toBeVisible();
        await core.enqueueDialog('dialog.openFile', { paths: [] });
        const cover = await requestOf(core, () =>
          page.getByTestId('cover-picker-add-file').click(),
        );
        expect(cover).toMatchObject({
          mode: 'open',
          filters: imageTypes(names),
          selectedFilter: 0,
        });
        await page.getByTestId('cover-picker-button-cancel').click();
      } finally {
        await core.rpc('settings.set', {
          patch: { other: { askOnNonClearImage: null, insertClearImages: null } },
        });
      }
    });

    test('the custom dictionary dialog offers Dictionaries and proposes the current dictionary', async ({
      core,
      page,
    }) => {
      await openApp(core, page, language);
      await menu(page, 'tools', 'settings');
      await expect(page.getByTestId('settings-page-view')).toBeVisible();
      const dictionary = path.join(dir, 'Словари', 'мой словарь.dic');
      await page.getByTestId('settings-view-custom-dictionary').fill(dictionary);
      await core.enqueueDialog('dialog.openFile', { paths: [] });
      const request = await requestOf(core, () =>
        page.getByTestId('settings-view-custom-dictionary-browse').click(),
      );
      expect(request).toEqual({
        method: 'dialog.openFile',
        mode: 'open',
        title: expect.any(String),
        filters: [
          { name: names.dictionaries, extensions: ['dic'] },
          { name: names.all, extensions: ['*'] },
        ],
        selectedFilter: 0,
        multiple: false,
        defaultPath: dictionary,
      });
      await page.getByTestId('dialog-settings-button-cancel').click();
    });
  });
}

/** The JSON-RPC message of a WebSocket frame (null for anything else). */
function rpcMessage(frame: string | Buffer): { id?: unknown; method?: unknown } | null {
  try {
    const message: unknown = JSON.parse(frame.toString());
    return typeof message === 'object' && message !== null ? message : null;
  } catch {
    return null;
  }
}

test.describe('US3 (feature 002) - the editor waits for an open file dialog', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('clicks and keys reach nothing while a file dialog is open, as behind a modal dialog', async ({
    core,
    page,
  }) => {
    // The answer of File > Open is held back: the dialog stays "open" until the test lets it go.
    const dialog = { requestId: null as unknown, held: [] as (string | Buffer)[], holding: true };
    const answers: { send: (frame: string | Buffer) => void }[] = [];
    await page.routeWebSocket(/\/rpc\?/, (ws) => {
      const server = ws.connectToServer();
      answers.push(ws);
      ws.onMessage((frame) => {
        const request = rpcMessage(frame);
        if (request?.method === 'dialog.openFile') dialog.requestId = request.id;
        server.send(frame);
      });
      server.onMessage((frame) => {
        const answer = rpcMessage(frame);
        if (dialog.holding && answer?.id !== undefined && answer.id === dialog.requestId) {
          dialog.held.push(frame);
          return;
        }
        ws.send(frame);
      });
    });
    await openApp(core, page, 'en');
    await expect(paragraph(page)).toBeVisible();
    const before = await page.getByTestId('body-editor').innerText();

    await core.enqueueDialog('dialog.openFile', { paths: [] });
    await menu(page, 'file', 'open');
    await expect.poll(() => dialog.held.length).toBe(1);
    const root = page.locator('#root');
    await expect(root).toHaveAttribute('inert', '');
    await page.getByTestId('menu-file').click({ force: true });
    await expect(page.getByTestId('menu-file-popup')).toHaveCount(0);
    await paragraph(page).click({ force: true });
    await page.keyboard.type('typed behind the dialog');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('body-editor')).toHaveText(before);

    // The dialog closes: the editor takes input again.
    dialog.holding = false;
    for (const frame of dialog.held.splice(0)) answers.at(-1)!.send(frame);
    await expect(root).not.toHaveAttribute('inert');
    await clickIntoParagraph(page);
    await page.keyboard.type('after');
    await expect(page.getByTestId('body-editor')).toContainText('after');
  });
});
