/**
 * US6 (feature 002) - non-breaking spaces are shown as in the original (FR-040 to FR-044):
 * no marker by default; the original's choices □ ▫ ◦; each marker drawn over its own space in
 * indented paragraphs, verses, epigraphs and titles (on 0.0.1 the marker inherited the
 * paragraph's 3em first-line indent and was drawn over the following text); the marker behaves
 * as the character (Backspace, insertion, copy, paste, a search for the marker or U+00A0); the
 * Source view shows it; a change of the setting applies at once; the saved file holds U+00A0
 * and the book's own □ ▫ ◦ unchanged; the degree sign stored by 0.0.1 reads as the plain
 * space. Book: tests/fixtures/books/nbsp-layout.fb2.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import {
  expect,
  fixtureBook,
  startCoreWith,
  test,
  waitForBook,
  type CoreHandle,
} from './fixtures/core';
import { MOD } from './fixtures/keys';

const NBSP = ' ';
const MARKERS = ['□', '▫', '◦'];
const BOOK = fixtureBook('nbsp-layout.fb2');
const BOOK_NBSP_COUNT = readFileSync(BOOK, 'utf8').split(NBSP).length - 1;

/* The e2e tsconfig has no DOM lib: browser-side probes are string snippets. */

interface MarkerInfo {
  kind: string;
  indent: string;
  position: string;
  left: string;
  right: string;
  top: string;
  content: string;
  /** The span holding the space is the box the marker is placed in. */
  spanPosition: string;
  /** The space has a box of its own and the point at its centre belongs to it. */
  onItsSpace: boolean;
}

const MARKER_PROBE = `(() => [...document.querySelectorAll('[data-testid="body-editor"] .fb-nbsp')].map((el) => {
  const before = getComputedStyle(el, '::before');
  const block = el.closest('.fb-title, .fb-epigraph, .fb-v, .fb-p');
  const kind = !block ? 'other' : block.classList.contains('fb-title') || block.closest('.fb-title') ? 'title'
    : block.closest('.fb-epigraph') ? 'epigraph' : block.classList.contains('fb-v') ? 'verse' : 'paragraph';
  el.scrollIntoView({ block: 'center' });
  const box = el.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return { kind, indent: before.textIndent, position: before.position, left: before.left,
           right: before.right, top: before.top, content: before.content,
           spanPosition: getComputedStyle(el).position,
           onItsSpace: box.width > 0 && !!hit && el.contains(hit) };
}))()`;

/** Text (with U+00A0) of the first Body paragraph containing `fragment`. */
function paragraphText(page: Page, fragment: string): Promise<string> {
  return page.evaluate<string>(`(() => {
    const p = [...document.querySelectorAll('[data-testid="body-editor"] p')]
      .find((el) => el.textContent.includes(${JSON.stringify(fragment)}));
    return p ? p.textContent : '';
  })()`);
}

function bodyText(page: Page): Promise<string> {
  return page.evaluate<string>(`document.querySelector('[data-testid="body-editor"]').textContent`);
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

async function setMarker(core: CoreHandle, char: string): Promise<void> {
  await core.rpc('settings.set', { patch: { other: { nbspDisplayChar: char } } });
}

/** Clicks the Body paragraph containing `fragment` and moves the caret `chars` from its start. */
async function caretAt(page: Page, fragment: string, chars: number): Promise<void> {
  await page.getByTestId('body-editor').locator('p', { hasText: fragment }).click();
  await page.keyboard.press('Home');
  for (let i = 0; i < chars; i++) await page.keyboard.press('ArrowRight');
  await settle(page);
  // The editor reads a keyboard-moved caret back from the DOM asynchronously; on a slow runner
  // a burst of arrow presses can land it short of the count (seen once on CI: the caret stayed
  // three characters before the two spaces and Backspace took a letter instead). Read the
  // offset the editor holds and press the difference until it matches.
  for (let round = 0; round < 6; round += 1) {
    const offset = await page.evaluate<number>(
      `(window.__mfbeTest.sourceMapping.bodySelection() || { head: { offset: -1 } }).head.offset`,
    );
    if (offset === chars) return;
    if (offset >= 0) {
      const key = offset < chars ? 'ArrowRight' : 'ArrowLeft';
      for (let i = 0; i < Math.abs(chars - offset); i++) await page.keyboard.press(key);
    }
    await settle(page);
  }
  expect(
    await page.evaluate<number>(`window.__mfbeTest.sourceMapping.bodySelection().head.offset`),
    `caret at ${chars} in "${fragment}"`,
  ).toBe(chars);
}

/** Lets the editor pick up a caret moved with the keyboard. */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(80);
}

test.describe('US6 - non-breaking spaces are shown as in the original', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });
  test.afterEach(async ({ core }) => {
    if (core.hasCore) {
      await core
        .rpc('settings.set', { patch: { other: { nbspDisplayChar: null } } })
        .catch(() => {});
    }
  });

  test('1. by default no marker is shown, in the Body and the Source view', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await expect(page.getByTestId('body-editor').locator('p').first()).toBeVisible();
    await expect(page.locator('[data-testid="body-editor"] .fb-nbsp')).toHaveCount(0);
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-editor')).toContainText('Неразрывные');
    await expect(page.locator('.cm-nbspMarker')).toHaveCount(0);
  });

  test('2. each marker is drawn over its own space in every kind of paragraph, at once', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    for (const marker of MARKERS) {
      await setMarker(core, marker);
      await expect
        .poll(async () => (await page.evaluate<MarkerInfo[]>(MARKER_PROBE)).length)
        .toBeGreaterThan(10);
      const markers = await page.evaluate<MarkerInfo[]>(MARKER_PROBE);
      expect(new Set(markers.map((m) => m.kind))).toEqual(
        new Set(['title', 'epigraph', 'verse', 'paragraph']),
      );
      for (const m of markers) {
        expect(m.indent, `${m.kind} marker indent`).toBe('0px');
        expect(m.spanPosition).toBe('relative');
        expect([m.position, m.left, m.right, m.top]).toEqual(['absolute', '0px', '0px', '0px']);
        expect(m.onItsSpace, `${m.kind} marker over its own space`).toBe(true);
        expect(m.content).toBe(`"${marker}"`);
      }
    }
    // The annotation and history fields show the marker; single-line fields keep the space.
    await page.getByTestId('view-description').click();
    await expect(
      page.locator('[data-testid="description-annotation"] .fb-nbsp').first(),
    ).toBeVisible();
    const title = await page.getByTestId('description-book-title').inputValue();
    expect(title).toBe(`Неразрывные${NBSP}пробелы`);
  });

  test('3. the marker behaves as the character: delete, insert, copy, paste', async ({
    core,
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openBook(core, page);
    await setMarker(core, MARKERS[0]!);
    await expect(page.locator('[data-testid="body-editor"] .fb-nbsp').first()).toBeVisible();

    // Backspace after the second of two non-breaking spaces removes exactly one.
    await caretAt(page, 'Два подряд', `Два подряд:${NBSP}${NBSP}`.length);
    await page.keyboard.press('Backspace');
    await expect.poll(() => paragraphText(page, 'Два подряд')).toBe(`Два подряд:${NBSP}вот они.`);

    // An inserted non-breaking space is shown as the marker.
    await page.keyboard.press(`${MOD}+Shift+Space`);
    await expect
      .poll(() => paragraphText(page, 'Два подряд'))
      .toBe(`Два подряд:${NBSP}${NBSP}вот они.`);
    await expect(
      page.getByTestId('body-editor').locator('p', { hasText: 'Два подряд' }).locator('.fb-nbsp'),
    ).toHaveCount(2);

    // Copy carries the marker character, as in the original.
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await settle(page);
    await page.keyboard.press(`${MOD}+C`);
    const copied = await page.evaluate<string>('navigator.clipboard.readText()');
    expect(copied).toContain(`:${MARKERS[0]}${MARKERS[0]}вот`);
    expect(copied).not.toContain(NBSP);

    // Pasted non-breaking spaces and marker characters become non-breaking spaces.
    await caretAt(page, 'В конце абзаца', 'В конце'.length);
    await page.evaluate(`navigator.clipboard.writeText('X${NBSP}Y${MARKERS[0]}Z')`);
    await page.keyboard.press(`${MOD}+V`);
    // The paste lands when the browser has read the clipboard - asynchronously after the key
    // (a one-shot read right after the press came too early on the macOS runner).
    await expect.poll(() => paragraphText(page, 'В конце')).toContain(`В концеX${NBSP}Y${NBSP}Z`);
  });

  for (const [name, query] of [
    ['the marker character', MARKERS[0]!],
    ['U+00A0', NBSP],
  ] as const) {
    test(`4. a search for ${name} finds the non-breaking spaces, not the book's own □`, async ({
      core,
      page,
    }) => {
      await openBook(core, page);
      await setMarker(core, MARKERS[0]!);
      await expect(page.locator('[data-testid="body-editor"] .fb-nbsp').first()).toBeVisible();
      const before = await bodyText(page);
      await page.getByTestId('menu-edit').click();
      await page.getByTestId('menu-edit-replace').click();
      await page.getByTestId('dialog-replace-query').fill(query);
      await page.getByTestId('dialog-replace-with').fill('_');
      await page.getByTestId('dialog-replace-button-replaceAll').click();
      await expect(page.getByTestId('dialog-replace-all-done')).toBeVisible();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
      const after = await bodyText(page);
      expect(count(after, NBSP)).toBe(0);
      expect(count(after, '_') - count(before, '_')).toBe(count(before, NBSP));
      expect(after).toContain('Настоящие символы: □ квадрат, ▫ малый квадрат, ◦ кружок.');
    });
  }

  test('5. the Source view shows the marker; the saved file holds U+00A0 and the real □ ▫ ◦', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await setMarker(core, MARKERS[2]!);
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-editor')).toContainText('Неразрывные');
    await expect(page.locator('.cm-nbspMarker').first()).toBeVisible();
    await expect(page.locator('.cm-nbspMarker').first()).toHaveText(MARKERS[2]!);

    const dir = await mkdtemp(path.join(tmpdir(), 'mfbe-us6-'));
    try {
      const out = path.join(dir, 'saved.fb2');
      await page.getByTestId('view-body').click();
      await core.enqueueDialog('dialog.saveFile', { path: out, encoding: 'utf-8' });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-saveAs').click();
      await expect(page.getByTestId('status-message')).toHaveText(
        'Document saved - No errors found.',
      );
      const saved = readFileSync(out, 'utf8');
      expect(count(saved, NBSP)).toBe(BOOK_NBSP_COUNT);
      expect(saved).toContain('name="Серия □ ▫ ◦"');
      expect(saved).toContain('Настоящие символы: □ квадрат, ▫ малый квадрат, ◦ кружок.');
      expect(count(saved, MARKERS[2]!)).toBe(count(readFileSync(BOOK, 'utf8'), MARKERS[2]!));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('6. Settings offers the original choices; the old degree sign is not one of them', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-settings').click();
    await page.getByTestId('settings-tab-other').click();
    const values = await page.evaluate<string[]>(
      `[...document.querySelector('[data-testid="settings-other-nbsp"]').options].map((o) => o.value)`,
    );
    expect(values).toEqual([...MARKERS, NBSP]);
    await expect(page.getByTestId('settings-other-nbsp')).toHaveValue(NBSP);
    await expect(
      core.rpc('settings.set', { patch: { other: { nbspDisplayChar: '°' } } }),
    ).rejects.toThrow(/1040|settings\.invalid/);
  });

  test('7. a degree sign stored by release 0.0.1 reads as the plain space', async ({ browser }) => {
    const binary = process.env.MFBE_CORE_BIN!;
    test.skip(!/mfbe-core/.test(path.basename(binary)), 'needs the real mfbe-core binary');
    const dataDir = await mkdtemp(path.join(tmpdir(), 'mfbe-us6-settings-'));
    writeFileSync(
      path.join(dataDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, other: { nbspDisplayChar: '°' } }),
    );
    const second = await startCoreWith(binary, dataDir, ['--open', BOOK]);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(second.url);
      await expect(page.getByTestId('body-editor')).toContainText('Два подряд');
      await expect(page.locator('[data-testid="body-editor"] .fb-nbsp')).toHaveCount(0);
      await page.getByTestId('menu-tools').click();
      await page.getByTestId('menu-tools-settings').click();
      await page.getByTestId('settings-tab-other').click();
      await expect(page.getByTestId('settings-other-nbsp')).toHaveValue(NBSP);
    } finally {
      await context.close();
      await second.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
