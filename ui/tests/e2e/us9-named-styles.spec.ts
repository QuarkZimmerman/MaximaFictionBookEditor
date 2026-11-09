/**
 * Feature 011, User Story 9 - named styles (D43 and its clarifications; FR-020f; contracts/styles.md
 * §4). Runs against the real core: Style > Named Style offers the stylesheet's classes by name, wraps
 * the selected text in the chosen one or sets the style of the paragraph at the caret, removes it in
 * one undo step, and is greyed with its reason when nothing can carry a style or no class exists.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle } from './fixtures/core';
import { LINE_END, LINE_START } from './fixtures/keys';

declare const window: { __mfbeTest?: { scripts?: { toXml(): Promise<string> } } };

const book = (stylesheet: string) => `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
${stylesheet}<description>
<title-info><genre>prose</genre><author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Named</book-title><lang>en</lang></title-info>
<document-info><author><nickname>maker</nickname></author><date>2026</date><id>named-1</id><version>1.0</version></document-info>
</description>
<body><section><title><p>One</p></title><p>Dear friend</p><p>Yours truly</p></section></body>
</FictionBook>
`;

async function open(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

async function namedStyleMenu(page: Page): Promise<void> {
  await page.getByTestId('menu-style').click();
  await page.getByTestId('menu-style-namedStyle').hover();
}

const xml = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.toXml());

test.describe('US9 (feature 011) - named styles', () => {
  let dir: string;
  let styled: string;
  let plain: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-011-us9-'));
    styled = path.join(dir, 'styled.fb2');
    plain = path.join(dir, 'plain.fb2');
    writeFileSync(
      styled,
      book(
        '<stylesheet type="text/css">.letter { font-style: italic; }\n.sign { text-align: right; }</stylesheet>\n',
      ),
      'utf8',
    );
    writeFileSync(
      plain,
      book('<stylesheet type="text/css">p { text-indent: 1em; }</stylesheet>\n'),
      'utf8',
    );
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('1-3. the classes by name; selected text, the paragraph at the caret; removal in one undo step', async ({
    core,
    page,
  }) => {
    await open(core, page, styled);
    const editor = page.getByTestId('body-editor');
    // 1. Selected text: wrapped in the chosen style.
    await editor.getByText('Dear friend').click();
    await page.keyboard.press(LINE_START);
    await page.keyboard.press(`Shift+${LINE_END}`);
    await namedStyleMenu(page);
    await expect(page.getByTestId('menu-style-namedStyle-named:letter')).toBeVisible();
    await expect(page.getByTestId('menu-style-namedStyle-named:sign')).toBeVisible();
    await page.getByTestId('menu-style-namedStyle-named:letter').click();
    await expect.poll(() => xml(page)).toContain('<p><style name="letter">Dear friend</style></p>');
    // 2. The caret in a paragraph, nothing selected: the paragraph's style attribute.
    await editor.getByText('Yours truly').click();
    await namedStyleMenu(page);
    await page.getByTestId('menu-style-namedStyle-named:sign').click();
    await expect.poll(() => xml(page)).toContain('<p style="sign">Yours truly</p>');
    // 3. Removing the style restores the text, in one undo step.
    await editor.getByText('Dear friend').click();
    await page.keyboard.press(LINE_START);
    await page.keyboard.press(`Shift+${LINE_END}`);
    await namedStyleMenu(page);
    await page.getByTestId('menu-style-namedStyle-removeNamed').click();
    await expect.poll(() => xml(page)).toContain('<p>Dear friend</p>');
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-undo').click();
    await expect.poll(() => xml(page)).toContain('<p><style name="letter">Dear friend</style></p>');
  });

  test('4. greyed with its reason when no class exists', async ({ core, page }) => {
    await open(core, page, plain);
    await page.getByTestId('body-editor').getByText('Dear friend').click();
    await page.getByTestId('menu-style').click();
    const submenu = page.getByTestId('menu-style-namedStyle');
    await expect(submenu).toHaveAttribute('aria-disabled', 'true');
    await expect(submenu).toHaveAttribute('title', /No named style is defined/);
  });
});
