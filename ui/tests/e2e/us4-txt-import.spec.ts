/**
 * Feature 017, User Story 4 (tasks T035): File > Import > TXT File... makes a new book of a text file the
 * editor did not make - its paragraphs from its layout in one body, the template's description with the
 * file's name as the title; the encoding judged or asked; binary, empty and FictionBook files refused; and
 * File > Open refusing a .txt with a message naming the import.
 */
import { copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, shownDocId, test, type CoreHandle } from './fixtures/core';
import { scratchDir } from './fixtures/scratch';

declare const window: { __mfbeTest?: { scripts?: { toXml(): Promise<string> } } };

const LAYOUTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/txt/layouts',
);
const xml = (page: Page): Promise<string> =>
  page.evaluate(() => window.__mfbeTest!.scripts!.toXml());

test.beforeEach(({ core }) => {
  test.skip(!core.hasCore, 'needs the core');
});

/** File > Import > TXT File... with `file` queued for the Open dialog; the unsaved-changes question answered No. */
async function importTxt(core: CoreHandle, page: Page, file: string): Promise<string | null> {
  const before = await shownDocId(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  await page.getByTestId('menu-file-import-importTxt').click();
  const question = page.getByRole('dialog').filter({ hasText: 'Save changes to' });
  if (
    await question.waitFor({ state: 'visible', timeout: 1500 }).then(
      () => true,
      () => false,
    )
  )
    await question.getByRole('button', { name: 'No' }).click();
  return before;
}

/** Waits for the new book (or the failure, whose text is returned with `failed`). */
async function importEnds(
  page: Page,
  before: string | null,
): Promise<{ failed?: string; summary?: string }> {
  const failed = page.getByTestId('dialog-txt-import-failed');
  const summary = page.getByTestId('dialog-txt-import-summary');
  await expect
    .poll(
      async () =>
        (await failed.isVisible()) ||
        (await summary.isVisible()) ||
        ((await shownDocId(page)) !== before && !(await page.getByTestId('modal-job').isVisible())),
      { timeout: 60_000 },
    )
    .toBe(true);
  if (await failed.isVisible()) {
    const text = (await failed.textContent()) ?? '';
    await failed.getByRole('button', { name: 'OK' }).click();
    return { failed: text };
  }
  if (await summary.isVisible()) {
    const text = (await summary.textContent()) ?? '';
    await summary.getByRole('button', { name: 'OK' }).click();
    return { summary: text };
  }
  return {};
}

test('a wrapped TXT made elsewhere: one body, its paragraphs, the file name as title (D27)', async ({
  core,
  page,
}) => {
  await core.openApp(page);
  const dir = scratchDir('txt-import-');
  const file = path.join(dir, 'Wrapped book.txt');
  copyFileSync(path.join(LAYOUTS, 'reference-all-elements.wrapped-blank.txt'), file);
  const before = await importTxt(core, page, file);
  expect((await importEnds(page, before)).failed).toBeUndefined();
  const book = await xml(page);
  expect(book).toContain('<book-title>Wrapped book</book-title>');
  expect(book.match(/<body>/g)?.length).toBe(1);
  expect(book.match(/<section>/g)?.length).toBe(1);
  expect(book).toContain('<p>A chapter epigraph.</p>');
});

test('a windows-1251 TXT is judged; one the judge cannot tell is asked (D26)', async ({
  core,
  page,
}) => {
  await core.openApp(page);
  const dir = scratchDir('txt-import-enc-');
  const text =
    'Маша жила в Москве. В четверг Маша шла домой по тихой улице. Петя ждал её у дома.\n';
  const cp1251 = path.join(dir, 'cp1251.txt');
  writeFileSync(cp1251, encode1251(text));
  let before = await importTxt(core, page, cp1251);
  const ended = await importEnds(page, before);
  expect(ended.failed).toBeUndefined();
  expect(ended.summary ?? '').toContain('windows-1251');
  expect(await xml(page)).toContain('<p>Маша жила в Москве.');
  // "caf\xE9 \xB9": two encodings read it differently and none leads - the question, all 29 on offer.
  const unsure = path.join(dir, 'unsure.txt');
  writeFileSync(unsure, Buffer.from([0x41, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x20, 0xb9, 0x0a]));
  before = await importTxt(core, page, unsure);
  const question = page.getByTestId('dialog-txt-import-encoding-question');
  await expect(question).toBeVisible();
  await expect(question.locator('option')).toHaveCount(29);
  await question.getByTestId('dialog-txt-import-encoding').selectOption('windows-1252');
  await question.getByRole('button', { name: 'OK' }).click();
  expect((await importEnds(page, before)).failed).toBeUndefined();
  expect(await xml(page)).toContain('<p>A café ¹</p>');
});

test('binary, empty and FictionBook files are refused; nothing changes (D26, D36)', async ({
  core,
  page,
}) => {
  await core.openApp(page);
  const dir = scratchDir('txt-import-refused-');
  const cases: [string, Buffer | string, string][] = [
    ['binary.txt', Buffer.from([0x50, 0x00, 0x4e, 0x00, 0x47]), 'not a text file'],
    ['empty.txt', '', 'holds no text'],
    [
      'book.txt',
      '<?xml version="1.0"?>\n<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"/>',
      'File > Open',
    ],
  ];
  for (const [name, bytes, message] of cases) {
    const file = path.join(dir, name);
    writeFileSync(file, bytes);
    const before = await importTxt(core, page, file);
    const ended = await importEnds(page, before);
    expect(ended.failed ?? '').toContain(message);
    expect(await shownDocId(page)).toBe(before);
  }
});

test('File > Open refuses a .txt, naming the TXT import (D35)', async ({ core, page }) => {
  await core.openApp(page);
  const file = path.join(scratchDir('txt-open-'), 'notes.txt');
  copyFileSync(fixtureBook('modern-utf8.fb2'), file);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  const refused = page.getByTestId('dialog-txt-refused');
  await expect(refused).toBeVisible();
  await expect(refused).toContainText('File > Import > TXT File');
  await refused.getByRole('button', { name: 'OK' }).click();
});

/** The text in windows-1251 (Cyrillic letters and ASCII only). */
function encode1251(text: string): Buffer {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else if (code >= 0x410 && code <= 0x44f) out.push(code - 0x410 + 0xc0);
    else if (code === 0x451) out.push(0xb8);
    else if (code === 0x401) out.push(0xa8);
    else out.push(0x3f);
  }
  return Buffer.from(out);
}
