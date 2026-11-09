/**
 * Feature 011, User Story 3 - escaped characters in regular expressions (D7, D8; FR-020-FR-022).
 * The usual syntax's escapes (`\—`, `\«`, `\-`, `\,`, `\"`) find what the character finds, in the
 * Body view, the Source view and a Description field; an invalid expression says why; Replace All
 * with `\-` replaces as with `-`, the replacement's groups working as before.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle } from './fixtures/core';
import { MOD } from './fixtures/keys';

interface SourceHooks {
  sourceSelection(): { anchor: number; head: number } | null;
  sourceText(): string | null;
}
declare const window: {
  __mfbeTest?: { sourceMapping?: SourceHooks; scripts?: { toXml(): Promise<string> } };
};
declare const document: {
  activeElement: { value?: string; selectionStart?: number; selectionEnd?: number } | null;
};

/** The Body view's current match (its highlighted parts; the e2e tsconfig has no DOM lib). */
const MATCH_TEXT = `(() => [...document.querySelectorAll('[data-testid="body-editor"] .mfbe-search-match')]
  .map((part) => part.textContent).join(''))()`;

const BOOK = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info><genre>prose</genre><author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Alpha — Beta</book-title><lang>ru</lang></title-info>
<document-info><author><nickname>maker</nickname></author><date>2026</date><id>regex-1</id><version>1.0</version></document-info>
</description>
<body>
<section><title><p>Escapes</p></title>
<p>Версия 1.0 — создание, он сказал «да» и a-b "цитата": 3.5 и 7.2.</p>
</section>
</body>
</FictionBook>
`;

async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
}

async function find(page: Page, query: string): Promise<void> {
  if (!(await page.getByTestId('dialog-find').isVisible())) {
    await page.keyboard.press(`${MOD}+f`);
    await expect(page.getByTestId('dialog-find')).toBeVisible();
  }
  await page.getByTestId('dialog-find-query').fill(query);
  await page.getByTestId('dialog-find-regex').check();
  await page.getByTestId('dialog-find-button-findNext').click();
}

test.describe('US3 (feature 011) - escapes in regular expressions', () => {
  let dir: string;
  let file: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-011-us3-'));
    file = path.join(dir, 'escapes.fb2');
    writeFileSync(file, BOOK, 'utf8');
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    await openBook(core, page, file);
  });

  test('1. the Body view finds \\s\\—, \\«…\\» and \\- as the characters themselves', async ({
    page,
  }) => {
    await page.getByTestId('body-editor').getByText('Версия').click();
    for (const [query, found] of [
      ['\\s\\—', ' —'],
      ['\\«[^\\»]+\\»', '«да»'],
      ['a\\-b', 'a-b'],
      ['\\"\\S+\\"\\:', '"цитата":'],
    ] as const) {
      await find(page, query);
      await expect(page.getByTestId('dialog-search-message')).toHaveCount(0);
      await expect.poll(() => page.evaluate<string>(MATCH_TEXT)).toBe(found);
    }
  });

  test('1. the Source view and a Description field find them too', async ({ page }) => {
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-editor')).toBeVisible();
    await find(page, '\\s\\—');
    await expect(page.getByTestId('dialog-search-message')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const hooks = window.__mfbeTest?.sourceMapping;
          const selection = hooks?.sourceSelection();
          const text = hooks?.sourceText();
          if (!selection || !text) return '';
          return text.slice(
            Math.min(selection.anchor, selection.head),
            Math.max(selection.anchor, selection.head),
          );
        }),
      )
      .toBe(' —');
    await page.getByTestId('dialog-find-button-cancel').click();
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('description-view')).toBeVisible();
    await page.getByTestId('description-book-title').click();
    await find(page, '\\s\\—\\s');
    await expect(page.getByTestId('dialog-search-message')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const field = document.activeElement;
          return field?.value?.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0) ?? '';
        }),
      )
      .toBe(' — ');
  });

  test('3. an invalid expression says why; "Cannot find the string" does not appear', async ({
    page,
  }) => {
    await page.getByTestId('body-editor').getByText('Версия').click();
    await find(page, '(abc');
    const message = page.getByTestId('dialog-search-message');
    await expect(message).toContainText('Not a valid regular expression:');
    await expect(message).not.toContainText('Cannot find');
    await page.getByTestId('dialog-search-message-button-ok').click();
  });

  test('4. Replace All with \\- replaces as with -, the groups of the replacement work', async ({
    page,
  }) => {
    await page.getByTestId('body-editor').getByText('Версия').click();
    await page.keyboard.press(`${MOD}+h`);
    await expect(page.getByTestId('dialog-replace')).toBeVisible();
    await page.getByTestId('dialog-replace-query').fill('a\\-b');
    await page.getByTestId('dialog-replace-regex').check();
    await page.getByTestId('dialog-replace-with').fill('A–B');
    await page.getByTestId('dialog-replace-button-replaceAll').click();
    await page.getByTestId('dialog-replace-all-done-button-ok').click();
    await page.getByTestId('dialog-replace-query').fill('(\\d)\\.(\\d)');
    await page.getByTestId('dialog-replace-with').fill('$2,$1');
    await page.getByTestId('dialog-replace-button-replaceAll').click();
    await page.getByTestId('dialog-replace-all-done-button-ok').click();
    const xml = await page.evaluate(() => window.__mfbeTest!.scripts!.toXml());
    expect(xml).toContain('A–B');
    expect(xml).toContain('0,1 — создание');
    expect(xml).toContain('5,3 и 2,7');
  });
});
