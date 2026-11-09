/**
 * Feature 011, User Story 8 - the Styles view (D42 and its clarifications; FR-020a-FR-020e,
 * FR-020h, FR-020j). Runs against the real core: a book without a stylesheet gains one for its first
 * selector, the Source view shows it and Undo removes it; selectors and declarations that cannot work
 * are refused with their reasons; a stylesheet of another type and faulty CSS are kept as read; a
 * conflict between two stylesheets is marked and reported by Validate; renaming a used class asks to
 * carry its uses.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle } from './fixtures/core';
import { MOD } from './fixtures/keys';

declare const window: { __mfbeTest?: { scripts?: { toXml(): Promise<string> } } };

const head = (stylesheets: string) => `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
${stylesheets}<description>
<title-info><genre>prose</genre><author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Styles</book-title><lang>en</lang></title-info>
<document-info><author><nickname>maker</nickname></author><date>2026</date><id>styles-1</id><version>1.0</version></document-info>
</description>
<body><section><title><p>One</p></title><p style="letter">Dear friend,</p><p>A <style name="letter">styled</style> word.</p></section></body>
</FictionBook>
`;

const PLAIN = head('');
const STYLED = head(
  '<stylesheet type="text/css">p { text-indent: 1em; }\n.letter { font-style: italic; }</stylesheet>\n' +
    '<stylesheet type="text/x-other">anything { at all</stylesheet>\n' +
    '<stylesheet type="text/css">p { text-indent: 2em; }</stylesheet>\n',
);

async function open(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await page.getByTestId('view-styles').click();
  await expect(page.getByTestId('styles-view')).toBeVisible();
}

/** Add style… with a selector: a class as a named style (typed without its dot), else an element's. */
async function addSelector(page: Page, selector: string): Promise<void> {
  await page.getByTestId('styles-add').click();
  if (selector.startsWith('.')) {
    await page.getByTestId('dialog-styles-add-kind-named').check();
    await page.getByTestId('dialog-styles-add-name').fill(selector.slice(1));
  } else {
    await page.getByTestId('dialog-styles-add-element').fill(selector);
  }
}

const xml = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.toXml());

test.describe('US8 (feature 011) - the Styles view', () => {
  let dir: string;
  let plain: string;
  let styled: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-011-us8-'));
    plain = path.join(dir, 'plain.fb2');
    styled = path.join(dir, 'styled.fb2');
    writeFileSync(plain, PLAIN, 'utf8');
    writeFileSync(styled, STYLED, 'utf8');
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('a first selector makes the book a CSS stylesheet; Source shows it; Undo removes it; refusals', async ({
    core,
    page,
  }) => {
    await open(core, page, plain);
    await expect(page.getByTestId('styles-empty')).toBeVisible();
    // A selector that matches nothing in an FB2 book is refused with its reason.
    await addSelector(page, 'div > span');
    await expect(page.getByTestId('dialog-styles-add-button-ok')).toBeDisabled();
    await expect(page.getByTestId('dialog-styles-add-error')).toContainText(
      'Matches nothing in an FB2 book',
    );
    // A named style is typed by its name alone; the dot is added (rc.2 review).
    await page.getByTestId('dialog-styles-add-kind-named').check();
    await page.getByTestId('dialog-styles-add-name').fill('letter');
    await expect(page.getByTestId('dialog-styles-add-result')).toContainText('.letter');
    await page.getByTestId('dialog-styles-add-button-ok').click();
    await expect(page.getByTestId('styles-selected-selector')).toHaveText('.letter');
    // Declarations: a standard one is accepted, the others refused with their reasons.
    const editor = page.getByTestId('styles-editor').locator('.cm-content');
    // The new rule's empty box says what to type, and the caret is already in it (rc.1 review).
    await expect(page.getByTestId('styles-editor').locator('.cm-placeholder')).toContainText(
      'Type the declarations of .letter',
    );
    await expect(editor).toBeFocused();
    await page.keyboard.type('-webkit-hyphens: auto; colr: red;');
    await expect(page.getByTestId('styles-issues')).toContainText(
      '-webkit-hyphens: not a standard CSS property',
    );
    await expect(page.getByTestId('styles-issues')).toContainText(
      'colr: not a standard CSS property',
    );
    await expect(page.getByTestId('styles-apply')).toBeDisabled();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.type('font-style: italic;');
    await expect(page.getByTestId('styles-issues')).toHaveCount(0);
    await page.getByTestId('styles-apply').click();
    await expect
      .poll(() => xml(page))
      .toMatch(/<stylesheet type="text\/css">\.letter \{\s*font-style: italic;\s*\}/);
    // The Source view shows it.
    await page.getByTestId('view-source').click();
    await expect(page.locator('.cm-content')).toContainText('.letter {');
    // Undo removes it again, one step at a time (the rule's declarations, then the rule).
    await page.getByTestId('view-styles').click();
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-undo').click();
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-undo').click();
    await expect.poll(() => xml(page)).not.toContain('<stylesheet');
  });

  test('two stylesheets, another type kept as read, a conflict marked and in Validate, rename carries uses', async ({
    core,
    page,
  }) => {
    await open(core, page, styled);
    await expect(page.getByTestId('styles-group-0-header')).toContainText('text/css');
    await expect(page.getByTestId('styles-group-1-readonly')).toBeVisible();
    await expect(page.getByTestId('styles-group-1-readonly')).toContainText('anything { at all');
    // p sets text-indent to 1em in the first stylesheet and to 2em in the third: both marked.
    await expect(page.getByTestId('styles-rule-0-0')).toHaveAttribute('data-conflict', 'true');
    await expect(page.getByTestId('styles-rule-2-0')).toHaveAttribute('data-conflict', 'true');
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-validate').click();
    await expect(page.getByTestId('validation-panel')).toContainText('text-indent');
    // Renaming the used class asks to carry its two uses along.
    await page.getByTestId('styles-rule-0-1').click();
    await page.getByTestId('styles-rename').click();
    await page.getByTestId('dialog-styles-rename-input').fill('.note');
    await page.getByTestId('dialog-styles-rename-button-ok').click();
    await expect(page.getByTestId('dialog-styles-rename-uses')).toContainText(
      '2 places use .letter',
    );
    await page.getByTestId('dialog-styles-rename-uses-button-ok').click();
    await expect.poll(() => xml(page)).toContain('<p style="note">');
    const text = await xml(page);
    expect(text).toContain('<style name="note">styled</style>');
    // The stylesheet of another type is written exactly as read.
    expect(text).toContain('<stylesheet type="text/x-other">anything { at all</stylesheet>');
    // The untouched third stylesheet keeps its text byte for byte (guard G13).
    expect(text).toContain('<stylesheet type="text/css">p { text-indent: 2em; }</stylesheet>');
  });
});
