/**
 * Feature 009, user story 4 - Paste as plain text (T055; FR-040 to FR-045, D20, research DP-13).
 *
 * A rich clipboard item - formatted text with a link, a picture and a table - pasted with
 * Mod+Shift+V gives plain paragraphs in the Body view and in the annotation, removed by one Undo;
 * the Edit menu and the Body's context menu offer the command right after Paste; the Source view
 * and a plain field take the text as Paste does; with no text on the clipboard nothing changes and
 * the status bar says so; the Hotkeys page lists the key and lets it be changed. Needs the real
 * core (MFBE_CORE_BIN).
 */

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { label, MAC, MOD } from './fixtures/keys';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const RICH_HTML =
  '<p>Rich <b>bold</b> and <a href="https://example.org/">a link</a></p>' +
  `<p><img src="data:image/png;base64,${PNG}"></p>` +
  '<table><tr><td>Cell one</td><td>Cell two</td></tr></table>';
const RICH_TEXT = 'Rich bold and a link\nCell one';

/** Puts items on the clipboard in the page (the e2e tsconfig has no DOM lib, hence a string). */
function clipboardScript(items: { html?: string; text?: string; png?: boolean }): string {
  return `(async () => {
    const parts = {};
    ${items.html !== undefined ? `parts['text/html'] = new Blob([${JSON.stringify(items.html)}], { type: 'text/html' });` : ''}
    ${items.text !== undefined ? `parts['text/plain'] = new Blob([${JSON.stringify(items.text)}], { type: 'text/plain' });` : ''}
    ${
      items.png
        ? `parts['image/png'] = new Blob([Uint8Array.from(atob('${PNG}'), (c) => c.charCodeAt(0))], { type: 'image/png' });`
        : ''
    }
    await navigator.clipboard.write([new ClipboardItem(parts)]);
    return true;
  })()`;
}

async function putOnClipboard(
  page: Page,
  items: { html?: string; text?: string; png?: boolean },
): Promise<void> {
  await page.evaluate<boolean>(clipboardScript(items));
}

async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await page.getByTestId('view-body').click();
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

/** The caret at the end of the Body paragraph holding `text`. */
async function caretAfter(page: Page, text: string): Promise<void> {
  await page.locator('[data-testid="body-editor"] p.fb-p', { hasText: text }).first().click();
  await page.keyboard.press(MAC ? 'Meta+ArrowRight' : 'End');
}

test.describe('US4 (feature 009) - Paste as plain text', () => {
  test.beforeEach(async ({ core, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('1, 2. Mod+Shift+V in the Body view pastes plain paragraphs, removed by one Undo', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openBook(core, page, fixtureBook('notes-6.fb2'));
    const editor = page.getByTestId('body-editor');
    const links = await editor.locator('a.fb-link').count();
    const pictures = await editor.locator('img').count();
    await caretAfter(page, 'Сед темпор');
    await putOnClipboard(page, { html: RICH_HTML, text: RICH_TEXT });
    await page.keyboard.press(`${MOD}+Shift+V`);
    const pasted = editor.locator('p.fb-p', { hasText: 'Rich bold and a link' });
    await expect(pasted).toHaveCount(1);
    await expect(editor.locator('p.fb-p', { hasText: 'Cell one' })).toHaveCount(1);
    await expect(pasted.locator('a, strong, b, img')).toHaveCount(0);
    expect(await editor.locator('a.fb-link').count()).toBe(links);
    expect(await editor.locator('img').count()).toBe(pictures);
    await expect(editor.locator('.fb-table')).toHaveCount(0);
    // One Undo removes all of it.
    await page.keyboard.press(`${MOD}+z`);
    await expect(editor.locator('p.fb-p', { hasText: 'Rich bold' })).toHaveCount(0);
    await expect(editor.locator('p.fb-p', { hasText: 'Cell one' })).toHaveCount(0);
  });

  test('3. the Edit menu and the context menu offer it right after Paste', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openBook(core, page, fixtureBook('notes-6.fb2'));
    await caretAfter(page, 'Сед темпор');
    await page.getByTestId('menu-edit').click();
    const items = await page
      .locator('[data-testid^="menu-edit-"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
    expect(items.indexOf('menu-edit-pastePlain')).toBe(items.indexOf('menu-edit-paste') + 1);
    await page.keyboard.press('Escape');
    await page
      .locator('[data-testid="body-editor"] p.fb-p', { hasText: 'Сед темпор' })
      .first()
      .click({ button: 'right' });
    const entries = await page
      .locator('[data-testid^="context-menu-edit."]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
    expect(entries.indexOf('context-menu-edit.pastePlain')).toBe(
      entries.indexOf('context-menu-edit.paste') + 1,
    );
    await page.keyboard.press('Escape');
  });

  test('4, 5. the annotation takes paragraphs; the Source view and a plain field take the text', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openBook(core, page, fixtureBook('modern-utf8.fb2'));
    await putOnClipboard(page, { html: RICH_HTML, text: RICH_TEXT });

    // The annotation (a rich field of the Description view): plain paragraphs, no link.
    await page.getByTestId('view-description').click();
    const annotation = page.getByTestId('description-annotation');
    await annotation.locator('p').last().click();
    await page.keyboard.press(MAC ? 'Meta+ArrowRight' : 'End');
    await page.keyboard.press(`${MOD}+Shift+V`);
    await expect(annotation).toContainText('Rich bold and a link');
    await expect(annotation.locator('a')).toHaveCount(0);

    // A plain field: the text as typed.
    await putOnClipboard(page, { text: 'Plain title' });
    const title = page.getByTestId('description-book-title');
    await title.click();
    await title.selectText();
    await page.keyboard.press(`${MOD}+Shift+V`);
    await expect(title).toHaveValue('Plain title');

    // The Source view: the text as Paste puts it.
    await putOnClipboard(page, { html: RICH_HTML, text: 'Source words' });
    await page.getByTestId('view-source').click();
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press(`${MOD}+Shift+V`);
    await expect(content).toContainText('Source words');
  });

  test('6. with no text on the clipboard nothing changes and the status bar says so', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openBook(core, page, fixtureBook('notes-6.fb2'));
    const editor = page.getByTestId('body-editor');
    await caretAfter(page, 'Сед темпор');
    const before = await editor.innerText();
    await putOnClipboard(page, { png: true });
    await page.keyboard.press(`${MOD}+Shift+V`);
    await expect(page.getByTestId('status-message')).toHaveText('The Clipboard holds no text.');
    expect(await editor.innerText()).toBe(before);
  });

  test('7. the Hotkeys page lists the key, and another key can take its place', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openBook(core, page, fixtureBook('notes-6.fb2'));
    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-settings').click();
    await page.getByTestId('settings-tab-hotkeys').click();
    await page.getByTestId('settings-hotkeys-group-edit').click();
    await page.getByTestId('settings-hotkeys-command-edit.pastePlain').click();
    await expect(page.getByTestId('settings-hotkeys-current')).toContainText(label('Mod+Shift+V'));
    const capture = page.getByTestId('settings-hotkeys-capture');
    await capture.focus();
    await page.keyboard.press('Alt+Shift+V');
    await page.getByTestId('settings-hotkeys-assign').click();
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);

    await caretAfter(page, 'Сед темпор');
    await putOnClipboard(page, { text: 'Reassigned key' });
    await page.keyboard.press('Alt+Shift+V');
    await expect(
      page.locator('[data-testid="body-editor"] p.fb-p', { hasText: 'Reassigned key' }),
    ).toHaveCount(1);
  });
});
