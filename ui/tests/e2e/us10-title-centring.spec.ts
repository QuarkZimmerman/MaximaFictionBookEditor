/**
 * Feature 004, User Story 10 - Titles and subtitles are centred (T076; spec FR-060, FR-061,
 * SC-010; research R1.3).
 *
 * A book with every kind of title paragraph - the body's title, a two-paragraph section title,
 * a poem title, a poem title inside a cite and inside an epigraph - a section subtitle, a
 * subtitle inside the annotation block, a stanza with a one-line verse and a verse long enough
 * to wrap, a text-author, an epigraph paragraph and ordinary paragraphs, rendered in a wide
 * view. The alignment is read as actually rendered (FR-061), not from the stylesheet's text:
 *
 *  - a title paragraph or subtitle (each shorter than one line) has `text-align: center` and
 *    the box of its text (`range.selectNodeContents(p).getBoundingClientRect()`) is centred
 *    within the paragraph's content box within 1 px - a justified single line is left-aligned,
 *    and today's 3 em indent moves it off centre, so the geometry tells the defect apart;
 *  - a stanza line has `text-align: left`, no bottom margin and, when it wraps, a first line
 *    whose text box ends short of the content box's right edge (ragged, where `justify`
 *    stretches it to the edge) - the stanza rule, defeated by the same cascade defect as the
 *    title rule, is raised with it (requester decision 2026-10-20);
 *  - the other kinds keep today's rendering, pinned so that the fix changes nothing else:
 *    text-author `right`, ordinary and epigraph paragraphs `justify`;
 *  - the same in the dark theme and after the body font and font size were changed in the
 *    settings (SC-010), and the Description view's rich annotation field centres its subtitle.
 *
 * Runs against the real core (`MFBE_CORE_BIN`); skipped in core-less mode.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle, type RpcCallError } from './fixtures/core';

/** A verse long enough to wrap at any body font in the widest view the runners have. */
const LONG_VERSE =
  'A verse long enough to wrap in the widest Body view the test runners have, because the ' +
  'ragged right edge of a left-aligned line can only be seen where the line breaks before the ' +
  'edge of its box, and a justified line is stretched to that edge instead - so these words go ' +
  'on and on, well past the width of the editor, to make the first line break for certain.';

const BOOK = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
\t<description>
\t\t<title-info>
\t\t\t<genre>poetry</genre>
\t\t\t<author><first-name>Centring</first-name><last-name>Fixture</last-name></author>
\t\t\t<book-title>Centred titles</book-title>
\t\t\t<annotation>
\t\t\t\t<p>An annotation paragraph above the book text.</p>
\t\t\t\t<subtitle>Annotation subtitle</subtitle>
\t\t\t</annotation>
\t\t\t<lang>en</lang>
\t\t</title-info>
\t\t<document-info>
\t\t\t<author><nickname>fixture</nickname></author>
\t\t\t<date value="2026-01-01">2026</date>
\t\t\t<id>centring-fixture</id>
\t\t\t<version>1.0</version>
\t\t</document-info>
\t</description>
\t<body>
\t\t<title><p>Body title</p></title>
\t\t<epigraph>
\t\t\t<p>An epigraph paragraph, justified as today, long enough to be sure of it even in a wide view of the editor.</p>
\t\t\t<poem id="epigraph-poem">
\t\t\t\t<title><p>Poem title in the epigraph</p></title>
\t\t\t\t<stanza><v>A verse of the epigraph poem</v></stanza>
\t\t\t</poem>
\t\t\t<text-author>Epigraph author</text-author>
\t\t</epigraph>
\t\t<section id="s1">
\t\t\t<title><p>Chapter one</p><p>Second title line</p></title>
\t\t\t<p>An ordinary paragraph of the section, justified as today and indented by three ems, long enough to fill more than one line of the widest view.</p>
\t\t\t<subtitle>Section subtitle</subtitle>
\t\t\t<poem id="poem">
\t\t\t\t<title><p>Poem title</p></title>
\t\t\t\t<stanza>
\t\t\t\t\t<v>Short verse</v>
\t\t\t\t\t<v>${LONG_VERSE}</v>
\t\t\t\t</stanza>
\t\t\t\t<text-author>Poem author</text-author>
\t\t\t</poem>
\t\t\t<cite id="cite">
\t\t\t\t<p>A quoted paragraph.</p>
\t\t\t\t<poem id="cite-poem">
\t\t\t\t\t<title><p>Poem title in a cite</p></title>
\t\t\t\t\t<stanza><v>A verse of the cited poem</v></stanza>
\t\t\t\t</poem>
\t\t\t\t<text-author>Cite author</text-author>
\t\t\t</cite>
\t\t</section>
\t</body>
</FictionBook>
`;

/**
 * Paragraphs that must be centred (selector inside the Body editor, the number of matches). A
 * cite or an epigraph has no title of its own in FB2; the poem inside each has one.
 */
const CENTRED: Record<string, { selector: string; count: number }> = {
  'body title': { selector: '.fb-body > .fb-title > p', count: 1 },
  'section title (two paragraphs)': { selector: '.fb-section > .fb-title > p', count: 2 },
  'poem title': { selector: '.fb-section > .fb-poem > .fb-title > p', count: 1 },
  'poem title in a cite': { selector: '.fb-cite .fb-poem > .fb-title > p', count: 1 },
  'poem title in an epigraph': { selector: '.fb-epigraph .fb-poem > .fb-title > p', count: 1 },
  'section subtitle': { selector: '.fb-section > p.fb-subtitle', count: 1 },
  'annotation block subtitle': {
    selector: '[data-testid="body-block-annotation"] > p.fb-subtitle',
    count: 1,
  },
};

/** Verses: left-aligned with their indent and no bottom margin. */
const VERSES = '.fb-stanza > p.fb-v';

/** Today's alignment of the other kinds, pinned (FR-060). */
const PINNED: Record<string, { selector: string; textAlign: string }> = {
  'text-author': { selector: 'p.fb-text-author', textAlign: 'right' },
  'ordinary paragraph': { selector: '.fb-section > p.fb-p', textAlign: 'justify' },
  'epigraph paragraph': { selector: '.fb-epigraph > p.fb-p', textAlign: 'justify' },
};

interface Measure {
  text: string;
  textAlign: string;
  textIndent: string;
  marginBottom: string;
  /** Centre of the rendered text and of the content box, in CSS pixels. */
  textCentre: number;
  boxCentre: number;
  /** Right edge of the first line's text and of the content box. */
  firstLineRight: number;
  contentRight: number;
  lines: number;
}

/**
 * Browser-side snippet (the e2e tsconfig has no DOM lib, hence a string): the rendered
 * geometry of every paragraph matching `selector` under `root` - the text box from a range over
 * the paragraph's contents against the paragraph's content box (its border box less padding).
 */
const MEASURE = `((rootSelector, selector) => {
  const root = document.querySelector(rootSelector);
  if (!root) return [];
  return [...root.querySelectorAll(selector)].map((p) => {
    const style = getComputedStyle(p);
    const box = p.getBoundingClientRect();
    const contentLeft = box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const contentRight = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    const range = document.createRange();
    range.selectNodeContents(p);
    const text = range.getBoundingClientRect();
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    const firstTop = rects.length ? Math.min(...rects.map((r) => r.top)) : 0;
    const firstLine = rects.filter((r) => Math.abs(r.top - firstTop) < 1);
    const tops = [...new Set(rects.map((r) => Math.round(r.top)))];
    return {
      text: (p.textContent || '').slice(0, 40),
      textAlign: style.textAlign,
      textIndent: style.textIndent,
      marginBottom: style.marginBottom,
      textCentre: (text.left + text.right) / 2,
      boxCentre: (contentLeft + contentRight) / 2,
      firstLineRight: firstLine.length ? Math.max(...firstLine.map((r) => r.right)) : text.right,
      contentRight,
      lines: tops.length,
    };
  });
})`;

async function measure(page: Page, rootSelector: string, selector: string): Promise<Measure[]> {
  return page.evaluate<Measure[]>(
    `${MEASURE}(${JSON.stringify(rootSelector)}, ${JSON.stringify(selector)})`,
  );
}

const BODY_ROOT = '[data-testid="body-editor"]';

/** FR-061: every paragraph of `selector` is rendered centred within 1 px (one line each). */
async function expectCentred(
  page: Page,
  what: string,
  selector: string,
  count: number,
  root = BODY_ROOT,
): Promise<void> {
  const measures = await measure(page, root, selector);
  expect(measures, `${what}: ${selector}`).toHaveLength(count);
  for (const m of measures) {
    const label = `${what} "${m.text}"`;
    expect(m.lines, `${label}: one line`).toBe(1);
    expect(m.textAlign, `${label}: text-align`).toBe('center');
    expect(m.textIndent, `${label}: text-indent`).toBe('0px');
    expect(
      Math.abs(m.textCentre - m.boxCentre),
      `${label}: centred within 1 px`,
    ).toBeLessThanOrEqual(1);
  }
}

/** The stanza lines: left with their indent, no bottom margin, ragged when they wrap. */
async function expectVerses(page: Page, what: string): Promise<void> {
  const verses = await measure(page, BODY_ROOT, VERSES);
  expect(verses, `${what}: verses`).toHaveLength(4);
  let wrapped = 0;
  for (const v of verses) {
    const label = `${what} verse "${v.text}"`;
    expect(v.textAlign, `${label}: text-align`).toBe('left');
    expect(v.marginBottom, `${label}: margin-bottom`).toBe('0px');
    expect(parseFloat(v.textIndent), `${label}: indent`).toBeGreaterThan(0);
    if (v.lines > 1) {
      wrapped += 1;
      // Ragged right edge: the first line ends short of the content box (justify would
      // stretch it to the edge).
      expect(v.contentRight - v.firstLineRight, `${label}: ragged first line`).toBeGreaterThan(2);
    }
  }
  expect(wrapped, `${what}: a verse long enough to wrap`).toBe(1);
}

/** Today's alignment of the other paragraph kinds (FR-060: unchanged by the fix). */
async function expectPinned(page: Page, what: string): Promise<void> {
  for (const [kind, { selector, textAlign }] of Object.entries(PINNED)) {
    const measures = await measure(page, BODY_ROOT, selector);
    expect(measures.length, `${what}: ${kind} present`).toBeGreaterThan(0);
    for (const m of measures) {
      expect(m.textAlign, `${what} ${kind} "${m.text}": text-align`).toBe(textAlign);
    }
  }
}

async function expectAllAligned(page: Page, what: string): Promise<void> {
  for (const [kind, { selector, count }] of Object.entries(CENTRED)) {
    await expectCentred(page, `${what}: ${kind}`, selector, count);
  }
  await expectVerses(page, what);
  await expectPinned(page, what);
}

async function supportsSettings(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('settings.get')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
  await expect(page.locator(`${BODY_ROOT} ${VERSES}`)).toHaveCount(4);
}

test.describe('US10 (004) - titles and subtitles are centred', () => {
  let dir: string;
  let book: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us10-'));
    book = path.join(dir, 'centring.fb2');
    writeFileSync(book, BOOK, 'utf8');
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsSettings(core)), 'the core does not implement settings.*');
    await core.rpc('settings.set', { patch: { view: null } });
  });

  test.afterEach(async ({ core }) => {
    if (core.hasCore) await core.rpc('settings.set', { patch: { view: null } }).catch(() => {});
  });

  test('1. every title paragraph and subtitle is rendered centred, every verse left-aligned; the other kinds as today', async ({
    core,
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await openBook(core, page, book);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expectAllAligned(page, 'light theme');
  });

  test('2. the same in the dark theme and with another body font and size', async ({
    core,
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await openBook(core, page, book);

    // The dark theme (Settings > View > Theme, applied through settings.changed).
    await core.rpc('settings.set', { patch: { view: { theme: 'dark' } } });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectAllAligned(page, 'dark theme');

    // Another body font and a larger size: the Body view follows the settings at once.
    const before = (await measure(page, BODY_ROOT, CENTRED['body title']!.selector))[0]!;
    await core.rpc('settings.set', {
      patch: { view: { bodyFont: 'serif', bodyFontSize: 22 } },
    });
    await expect
      .poll(async () =>
        page.evaluate<string>(
          `getComputedStyle(document.querySelector('${BODY_ROOT} p')).fontSize`,
        ),
      )
      .toBe('22px');
    const after = (await measure(page, BODY_ROOT, CENTRED['body title']!.selector))[0]!;
    expect(after.textCentre).not.toBe(before.textCentre); // the text box changed with the font
    await expectAllAligned(page, 'dark theme, serif 22 px');

    // A smaller size in the light theme again.
    await core.rpc('settings.set', {
      patch: { view: { theme: 'light', bodyFont: 'sans-serif', bodyFontSize: 11 } },
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect
      .poll(async () =>
        page.evaluate<string>(
          `getComputedStyle(document.querySelector('${BODY_ROOT} p')).fontSize`,
        ),
      )
      .toBe('11px');
    await expectAllAligned(page, 'light theme, sans-serif 11 px');
  });

  test('3. the Description view rich annotation field centres its subtitle', async ({
    core,
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openBook(core, page, book);
    await page.getByTestId('view-description').click();
    const field = page.getByTestId('description-annotation');
    await expect(field).toBeVisible();
    await expect(field.locator('p.fb-subtitle')).toHaveText('Annotation subtitle');
    await expectCentred(
      page,
      'Description view annotation subtitle',
      'p.fb-subtitle',
      1,
      '[data-testid="description-annotation"]',
    );
    // Its ordinary paragraph keeps today's justified rendering.
    const [paragraph] = await measure(page, '[data-testid="description-annotation"]', 'p.fb-p');
    expect(paragraph?.textAlign).toBe('justify');
  });
});
