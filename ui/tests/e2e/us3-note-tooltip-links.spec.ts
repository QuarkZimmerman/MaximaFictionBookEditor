/**
 * Feature 009, user story 3 - the note tooltip and Ctrl+click on links (T048; FR-030 to FR-039,
 * data-model §6 and §7, research DP-11, DP-12).
 *
 * Resting the pointer on a note mark shows the note's text after about half a second; leaving,
 * Esc and a click hide it, and a missing note says so. Ctrl (Cmd) + click on a note mark jumps
 * to the note, and *Go to footnote or reference* returns to that very mark - the second of two,
 * not the first. A web address goes to the system's browser (the `app.openUrl` stand-in), any
 * other scheme gets a message; a plain click only places the caret. The Description view's
 * fields show no tooltip. Needs the real core (MFBE_CORE_BIN).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { MAC, MOD } from './fixtures/keys';

const MODIFIER = MAC ? 'Meta' : 'Control';
const GENERATOR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/gen-large-book.py',
);
/** Budgets of FR-032, SC-007 and SC-008, with the journeys' usual allowance. */
const PERF_FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 2) || 2;
const BUDGET_MS = 1000;
let dir = '';

test.beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us3-links-'));
});

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A real picture for the linked-picture case (the fixture images' opaque PNG). */
const PICTURE = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../tests/fixtures/images/opaque-rgb.png',
  ),
).toString('base64');

/** A small book with two references to one note, a missing note, a web and a mail link. */
function linksBook(): string {
  const file = path.join(dir, 'links.fb2');
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose_classic</genre><author><first-name>Test</first-name><last-name>Author</last-name></author><book-title>Links</book-title><annotation><p>See <a l:href="#n_1" type="note">[a]</a>.</p></annotation><lang>en</lang></title-info><document-info><author><nickname>t</nickname></author><date>2026</date><id>us3-links</id><version>1.0</version></document-info></description>
<body><section><p>First mark<a l:href="#n_1" type="note">[1]</a> here.</p><p>Second mark<a l:href="#n_1" type="note">[1]</a> there.</p><p>Gone<a l:href="#n_9" type="note">[9]</a>.</p><p>A <a l:href="https://example.org/page">web link</a> and a <a l:href="mailto:someone@example.org">mail link</a>.</p><p>Picture<a l:href="#n_1" type="note"><image l:href="#dot"/></a> mark.</p></section></body>
<body name="notes"><section id="n_1"><title><p>1</p></title><p>The note's first line.</p><p>Its second line.</p></section></body>
<binary id="dot" content-type="image/png">${PICTURE}</binary>
</FictionBook>
`,
  );
  return file;
}

async function open(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await page.getByTestId('view-body').click();
  await expect(page.locator('[data-testid="body-editor"] a.fb-link').first()).toBeVisible();
}

/** The text of the paragraph holding the caret (evaluated in the page). */
const CARET_PARAGRAPH = `(() => {
  const node = document.getSelection() ? document.getSelection().anchorNode : null;
  const element = node && (node.nodeType === 1 ? node : node.parentElement);
  const paragraph = element ? element.closest('p') : null;
  return paragraph ? paragraph.textContent : '';
})()`;

function caretParagraph(page: Page): Promise<string> {
  return page.evaluate<string>(CARET_PARAGRAPH);
}

/** The note mark of the Body paragraph holding `text` (the view shows the annotation too). */
function markIn(page: Page, text: string) {
  return page.locator('[data-testid="body-editor"] p', { hasText: text }).locator('a.fb-note');
}

test.describe('US3 (feature 009) - note tooltip and Ctrl+click on links', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('1-4. resting on a note mark shows the note; leaving, Esc and a click hide it', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await open(core, page, fixtureBook('notes-6.fb2'));
    const mark = page.locator('[data-testid="body-editor"] a.fb-note').first();
    const tip = page.getByTestId('note-tooltip');
    await mark.hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText(
      '\u042d\u043b\u0438\u0442 \u044d\u0438\u0443\u0441\u043c\u043e\u0434 \u0443\u0442 \u0434\u043e\u043b\u043e\u0440\u0435 \u043b\u043e\u0440\u0435\u043c \u0441\u0438\u0442 \u0430\u0434\u0438\u043f\u0438\u0441\u0446\u0438\u043d\u0433 \u0434\u043e.',
    );
    await page.mouse.move(2, 2);
    await expect(tip).toBeHidden();
    await mark.hover();
    await expect(tip).toBeVisible();
    // At most 60 characters wide and 15 lines high (FR-031).
    await expect(tip).toHaveCSS('-webkit-line-clamp', '15');
    await expect(tip).toHaveCSS('max-width', /px$/);
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await page.mouse.move(2, 2);
    await mark.hover();
    await expect(tip).toBeVisible();
    await page.mouse.down();
    await expect(tip).toBeHidden();
    await page.mouse.up();
  });

  test('5. a note that is not in the book says so; the text has its lines', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await open(core, page, linksBook());
    const tip = page.getByTestId('note-tooltip');
    await markIn(page, 'Gone').hover();
    await expect(tip).toHaveText('Note not found');
    await page.mouse.move(2, 2);
    await markIn(page, 'First mark').hover();
    await expect(tip).toHaveText("The note's first line.\nIts second line.");
  });

  test('6-8. Ctrl+click jumps to the note; Go to footnote or reference returns to that very mark', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await open(core, page, linksBook());
    // A plain click only places the caret.
    await markIn(page, 'Second mark').click();
    await expect.poll(() => caretParagraph(page)).toContain('Second mark');
    await markIn(page, 'Second mark').click({ modifiers: [MODIFIER] });
    await expect.poll(() => caretParagraph(page)).toContain("The note's first line.");
    await page.keyboard.press(`${MOD}+Backspace`);
    await expect.poll(() => caretParagraph(page)).toContain('Second mark');
  });

  test('11. a picture inside a note link works the same', async ({ core, page }) => {
    await core.openApp(page);
    await open(core, page, linksBook());
    const picture = markIn(page, 'Picture').locator('[data-testid="body-inline-image"]');
    await picture.hover();
    await expect(page.getByTestId('note-tooltip')).toHaveText(
      "The note's first line.\nIts second line.",
    );
    await picture.click({ modifiers: [MODIFIER] });
    await expect.poll(() => caretParagraph(page)).toContain("The note's first line.");
  });

  test('9, 10. a web address opens in the browser; another scheme gets a message', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await open(core, page, linksBook());
    const before = (await core.rpc<string[]>('test.openedUrls')).length;
    await page.locator('a.fb-link', { hasText: 'web link' }).click({ modifiers: [MODIFIER] });
    await expect
      .poll(async () => (await core.rpc<string[]>('test.openedUrls')).slice(before))
      .toEqual(['https://example.org/page']);
    await page.locator('a.fb-link', { hasText: 'mail link' }).click({ modifiers: [MODIFIER] });
    await expect(page.getByTestId('dialog-unsupported-address')).toContainText(
      'mailto:someone@example.org',
    );
  });

  test('FR-039. the Description view shows no note tooltip', async ({ core, page }) => {
    await core.openApp(page);
    await open(core, page, linksBook());
    await page.getByTestId('view-description').click();
    const link = page
      .locator('[data-testid="view-description-panel"] a', { hasText: '[a]' })
      .first();
    if ((await link.count()) > 0) await link.hover();
    await page.waitForTimeout(900);
    await expect(page.getByTestId('note-tooltip')).toBeHidden();
  });
});

test.describe('US3 (feature 009) - a 10 MB book', () => {
  test(
    'FR-032, SC-007, SC-008: the tooltip of a note at the far end within 1 s; the jump and the way back under 1 s each',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
      const book = path.join(dir, 'large-notes.fb2');
      const made = spawnSync('python3', [GENERATOR, '--out', book, '--size-mb', '10'], {
        encoding: 'utf8',
      });
      test.skip(made.status !== 0, 'python3 / the generator are not available');
      // A note mark in the first paragraph, its note in a notes body at the very end.
      let text = readFileSync(book, 'utf8');
      const section = text.indexOf('<section');
      const paragraph = text.indexOf('<p>', text.indexOf('</title>', section));
      text = `${text.slice(0, paragraph + 3)}<a l:href="#far_note" type="note">[far]</a> ${text.slice(paragraph + 3)}`;
      const notes =
        '<body name="notes"><section id="far_note"><title><p>far</p></title><p>The far note.</p></section></body>';
      const end =
        text.indexOf('<binary') >= 0 ? text.indexOf('<binary') : text.lastIndexOf('</FictionBook>');
      writeFileSync(book, `${text.slice(0, end)}${notes}${text.slice(end)}`);

      await core.openApp(page);
      await core.enqueueDialog('dialog.openFile', { paths: [book] });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-open').click();
      await waitForBook(page, book, 30_000);
      await page.getByTestId('view-body').click();
      const mark = page.locator('[data-testid="body-editor"] a.fb-note', { hasText: '[far]' });
      await expect(mark).toBeVisible({ timeout: 30_000 });

      const tip = page.getByTestId('note-tooltip');
      let started = Date.now();
      await mark.hover();
      await expect(tip).toHaveText('The far note.');
      const tooltipMs = Date.now() - started;
      started = Date.now();
      await mark.click({ modifiers: [MODIFIER] });
      await expect.poll(() => caretParagraph(page), { intervals: [20] }).toContain('The far note.');
      const jumpMs = Date.now() - started;
      started = Date.now();
      await page.keyboard.press(`${MOD}+Backspace`);
      await expect.poll(() => caretParagraph(page), { intervals: [20] }).toContain('[far]');
      const backMs = Date.now() - started;
      test.info().annotations.push({
        type: 'perf',
        description: `tooltip ${tooltipMs} ms, jump ${jumpMs} ms, back ${backMs} ms`,
      });
      expect(tooltipMs, 'the tooltip (its 500 ms rest included)').toBeLessThan(
        BUDGET_MS * PERF_FACTOR,
      );
      expect(jumpMs, 'the Ctrl+click jump').toBeLessThan(BUDGET_MS * PERF_FACTOR);
      expect(backMs, 'the way back').toBeLessThan(BUDGET_MS * PERF_FACTOR);
    },
  );
});
