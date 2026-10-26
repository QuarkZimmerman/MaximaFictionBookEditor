/**
 * Interface theme (Settings > View > Theme: System / Light / Dark).
 *
 *  1. With a dark OS preference (`page.emulateMedia({colorScheme: 'dark'})`) the shell starts
 *     dark: `html[data-theme=dark]`, dark canvas, chrome and Body view; with the real core the
 *     Body editor and the CodeMirror Source editor are dark too (runs core-less for the shell).
 *  2. Settings > View > Theme > Light applies at once (OK and Apply), despite the dark OS; no
 *     restart.
 *  3. A reload keeps the chosen theme (persisted by the core in `view.theme` and mirrored to
 *     `localStorage` for the first paint).
 *  4. Explicit Body colours (anything but black on white) override the theme palette; the
 *     defaults follow the theme again.
 *  5. A block of table cells (feature 006, data-model §5.6, research R6.8): the tint shows on
 *     exactly the block's cells, and selected text keeps 4.5:1 in data and header cells, under
 *     the tint and under the in-cell text-selection colour, in the light and the dark theme.
 *  Screenshots of both themes go to `test-results/theme/` (not asserted).
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import {
  expect,
  fileNew,
  fixtureBook,
  test,
  waitForBook,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';

const UI_DIR = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = path.join(UI_DIR, 'test-results', 'theme');

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

/** Relative luminance (0 = black, 1 = white) of a computed `rgb()` colour; null when transparent. */
function luminance(css: string | null): number | null {
  if (!css) return null;
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(css);
  if (!match) return null;
  if (match[4] !== undefined && Number(match[4]) === 0) return null;
  const channel = (value: string) => {
    const c = Number(value) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(match[1]!) + 0.7152 * channel(match[2]!) + 0.0722 * channel(match[3]!);
}

/* The e2e tsconfig has no DOM lib: browser-side probes are string snippets. */

/** Computed background / text colours of the first element matching each selector. */
const COLORS = `((selectors) => Object.fromEntries(selectors.map((selector) => {
  const el = document.querySelector(selector);
  if (!el) return [selector, null];
  const style = getComputedStyle(el);
  return [selector, { background: style.backgroundColor, color: style.color }];
})))`;

interface Colors {
  background: string;
  color: string;
}

async function colorsOf(page: Page, selectors: string[]): Promise<Record<string, Colors | null>> {
  return page.evaluate<Record<string, Colors | null>>(`(${COLORS})(${JSON.stringify(selectors)})`);
}

const THEME_STATE = `(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  colorScheme: getComputedStyle(document.documentElement).colorScheme,
  mirror: localStorage.getItem('mfbeTheme'),
  prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
}))()`;

interface ThemeState {
  theme: string | null;
  colorScheme: string;
  mirror: string | null;
  prefersDark: boolean;
}

const themeState = (page: Page) => page.evaluate<ThemeState>(THEME_STATE);

function expectDark(colors: Colors | null, what: string): void {
  expect(colors, what).not.toBeNull();
  const bg = luminance(colors!.background);
  expect(bg, `${what} background ${colors!.background}`).not.toBeNull();
  expect(bg!, `${what} background ${colors!.background}`).toBeLessThan(0.3);
  expect(luminance(colors!.color)!, `${what} text ${colors!.color}`).toBeGreaterThan(0.4);
}

function expectLight(colors: Colors | null, what: string): void {
  expect(colors, what).not.toBeNull();
  const bg = luminance(colors!.background);
  expect(bg, `${what} background ${colors!.background}`).not.toBeNull();
  expect(bg!, `${what} background ${colors!.background}`).toBeGreaterThan(0.7);
  expect(luminance(colors!.color)!, `${what} text ${colors!.color}`).toBeLessThan(0.3);
}

async function supportsSettings(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('settings.get')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

async function resetView(core: CoreHandle): Promise<void> {
  await core.rpc('settings.set', { patch: { view: null } });
}

async function newDocument(page: Page): Promise<void> {
  await fileNew(page);
  await expect(page.getByTestId('body-editor')).toBeVisible();
}

async function showSource(page: Page): Promise<void> {
  await page.getByTestId('view-source').click();
  await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
}

async function openSettings(page: Page): Promise<void> {
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-settings').click();
  await expect(page.getByTestId('dialog-settings')).toBeVisible();
  await expect(page.getByTestId('settings-page-view')).toBeVisible();
}

async function screenshot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

const SHELL = ['body', '[data-testid="menubar"]', '[data-testid="statusbar"]', '.mfbe-tree-panel'];

/* A block of cells (test 5) ---------------------------------------------- */

type Rgba = [number, number, number, number];

/**
 * `rgb()`, `rgba()` or a hex colour (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` - the production
 * build's minifier writes an `rgba()` token as `#rrggbbaa`) as channels with alpha; null for
 * anything else.
 */
function parseColor(css: string): Rgba | null {
  const rgb = /rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)/.exec(css);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
  }
  const hex = /#([0-9a-f]{3,8})\b/i.exec(css)?.[1];
  if (!hex || hex.length === 5 || hex.length === 7) return null;
  const digits = hex.length <= 4 ? [...hex].map((d) => d + d) : hex.match(/../g)!;
  const [r, g, b, a] = digits.map((pair) => Number.parseInt(pair, 16));
  return [r!, g!, b!, a === undefined ? 1 : a / 255];
}

/** `top` painted over the opaque `base`. */
function over(top: Rgba, base: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i]! * a + base[i]! * (1 - a)).concat(1) as Rgba;
}

/** The WCAG contrast ratio of two opaque colours, with the luminance helper above. */
function contrast(a: Rgba, b: Rgba): number {
  const lum = (c: Rgba) =>
    luminance(`rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`)!;
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The node ids of the vectors' header-row table, row by row ([a b c] of th over two td rows). */
const HEADER_TABLE_CELLS = `(() => {
  const doc = window.__mfbeTest.scripts.document();
  const textOf = (n) => (n.type === 'text' ? n.text : (n.content ?? []).map(textOf).join(''));
  let found = null;
  const visit = (node) => {
    if (found || !node || typeof node !== 'object') return;
    if (node.type === 'table') {
      const rows = (node.content ?? []).filter((row) => row.type === 'tr');
      const first = rows.length > 0 ? rows[0].content ?? [] : [];
      if (rows.length === 3 && first.length === 3 && first.every((cell) => cell.type === 'th') &&
          first.map(textOf).join('') === 'abc') {
        found = rows.flatMap((row) => row.content.map((cell) => cell.attrs.nodeId));
      }
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of doc.bodies) visit(body);
  return found;
})()`;

interface CellProbe {
  id: string | null;
  tag: string;
  selected: boolean;
  background: string;
  image: string;
  color: string;
}

/** Every cell of the Body editor: its block class and its computed colours. */
const CELL_PROBE = `(() => [...document.querySelectorAll(
  '[data-testid="body-editor"] .fb-table td, [data-testid="body-editor"] .fb-table th')]
  .map((cell) => {
    const style = getComputedStyle(cell);
    return {
      id: cell.getAttribute('data-node-id'),
      tag: cell.tagName.toLowerCase(),
      selected: cell.classList.contains('mfbe-cell-selected'),
      background: style.backgroundColor,
      image: style.backgroundImage,
      color: style.color,
    };
  }))()`;

const CELL_TEXT_SELECTION = `getComputedStyle(document.documentElement)
  .getPropertyValue('--mfbe-cell-text-selection').trim()`;

/* ------------------------------------------------------------------------ */
/* Journeys                                                                 */
/* ------------------------------------------------------------------------ */

test.describe('interface theme', () => {
  test.afterEach(async ({ core }) => {
    if (core.hasCore) await resetView(core).catch(() => {});
  });

  test('1. follows a dark OS preference: shell, Body view and Source editor are dark', async ({
    core,
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await core.openApp(page);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const state = await themeState(page);
    expect(state.prefersDark).toBe(true);
    expect(state.colorScheme).toBe('dark');
    expect(state.mirror).toBe('system');

    const shell = await colorsOf(page, [...SHELL, '[data-testid="panel-body"]']);
    for (const [selector, colors] of Object.entries(shell)) expectDark(colors, selector);
    // Toolbars stay a little lighter than the canvas so the original bitmaps keep contrast.
    const toolbar = (await colorsOf(page, ['[data-testid="toolbars"]']))[
      '[data-testid="toolbars"]'
    ];
    expect(luminance(toolbar!.background)!).toBeLessThan(0.3);
    expect(luminance(toolbar!.background)!).toBeGreaterThan(luminance(shell.body!.background)!);
    // Focus rings stay visible: the accent is bright on dark.
    await page.getByTestId('view-body').focus();
    const outline = await page
      .getByTestId('view-body')
      .evaluate((node) => node.ownerDocument.defaultView!.getComputedStyle(node).outlineColor);
    expect(luminance(outline)!).toBeGreaterThan(0.3);
    await screenshot(page, 'dark-shell');

    if (!core.hasCore || !(await supportsSettings(core))) return;

    await newDocument(page);
    const body = await colorsOf(page, ['.mfbe-body-view', '.fb-editor p']);
    expectDark(body['.mfbe-body-view'], 'Body view');
    // Paragraphs are transparent over the Body canvas: light text.
    expect(luminance(body['.fb-editor p']!.color)!, 'Body paragraph text').toBeGreaterThan(0.4);
    // Titles keep their green bar, re-tuned for the dark canvas.
    const title = (await colorsOf(page, ['.fb-title']))['.fb-title'];
    if (title) expect(luminance(title.background)!).toBeLessThan(0.3);
    await screenshot(page, 'dark-body');

    await showSource(page);
    const source = await colorsOf(page, ['.mfbe-source-editor .cm-editor', '.cm-gutters']);
    expectDark(source['.mfbe-source-editor .cm-editor'], 'CodeMirror editor');
    expect(luminance(source['.cm-gutters']!.background)!).toBeLessThan(0.3);
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-theme', 'dark');
    await screenshot(page, 'dark-source');

    await page.getByTestId('view-description').click();
    const desc = (await colorsOf(page, ['.mfbe-desc']))['.mfbe-desc'];
    expectDark(desc, 'Description view');
    await screenshot(page, 'dark-description');
  });

  test('1b. follows a light OS preference (the default look is unchanged)', async ({
    core,
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await core.openApp(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect((await themeState(page)).colorScheme).toBe('light');
    const shell = await colorsOf(page, [...SHELL, '[data-testid="panel-body"]']);
    for (const [selector, colors] of Object.entries(shell)) expectLight(colors, selector);
    expect(shell['[data-testid="panel-body"]']!.background).toBe('rgb(255, 255, 255)');
    await screenshot(page, 'light-shell');

    if (!core.hasCore || !(await supportsSettings(core))) return;
    await newDocument(page);
    expectLight((await colorsOf(page, ['.mfbe-body-view']))['.mfbe-body-view'], 'Body view');
    await screenshot(page, 'light-body');
    await showSource(page);
    expectLight(
      (await colorsOf(page, ['.mfbe-source-editor .cm-editor']))['.mfbe-source-editor .cm-editor'],
      'CodeMirror editor',
    );
    await screenshot(page, 'light-source');
  });

  test('2. Settings > Theme > Light applies at once despite a dark OS (OK and Apply)', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsSettings(core)), 'the core does not implement settings.* yet');
    await resetView(core);
    await page.emulateMedia({ colorScheme: 'dark' });
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await newDocument(page);

    await openSettings(page);
    const select = page.getByTestId('settings-view-theme');
    await expect(select).toHaveValue('system');
    await expect(select.locator('option')).toHaveText(['System', 'Light', 'Dark']);
    await select.selectOption('light');
    // Not before OK / Apply.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    await expect(page.getByTestId('dialog-restart-prompt')).toHaveCount(0);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const state = await themeState(page);
    expect(state.prefersDark).toBe(true);
    expect(state.colorScheme).toBe('light');
    expect(state.mirror).toBe('light');
    const light = await colorsOf(page, ['body', '.mfbe-body-view']);
    expectLight(light.body, 'canvas');
    expectLight(light['.mfbe-body-view'], 'Body view');
    expect((await core.rpc<{ view: { theme: string } }>('settings.get')).view.theme).toBe('light');

    // Apply keeps the dialog open and switches at once; Cancel afterwards does not revert.
    await openSettings(page);
    await page.getByTestId('settings-view-theme').selectOption('dark');
    await page.getByTestId('dialog-settings-button-apply').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('dialog-settings')).toBeVisible();
    const dialog = (await colorsOf(page, ['.mfbe-dialog']))['.mfbe-dialog'];
    expectDark(dialog, 'Settings dialog');
    await screenshot(page, 'dark-settings-dialog');
    await page.getByTestId('dialog-settings-button-cancel').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expectDark((await colorsOf(page, ['.mfbe-body-view']))['.mfbe-body-view'], 'Body view');

    // Back to System: the dark OS wins again.
    await openSettings(page);
    await page.getByTestId('settings-view-theme').selectOption('system');
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    await expect.poll(async () => (await themeState(page)).mirror).toBe('system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('3. the chosen theme survives a reload', async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsSettings(core)), 'the core does not implement settings.* yet');
    await resetView(core);
    await page.emulateMedia({ colorScheme: 'dark' });
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');

    await openSettings(page);
    await page.getByTestId('settings-view-theme').selectOption('light');
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.reload();
    await page.getByTestId('app-root').waitFor();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expectLight((await colorsOf(page, ['body']))['body'], 'canvas');
    await newDocument(page);
    await showSource(page);
    expectLight(
      (await colorsOf(page, ['.mfbe-source-editor .cm-editor']))['.mfbe-source-editor .cm-editor'],
      'CodeMirror editor',
    );

    // The other way round: Dark on a light OS, reload, still dark.
    await page.emulateMedia({ colorScheme: 'light' });
    await core.rpc('settings.set', { patch: { view: { theme: 'dark' } } });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); // settings.changed
    await page.reload();
    await page.getByTestId('app-root').waitFor();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('4. explicit Body colours override the theme palette; the defaults follow it', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsSettings(core)), 'the core does not implement settings.* yet');
    await resetView(core);
    await page.emulateMedia({ colorScheme: 'dark' });
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
    await newDocument(page);
    expectDark((await colorsOf(page, ['.mfbe-body-view']))['.mfbe-body-view'], 'Body view');

    // Settings > View explains the rule next to the colour pickers.
    await openSettings(page);
    await expect(page.getByTestId('settings-view-colors-hint')).toContainText('follows the theme');
    await page.getByTestId('settings-view-background').fill('#fefefe');
    await page.getByTestId('settings-view-text-color').fill('#102030');
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    await expect
      .poll(async () => (await colorsOf(page, ['.mfbe-body-view']))['.mfbe-body-view']?.background)
      .toBe('rgb(254, 254, 254)');
    expect((await colorsOf(page, ['.mfbe-body-view']))['.mfbe-body-view']!.color).toBe(
      'rgb(16, 32, 48)',
    );
    // The shell stays dark: only the Body colours were overridden.
    expectDark((await colorsOf(page, ['body']))['body'], 'canvas');
    await screenshot(page, 'dark-body-custom-colours');

    // Back to the defaults (black on white): the dark palette applies again.
    await core.rpc('settings.set', {
      patch: { view: { bodyBackground: '#ffffff', bodyTextColor: '#000000' } },
    });
    await expect
      .poll(async () =>
        luminance((await colorsOf(page, ['.mfbe-body-view']))['.mfbe-body-view']!.background),
      )
      .toBeLessThan(0.3);
    expectDark((await colorsOf(page, ['.mfbe-body-view']))['.mfbe-body-view'], 'Body view');
  });

  test('5. a block of cells keeps selected text at 4.5:1 in data and header cells, light and dark', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsSettings(core)), 'the core does not implement settings.* yet');
    await resetView(core);
    await page.emulateMedia({ colorScheme: 'light' });
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
    const book = fixtureBook('tables.fb2');
    await core.enqueueDialog('dialog.openFile', { paths: [book] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await waitForBook(page, book);
    await expect(page.getByTestId('body-editor')).toBeVisible();

    // The block from header cell a to data cell e: two th over two td. Two points in cells of
    // one table, made a block by the table plugin's normalisation (U10) in a real page.
    const ids = await page.evaluate<string[] | null>(HEADER_TABLE_CELLS);
    expect(ids, 'the header-row table of tables.fb2').not.toBeNull();
    const [a, , , , e] = ids!;
    const placed = await page.evaluate<boolean>(
      `window.__mfbeTest.scripts.selectRange(${JSON.stringify({ nodeId: a, offset: 0 })}, ${JSON.stringify({ nodeId: e, offset: 1 })})`,
    );
    expect(placed).toBe(true);
    const block = [ids![0], ids![1], ids![3], ids![4]];
    await expect
      .poll(async () =>
        (await page.evaluate<CellProbe[]>(CELL_PROBE)).filter((c) => c.selected).map((c) => c.id),
      )
      .toEqual(block);

    for (const theme of ['light', 'dark'] as const) {
      if (theme === 'dark') {
        await core.rpc('settings.set', { patch: { view: { theme: 'dark' } } });
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      } else {
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      }
      const cells = await page.evaluate<CellProbe[]>(CELL_PROBE);
      // Exactly the block's cells carry the class and the tint; no other cell is tinted.
      expect(cells.filter((c) => c.selected).map((c) => c.id)).toEqual(block);
      for (const cell of cells.filter((c) => !c.selected)) {
        expect(cell.image, `${theme}: cell ${cell.id} outside the block`).toBe('none');
      }
      const textSelection = parseColor(await page.evaluate<string>(CELL_TEXT_SELECTION));
      expect(textSelection, `${theme}: --mfbe-cell-text-selection`).not.toBeNull();
      const kinds = new Set<string>();
      for (const cell of cells.filter((c) => c.selected)) {
        kinds.add(cell.tag);
        const base = parseColor(cell.background);
        const tint = parseColor(cell.image);
        const text = parseColor(cell.color);
        expect(base && base[3], `${theme}: ${cell.tag} background ${cell.background}`).toBe(1);
        expect(tint, `${theme}: ${cell.tag} tint ${cell.image}`).not.toBeNull();
        expect(tint![3], `${theme}: the tint is translucent`).toBeLessThan(1);
        const underTint = contrast(text!, over(tint!, base!));
        const underSelection = contrast(text!, over(textSelection!, base!));
        expect(underTint, `${theme}: ${cell.tag} text under the block tint`).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(
          underSelection,
          `${theme}: ${cell.tag} text under the in-cell selection colour`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect([...kinds].sort()).toEqual(['td', 'th']);
      await screenshot(page, `${theme}-cell-block`);
    }
  });
});
