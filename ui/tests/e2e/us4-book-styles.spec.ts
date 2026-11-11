/**
 * Feature 012, User Story 4 - See the book's styles while editing (D35-D40; FR-060-FR-065; SC-014-SC-017).
 * Runs against the real core with the reference book under the two reference stylesheets of
 * tests/fixtures/books/ (make-fixtures.py):
 * - with View > Show Book Styles on, the Body view's value of every declared property equals Preview's
 *   on the same element, colours included (SC-014) - except what D37 limits or holds back, and the
 *   named-style underline, which is the editor's mark;
 * - the hostile rules are held back: every text stays visible, reachable, selectable and editable, and
 *   nothing is fetched (SC-015);
 * - Fast mode wins, greying the command with its reason and keeping its check mark (D39);
 * - switching changes nothing in the book (FR-065, D40);
 * - light and dark screenshots at 100, 125 and 150 % are attached as evidence (SC-016).
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

declare const window: { __mfbeTest?: { scripts?: { toXml(): Promise<string> } } };

const SHOTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../build/screenshots/book-styles',
);

interface Probe {
  name: string;
  /** In the Body view, under `[data-testid="body-view"]`. */
  body: string;
  /** In Preview's frame. */
  preview: string;
  /** The element whose text starts with this, when the first match is not the one. */
  text?: string;
  pseudo?: string;
  properties: string[];
}

/** Each FB2 element kind and named style of the reference stylesheet, with its declared properties. */
const PROBES: Probe[] = [
  {
    name: 'p',
    body: '.fb-p',
    preview: 'p',
    text: 'Plain,',
    properties: [
      'text-indent',
      'line-height',
      'letter-spacing',
      'word-spacing',
      'margin-top',
      'margin-bottom',
      'hyphens',
    ],
  },
  {
    name: 'p::first-letter',
    body: '.fb-p',
    preview: 'p',
    text: 'Plain,',
    pseudo: '::first-letter',
    properties: ['color'],
  },
  {
    name: 'section',
    body: '.fb-section',
    preview: 'section',
    properties: [
      'padding-left',
      'border-left-width',
      'border-left-style',
      'border-left-color',
      'background-color',
    ],
  },
  {
    name: 'title',
    body: '.fb-title',
    preview: 'title',
    properties: [
      'text-align',
      'font-family',
      'font-size',
      'font-weight',
      'text-transform',
      'text-shadow',
    ],
  },
  {
    name: 'subtitle',
    body: '.fb-subtitle',
    preview: 'subtitle',
    properties: ['font-style', 'text-align', 'color', 'direction'],
  },
  {
    name: 'subtitle::before',
    body: '.fb-subtitle',
    preview: 'subtitle',
    pseudo: '::before',
    properties: ['content'],
  },
  {
    name: 'epigraph',
    body: '.fb-epigraph',
    preview: 'epigraph',
    properties: ['font-size', 'margin-left', 'color', 'max-width'],
  },
  {
    name: 'cite',
    body: '.fb-cite',
    preview: 'cite',
    properties: [
      'border-top-width',
      'border-top-style',
      'border-top-color',
      'border-top-left-radius',
      'padding-top',
      'background-image',
      'column-count',
      'column-gap',
    ],
  },
  {
    name: 'annotation',
    body: '.fb-section .fb-annotation',
    preview: 'section annotation',
    properties: [
      'outline-width',
      'outline-style',
      'outline-color',
      'outline-offset',
      'box-shadow',
      'clear',
    ],
  },
  {
    name: 'poem',
    body: '.fb-poem',
    preview: 'poem',
    properties: ['margin-left', 'min-width', 'counter-reset', 'writing-mode'],
  },
  { name: 'stanza', body: '.fb-stanza', preview: 'stanza', properties: ['margin-bottom'] },
  {
    name: 'v',
    body: '.fb-v',
    preview: 'v',
    properties: ['font-variant-caps', 'counter-increment'],
  },
  { name: 'v::after', body: '.fb-v', preview: 'v', pseudo: '::after', properties: ['content'] },
  {
    name: 'text-author',
    body: '.fb-text-author',
    preview: 'text-author',
    properties: ['font-weight', 'text-align', 'font-stretch'],
  },
  {
    name: 'date',
    body: '.fb-date',
    preview: 'date',
    properties: ['color', 'text-decoration-line', 'opacity'],
  },
  { name: 'emphasis', body: '.fb-emphasis', preview: 'emphasis', properties: ['color'] },
  {
    name: 'strong',
    body: '.fb-strong',
    preview: 'strong',
    properties: ['font-weight', 'letter-spacing'],
  },
  {
    name: 'strikethrough',
    body: '.fb-strikethrough',
    preview: 'strikethrough',
    properties: ['text-decoration-line', 'text-decoration-style', 'text-decoration-color'],
  },
  { name: 'sub', body: '.fb-sub', preview: 'sub', properties: ['font-size'] },
  { name: 'sup', body: '.fb-sup', preview: 'sup', properties: ['font-size', 'position', 'top'] },
  {
    name: 'code',
    body: '.fb-code',
    preview: 'code',
    properties: ['font-family', 'background-color', 'display'],
  },
  { name: 'a', body: 'a', preview: 'a', text: 'chapter two', properties: ['color'] },
  { name: 'table', body: 'table.fb-table', preview: 'table', properties: ['width'] },
  { name: 'th', body: 'th', preview: 'th', properties: ['background-color'] },
  {
    name: 'td',
    body: 'td',
    preview: 'td',
    properties: ['border-top-width', 'border-top-style', 'border-top-color'],
  },
  { name: 'empty-line', body: '.fb-empty-line', preview: 'empty-line', properties: ['min-height'] },
  {
    name: '.letter',
    body: '[data-style~="letter"]',
    preview: '.letter',
    properties: ['font-style', 'text-align', 'color'],
  },
  {
    name: '.smallcaps',
    body: '.fb-style[data-style="smallcaps"]',
    preview: 'style.smallcaps',
    properties: ['font-variant-caps', 'background-color'],
  },
];

/* The e2e tsconfig has no DOM lib: the browser-side probe is a string snippet (as theme.spec.ts). */
const VALUES = `(([inPreview, probes]) => {
  const doc = inPreview
    ? document.querySelector('[data-testid="preview-frame"]').contentDocument
    : document;
  const scope = inPreview ? doc : doc.querySelector('[data-testid="body-view"]');
  const out = {};
  for (const probe of probes) {
    const selector = inPreview ? probe.preview : probe.body;
    const element = [...scope.querySelectorAll(selector)].find(
      (one) => !probe.text || one.textContent.trim().startsWith(probe.text),
    );
    if (!element) {
      out[probe.name] = null;
      continue;
    }
    const computed = doc.defaultView.getComputedStyle(element, probe.pseudo ?? null);
    out[probe.name] = Object.fromEntries(
      probe.properties.map((name) => [name, computed.getPropertyValue(name)]),
    );
  }
  return out;
})`;

type Values = Record<string, Record<string, string> | null>;

async function valuesOf(page: Page, inPreview: boolean): Promise<Values> {
  return page.evaluate<Values>(`(${VALUES})(${JSON.stringify([inPreview, PROBES])})`);
}

/** What every text of the book must keep under the hostile stylesheet (SC-015). */
const REACHABLE = `(() => {
  const view = document.querySelector('[data-testid="body-view"]');
  const problems = [];
  for (const element of view.querySelectorAll('.fb-editor :is(.fb-p, .fb-v, .fb-subtitle, .fb-text-author, .fb-section, .fb-title, .fb-epigraph, .fb-cite, .fb-stanza, .fb-annotation, .fb-emphasis, .fb-strong, .fb-code)')) {
    const style = getComputedStyle(element);
    const label = element.className + ' "' + element.textContent.trim().slice(0, 20) + '"';
    const alpha = /rgba\\([^)]*,\\s*0\\)$/.test(style.color) || style.color === 'transparent';
    if (style.display === 'none') problems.push(label + ': display none');
    if (style.visibility !== 'visible') problems.push(label + ': visibility ' + style.visibility);
    if (Number(style.opacity) < 0.3) problems.push(label + ': opacity ' + style.opacity);
    if (parseFloat(style.fontSize) < 6) problems.push(label + ': font-size ' + style.fontSize);
    if (alpha) problems.push(label + ': colour ' + style.color);
    if (['fixed', 'absolute', 'sticky'].includes(style.position)) problems.push(label + ': position ' + style.position);
    if (style.transform !== 'none') problems.push(label + ': transform ' + style.transform);
    if (style.overflow !== 'visible' && style.overflow !== '') problems.push(label + ': overflow ' + style.overflow);
    if (style.pointerEvents === 'none') problems.push(label + ': pointer-events none');
    if (style.userSelect === 'none') problems.push(label + ': user-select none');
    if (style.animationName !== 'none') problems.push(label + ': animation ' + style.animationName);
    if (style.cursor === 'none') problems.push(label + ': cursor none');
    if (element.getBoundingClientRect().height < 1 && element.textContent.trim()) problems.push(label + ': no height');
  }
  return problems;
})()`;

async function settings(core: CoreHandle, view: Record<string, unknown>): Promise<void> {
  await core.rpc('settings.set', { patch: { view } });
}

async function openBook(core: CoreHandle, page: Page, name: string): Promise<string> {
  const book = fixtureBook(name);
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
  await expect(page.getByTestId('body-editor')).toBeVisible();
  return book;
}

async function viewMenuItem(page: Page, id: string) {
  await page.getByTestId('menu-view').click();
  return page.getByTestId(`menu-view-${id}`);
}

async function switchBookStyles(page: Page): Promise<void> {
  await (await viewMenuItem(page, 'showBookStyles')).click();
}

const xml = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.toXml());

// The view settings these journeys change (spelling, the language, the book's styles) go back to their
// defaults after each test: a worker's core keeps its settings from one test to the next.
test.afterEach(async ({ core }) => {
  if (core.hasCore) await core.rpc('settings.set', { patch: { view: null } }).catch(() => {});
});

test.describe('US4 (feature 012) - the book styles in the Body view', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    // The ids' tabs and the spelling marks are marks on top of the book: not part of the look compared.
    await settings(core, {
      showIds: false,
      spellEnabled: false,
      showBookStyles: false,
      theme: 'light',
    });
  });

  test("the Body view's values equal Preview's, property by property (SC-014)", async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openBook(core, page, 'book-styles-reference.fb2');
    await switchBookStyles(page);
    await expect(page.getByTestId('body-view')).toHaveClass(/\bmfbe-book-styles\b/);
    await expect(page.locator('style#mfbe-book-styles')).toHaveCount(1);
    const body = await valuesOf(page, false);
    await page.keyboard.press('Shift+F5');
    await expect(page.getByTestId('preview')).toHaveAttribute('data-ready', 'true');
    const preview = await valuesOf(page, true);
    const mismatches: string[] = [];
    for (const probe of PROBES) {
      const a = body[probe.name];
      const b = preview[probe.name];
      if (!a || !b) {
        mismatches.push(`${probe.name}: not found in ${a ? 'Preview' : 'the Body view'}`);
        continue;
      }
      for (const name of probe.properties) {
        if (a[name] !== b[name])
          mismatches.push(`${probe.name} ${name}: Body ${a[name]}, Preview ${b[name]}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('the hostile rules are held back: every text stays reachable and editable (SC-015)', async ({
    core,
    page,
  }) => {
    const offMachine: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!/^(blob|data):/.test(url) && !url.startsWith('http://127.0.0.1')) offMachine.push(url);
    });
    await core.openApp(page);
    await openBook(core, page, 'book-styles-hostile.fb2');
    await switchBookStyles(page);
    await expect(page.getByTestId('body-view')).toHaveClass(/\bmfbe-book-styles\b/);
    await expect(page.locator('style#mfbe-book-styles')).toHaveCount(1);
    expect(await page.evaluate<string[]>(REACHABLE)).toEqual([]);
    // Typing and selecting work as without the styles.
    const quotation = page.getByTestId('body-editor').getByText('A quotation.');
    await quotation.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Typed with the styles on.');
    await expect(page.getByTestId('body-editor')).toContainText(
      'A quotation. Typed with the styles on.',
    );
    await page.keyboard.press('Shift+Home');
    expect(await page.evaluate<string>('String(getSelection())')).toContain(
      'Typed with the styles on.',
    );
    expect(offMachine).toEqual([]);
  });

  test('Fast mode wins: the command greys with its reason and keeps its check mark (D39)', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openBook(core, page, 'book-styles-reference.fb2');
    await switchBookStyles(page);
    await expect(page.getByTestId('body-view')).toHaveClass(/\bmfbe-book-styles\b/);
    await (await viewMenuItem(page, 'fastMode')).click();
    await expect(page.getByTestId('body-view')).not.toHaveClass(/\bmfbe-book-styles\b/);
    const item = await viewMenuItem(page, 'showBookStyles');
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toHaveAttribute('aria-checked', 'true');
    await expect(item).toHaveAttribute('title', /Fast mode is on/);
    await page.keyboard.press('Escape');
    await (await viewMenuItem(page, 'fastMode')).click();
    await expect(page.getByTestId('body-view')).toHaveClass(/\bmfbe-book-styles\b/);
  });

  test('switching changes nothing in the book and is remembered (FR-065, D40)', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openBook(core, page, 'book-styles-reference.fb2');
    const before = await xml(page);
    const title = await page.title();
    for (let n = 0; n < 2; n++) {
      await switchBookStyles(page);
      await expect(page.getByTestId('body-view')).toHaveClass(/\bmfbe-book-styles\b/);
      await switchBookStyles(page);
      await expect(page.getByTestId('body-view')).not.toHaveClass(/\bmfbe-book-styles\b/);
    }
    expect(await xml(page)).toBe(before);
    expect(await page.title()).toBe(title);
    const undo = await (async () => {
      await page.getByTestId('menu-edit').click();
      return page.getByTestId('menu-edit-undo');
    })();
    await expect(undo).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await switchBookStyles(page);
    const saved = await core.rpc<{ view: { showBookStyles?: boolean } }>('settings.get');
    expect(saved.view.showBookStyles).toBe(true);
  });
});

for (const scale of [1, 1.25, 1.5] as const) {
  test.describe(`US4 (feature 012) - the book styles at ${scale * 100} %`, () => {
    test.use({ deviceScaleFactor: scale, viewport: { width: 1280, height: 800 } });

    test(`light and dark screenshots at ${scale * 100} % (SC-016)`, async ({
      core,
      page,
    }, testInfo) => {
      test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
      await settings(core, {
        showIds: false,
        spellEnabled: false,
        showBookStyles: true,
        theme: 'light',
      });
      await core.openApp(page);
      await openBook(core, page, 'book-styles-reference.fb2');
      await expect(page.getByTestId('body-view')).toHaveClass(/\bmfbe-book-styles\b/);
      mkdirSync(SHOTS, { recursive: true });
      for (const theme of ['light', 'dark'] as const) {
        await settings(core, { theme });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const file = path.join(SHOTS, `book-styles-${theme}-${scale * 100}.png`);
        // The window as the user sees it: an element taller than the window is not drawn whole.
        await page.screenshot({ path: file });
        await testInfo.attach(`book styles, ${theme}, ${scale * 100} %`, {
          path: file,
          contentType: 'image/png',
        });
      }
    });
  });
}
