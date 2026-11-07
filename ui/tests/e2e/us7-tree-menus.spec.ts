/**
 * Feature 010, US7 (T047): a Document tree menu that fits the element (D19-D23) - names that
 * carry the neighbour sections' titles, greyed entries with their reasons, Move Down undone in
 * one step, picture rows with picture actions only, the toolbar's Move Up / Move Down.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle } from './fixtures/core';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function book(dir: string): string {
  const file = path.join(dir, 'chapters.fb2');
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info><genre>sf</genre><author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Chapters</book-title><lang>en</lang></title-info>
<document-info><author><nickname>maker</nickname></author><date value="2026-01-01">2026</date>
<id>chapters-0001</id><version>1.0</version></document-info>
</description>
<body>
<section><title><p>Chapter One</p></title><p>One.</p></section>
<section><title><p>Chapter Two</p></title><image l:href="#pic.png"/><p>Two.</p></section>
<section><title><p>Chapter Three</p></title><p>Three.</p></section>
</body>
<binary id="pic.png" content-type="image/png">${PNG}</binary>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
}

const sectionRow = (page: Page, title: string) =>
  page.locator('.mfbe-tree-row[data-kind="section"]').filter({ hasText: title });
const sectionOrder = (page: Page) =>
  page.locator('.mfbe-tree-row[data-kind="section"] .mfbe-tree-row-caption').allInnerTexts();

test.describe('US7 (010) - a Document tree menu that fits the element', () => {
  test('1-3, 5, 9. names with neighbours, reasons, Move Down undone, picture rows, toolbar buttons', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    const dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us7-010-'));
    await core.openApp(page);
    await openBook(core, page, book(dir));

    await sectionRow(page, 'Chapter Two').click({ button: 'right' });
    const menu = page.getByTestId('tree-menu');
    await expect(menu.getByTestId('tree-menu-view')).toHaveText('Go To');
    await expect(menu.getByTestId('tree-menu-moveUp')).toHaveText('Move Up, Before «Chapter One»');
    await expect(menu.getByTestId('tree-menu-moveDown')).toHaveText(
      'Move Down, After «Chapter Three»',
    );
    await expect(menu.getByTestId('tree-menu-moveWithChildren')).toHaveText(
      'Move Into «Chapter One»',
    );
    await expect(menu.getByTestId('tree-menu-merge')).toHaveText('Merge With «Chapter Three»');
    await expect(menu.getByTestId('tree-menu-moveRight')).toHaveCount(0); // no subsections
    await expect(menu.getByTestId('tree-menu-moveLeft')).toHaveAttribute('aria-disabled', 'true');
    await expect(menu.getByTestId('tree-menu-moveLeft')).toHaveAttribute('title', /top level/);

    await menu.getByTestId('tree-menu-moveDown').click();
    await expect
      .poll(() => sectionOrder(page))
      .toEqual(['Chapter One', 'Chapter Three', 'Chapter Two']);
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-undo').click();
    await expect
      .poll(() => sectionOrder(page))
      .toEqual(['Chapter One', 'Chapter Two', 'Chapter Three']);

    // The first chapter cannot move up, and says why.
    await sectionRow(page, 'Chapter One').click({ button: 'right' });
    await expect(menu.getByTestId('tree-menu-moveUp')).toHaveAttribute('aria-disabled', 'true');
    await expect(menu.getByTestId('tree-menu-moveUp')).toHaveAttribute('title', /first section/);
    await page.keyboard.press('Escape');

    // A picture row: picture actions, no section operation.
    await page.locator('.mfbe-tree-row[data-kind="image"]').click({ button: 'right' });
    await expect(menu.getByTestId('tree-menu-changePicture')).toBeVisible();
    await expect(menu.getByTestId('tree-menu-showPicture')).toBeVisible();
    await expect(menu.getByTestId('tree-menu-moveUp')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The toolbar's Move Up on the third chapter.
    await sectionRow(page, 'Chapter Three').click();
    await page.getByTestId('tree-toolbar-up').click();
    await expect
      .poll(() => sectionOrder(page))
      .toEqual(['Chapter One', 'Chapter Three', 'Chapter Two']);
  });
});
