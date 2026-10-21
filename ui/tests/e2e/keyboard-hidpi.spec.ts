/**
 * Keyboard operability, high-DPI layout, Cyrillic fallback fonts and Fast mode (T153 / T154,
 * FR-125, FR-025, edge cases of spec.md).
 *
 *  - Layout parts run core-less too: at device scale factors 1, 2 and 3 (and on the small CSS
 *    viewports a 200 % / 300 % laptop panel leaves) the menu bar, toolbar rows and status bar
 *    never overflow horizontally; screenshots go to `test-results/hidpi/`; toolbar bitmaps are
 *    drawn at their natural CSS size and the 16 px set is pixel-crisp at integer factors; the UI
 *    font stack names the per-platform Cyrillic-capable fonts and Cyrillic renders with real
 *    glyphs.
 *  - Keyboard: Alt+F opens the File menu, arrows / Home / End move, Escape closes and returns
 *    the focus, F10 focuses the bar, Left/Right move between menus; the view tabs follow the
 *    ARIA tabs pattern.
 *  - With the real core: every dialog (Find, Replace, Link, Table, Words, Spelling, Settings
 *    with its four tabs, About, Encoding, Save-changes prompt) is opened from the keyboard, Tab
 *    reaches every control and the default button, wraps around, focus is visible
 *    (`:focus-visible` outline), Escape closes; View > Fast Mode toggles the reduced-fidelity
 *    class, collapses images and is persisted in the settings.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import {
  expect,
  fixtureBook,
  test,
  waitForBook,
  waitForStartupDocument,
  type CoreHandle,
} from './fixtures/core';
import { LINE_START, MOD, REPLACE } from './fixtures/keys';

const UI_DIR = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = path.join(UI_DIR, 'test-results', 'hidpi');

/* ------------------------------------------------------------------------ */
/* In-page probes                                                           */
/* ------------------------------------------------------------------------ */

/*
 * The e2e tsconfig has no DOM lib, so browser-side probes are string snippets (as in the other
 * journeys).
 */

/** `scrollWidth <= clientWidth` (plus 1 px rounding) for the chrome rows. */
const OVERFLOWING_ROWS = `(() => {
  const selectors = ['[data-testid="menubar"]', '[data-testid="toolbars"]', '.mfbe-toolbar',
    '[data-testid="statusbar"]', '[data-testid="view-switcher"]'];
  const bad = [];
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (element.scrollWidth > element.clientWidth + 1) {
        bad.push(selector + ' ' + element.scrollWidth + '>' + element.clientWidth);
      }
    }
  }
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth + 1) bad.push('document ' + root.scrollWidth);
  return bad;
})()`;

async function overflowingRows(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(OVERFLOWING_ROWS);
}

interface ToolbarImage {
  src: string;
  natural: number;
  width: number;
  rendering: string;
  complete: boolean;
}

/** Toolbar images: natural size, rendered size and the effective image-rendering. */
const TOOLBAR_IMAGES = `[...document.querySelectorAll('.mfbe-toolbar-button img')].map((img) => ({
  src: img.getAttribute('src') || '',
  natural: img.naturalWidth,
  width: img.getBoundingClientRect().width,
  rendering: getComputedStyle(img).imageRendering,
  complete: img.complete,
}))`;

async function toolbarImages(page: Page): Promise<ToolbarImage[]> {
  return page.evaluate<ToolbarImage[]>(TOOLBAR_IMAGES);
}

/** Toolbar buttons that stick out of the viewport horizontally. */
const CLIPPED_BUTTONS = `[...document.querySelectorAll('.mfbe-toolbar-button')]
  .map((b) => b.getBoundingClientRect())
  .filter((r) => r.right > window.innerWidth + 1 || r.left < -1).length`;

/** Marks the keyboard-reachable controls of a dialog (`data-kbd-index`) and describes them. */
const MARK_CONTROLS = `((root) => {
  const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';
  const seenRadioGroups = new Set();
  const controls = [...root.querySelectorAll(FOCUSABLE)].filter((el) => {
    if (el.disabled || el.tabIndex < 0 || el.closest('[hidden]') !== null ||
        el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden') {
      return false;
    }
    // A radio group is one Tab stop (the checked button, else the first); arrows move inside.
    if (el.type === 'radio' && el.name) {
      const group = [...root.querySelectorAll('input[type="radio"][name="' + el.name + '"]')];
      const stop = group.find((r) => r.checked) || group[0];
      if (stop !== el || seenRadioGroups.has(el.name)) return false;
      seenRadioGroups.add(el.name);
    }
    return true;
  });
  controls.forEach((el, index) => el.setAttribute('data-kbd-index', String(index)));
  const active = document.activeElement;
  const defaultButton = root.querySelector('.mfbe-button-default');
  return {
    expected: controls.map((_, index) => index),
    initial: Number((active && active.getAttribute('data-kbd-index')) || -1),
    defaultIndex: Number((defaultButton && defaultButton.getAttribute('data-kbd-index')) || -1),
  };
})`;

/** The focused control: its marker index and whether its focus is visible. */
const FOCUS_STATE = `(() => {
  const el = document.activeElement;
  if (!el) return { index: -1, visible: true, label: 'none' };
  const style = getComputedStyle(el);
  const outline = style.outlineStyle !== 'none' && style.outlineWidth !== '0px';
  const shadow = style.boxShadow !== 'none';
  return {
    index: Number(el.getAttribute('data-kbd-index') || -1),
    visible: el.matches(':focus-visible') && (outline || shadow),
    label: el.tagName.toLowerCase() + '[' + (el.getAttribute('data-testid') || el.className) + ']',
  };
})()`;

/** Visible focus ring on the element. */
const FOCUS_RING = `(el) => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none'`;

const COMPUTED_DISPLAY = `(el) => getComputedStyle(el).display`;
const COMPUTED_BORDER_LEFT = `(el) => getComputedStyle(el).borderLeftStyle`;

/** Evaluates `snippet` (a function source) with the first element matching `selector`. */
async function withElement<T>(page: Page, snippet: string, selector: string): Promise<T> {
  return page.evaluate<T>(`(${snippet})(document.querySelector(${JSON.stringify(selector)}))`);
}

const testIdSelector = (testId: string) => `[data-testid="${testId}"]`;

/** Advance widths of wide Cyrillic vs narrow and wide Latin letters in the UI font. */
const GLYPH_WIDTHS = `(() => {
  const measure = (text) => {
    const span = document.createElement('span');
    span.textContent = text;
    span.style.font = getComputedStyle(document.body).font;
    span.style.position = 'absolute';
    span.style.whiteSpace = 'pre';
    document.body.appendChild(span);
    const width = span.getBoundingClientRect().width;
    span.remove();
    return width;
  };
  return { wide: measure('ШЩЖМ'), narrow: measure('iiii'), ascii: measure('WWWW') };
})()`;

interface TabCycle {
  /** Index (DOM order) of every keyboard-reachable control, `-1` = focus left the dialog. */
  expected: number[];
  visited: number[];
  initial: number;
  defaultIndex: number;
  /** Controls that had the focus without a visible focus indication. */
  invisible: string[];
}

/**
 * Marks the keyboard-reachable controls of the dialog, presses Tab once per control and
 * records which control holds the focus after every press (and whether its focus is visible).
 */
async function tabCycle(page: Page, dialogTestId: string): Promise<TabCycle> {
  const setup = await withElement<Pick<TabCycle, 'expected' | 'initial' | 'defaultIndex'>>(
    page,
    MARK_CONTROLS,
    testIdSelector(dialogTestId),
  );
  const visited: number[] = [];
  const invisible: string[] = [];
  for (let i = 0; i < setup.expected.length; i += 1) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate<{ index: number; visible: boolean; label: string }>(
      FOCUS_STATE,
    );
    visited.push(state.index);
    if (!state.visible) invisible.push(state.label);
  }
  return { ...setup, visited, invisible };
}

function assertCycle(cycle: TabCycle, name: string): void {
  const reached = new Set(cycle.visited);
  expect(cycle.expected.length, `${name}: has keyboard-reachable controls`).toBeGreaterThan(0);
  expect(reached.has(-1), `${name}: focus never leaves the dialog`).toBe(false);
  for (const index of cycle.expected) {
    expect(reached.has(index), `${name}: control #${index} is reachable with Tab`).toBe(true);
  }
  if (cycle.defaultIndex >= 0) {
    expect(reached.has(cycle.defaultIndex), `${name}: the default button is reachable`).toBe(true);
  }
  // After one press per control the focus is back where it started (wrap-around).
  if (cycle.initial >= 0) {
    expect(cycle.visited[cycle.visited.length - 1], `${name}: Tab wraps around`).toBe(
      cycle.initial,
    );
  }
  expect(cycle.invisible, `${name}: focus is visible on every control`).toEqual([]);
}

/* ------------------------------------------------------------------------ */
/* Keyboard helpers                                                         */
/* ------------------------------------------------------------------------ */

/** F10, then Left/Right until the menu button is focused, then Enter (first item highlighted). */
async function openMenuByKeyboard(page: Page, menuId: string): Promise<Locator> {
  // Park the pointer away from where the popup opens. `openBook` leaves it on the File menu's
  // "Open..." item; a popup that appears under a stationary pointer gets a hover update from
  // Chromium a few milliseconds later (`mouseover` / `mouseenter` without any `mousemove`),
  // which highlights the item under the pointer and, when it lands after an ArrowDown of
  // `activateItemByKeyboard`, pulls the highlight back off the item the key had reached.
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.mouse.move(viewport.width - 8, viewport.height - 8);
  await page.keyboard.press('F10');
  for (let i = 0; i < 12; i += 1) {
    const focused = await page.evaluate<string | null>(
      `(document.activeElement && document.activeElement.dataset.menuId) || null`,
    );
    if (focused === menuId) break;
    await page.keyboard.press('ArrowRight');
  }
  await expect(page.getByTestId(`menu-${menuId}`)).toBeFocused();
  await page.keyboard.press('Enter');
  const popup = page.getByTestId(`menu-${menuId}-popup`);
  await expect(popup).toBeVisible();
  await expect(popup).toBeFocused(); // keyboard-opened menus take the focus
  return popup;
}

/** ArrowDown until the item is highlighted, then Enter. */
async function activateItemByKeyboard(page: Page, popup: Locator, itemTestId: string) {
  const item = popup.getByTestId(itemTestId);
  await expect(item).toBeVisible();
  const highlighted = () =>
    popup
      .locator('.mfbe-menu-item-highlighted')
      .first()
      .getAttribute('data-testid', {
        timeout: 1_000,
      })
      .catch(() => null);
  for (let i = 0; i < 40; i += 1) {
    const before = await highlighted();
    if (before === itemTestId) break;
    await page.keyboard.press('ArrowDown');
    // The menu redraws after the key: look again only once the highlight has moved.
    await expect.poll(highlighted).not.toBe(before);
  }
  await expect(item).toHaveClass(/mfbe-menu-item-highlighted/);
  await page.keyboard.press('Enter');
}

async function openBook(core: CoreHandle, page: Page, name: string): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await core.enqueueDialog('dialog.openFile', { paths: [fixtureBook(name)] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, name);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

/**
 * Puts the caret into the first plain paragraph of the first section (not its title: a title
 * accepts links but no tables). One mouse click; everything else is keys.
 */
async function focusParagraph(page: Page): Promise<Locator> {
  const paragraph = page
    .getByTestId('body-editor')
    .locator('.fb-body > .fb-section > p.fb-p')
    .first();
  await paragraph.click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId('status-path')).toHaveText(/section\[1\]\/p\[\d+\]$/);
  return paragraph;
}

async function expectClosed(dialog: Locator): Promise<void> {
  await expect(dialog).toHaveCount(0);
}

/* ------------------------------------------------------------------------ */
/* Layout at 1x / 2x / 3x (core-less capable)                              */
/* ------------------------------------------------------------------------ */

for (const dpr of [1, 2, 3] as const) {
  test.describe(`layout at ${dpr}x (1280 x 800)`, () => {
    test.use({ deviceScaleFactor: dpr, viewport: { width: 1280, height: 800 } });

    test(`chrome rows do not overflow and icons are crisp at ${dpr}x`, async ({ core, page }) => {
      await core.openApp(page);
      await expect(page.getByTestId('toolbars')).toBeVisible();
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `app-${dpr}x.png`) });

      expect(await overflowingRows(page)).toEqual([]);
      expect(await page.evaluate<number>('window.devicePixelRatio')).toBe(dpr);

      const images = await toolbarImages(page);
      expect(images.length).toBeGreaterThan(10);
      await expect
        .poll(async () => (await toolbarImages(page)).every((i) => i.complete))
        .toBe(true);
      for (const image of await toolbarImages(page)) {
        // Bitmaps are shown at their natural CSS size: no fractional resampling at 1x.
        expect(image.width, image.src).toBe(image.natural);
        if (image.src.includes('/toolbar24/')) expect(image.natural).toBe(24);
        if (image.src.includes('/toolbar16/')) {
          expect(image.natural).toBe(16);
          // Integer factors draw the small set with nearest-neighbour scaling (crisp pixels).
          expect(image.rendering).toBe(dpr >= 2 ? 'pixelated' : 'auto');
        }
      }
    });
  });
}

test.describe('small CSS viewports (200 % and 300 % scaling of a laptop panel)', () => {
  for (const [dpr, width, height] of [
    [2, 960, 540],
    [3, 853, 480],
  ] as const) {
    test.describe(`${width} x ${height} at ${dpr}x`, () => {
      test.use({ deviceScaleFactor: dpr, viewport: { width, height } });

      test('toolbars wrap instead of clipping', async ({ core, page }) => {
        await core.openApp(page);
        await expect(page.getByTestId('toolbars')).toBeVisible();
        expect(await overflowingRows(page)).toEqual([]);
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `app-${width}x${height}-${dpr}x.png`) });
        // Every toolbar button is inside the viewport (wrapped rows, nothing cut off).
        expect(await page.evaluate<number>(CLIPPED_BUTTONS)).toBe(0);
      });

      test('the Settings dialog fits the viewport with its buttons visible (core)', async ({
        core,
        page,
      }) => {
        test.skip(!core.hasCore, 'the Settings dialog needs the core');
        await core.openApp(page);
        await expect(page.getByTestId('status-message')).toHaveText('Ready');
        // The start-up document takes the focus when it arrives (it would close an open menu).
        await waitForStartupDocument(page);
        const popup = await openMenuByKeyboard(page, 'tools');
        await activateItemByKeyboard(page, popup, 'menu-tools-settings');
        const dialog = page.getByTestId('dialog-settings');
        await expect(dialog).toBeVisible();
        await expect(page.getByTestId('settings-tab-view')).toBeVisible();
        const box = (await dialog.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
        // The OK / Cancel buttons stay visible (the content scrolls, the buttons do not).
        await expect(page.getByTestId('dialog-settings-button-ok')).toBeInViewport();
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({
          path: path.join(SHOTS, `settings-${width}x${height}-${dpr}x.png`),
        });
        await page.keyboard.press('Escape');
        await expectClosed(dialog);
      });
    });
  }
});

/* ------------------------------------------------------------------------ */
/* Fonts (core-less capable)                                                */
/* ------------------------------------------------------------------------ */

test.describe('fonts', () => {
  test('the UI font stack names the per-platform Cyrillic fonts and Cyrillic renders', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    const family = await page.evaluate<string>('getComputedStyle(document.body).fontFamily');
    const names = family.split(',').map((name: string) => name.trim().replace(/^['"]|['"]$/g, ''));
    const position = (name: string) => names.indexOf(name);
    for (const name of [
      'system-ui',
      '-apple-system',
      'Segoe UI',
      'Noto Sans',
      'DejaVu Sans',
      'Liberation Sans',
      'sans-serif',
    ]) {
      expect(position(name), `${name} in ${family}`).toBeGreaterThanOrEqual(0);
    }
    // Windows, macOS, then the Linux fonts, generic family last.
    expect(position('Segoe UI')).toBeLessThan(position('Noto Sans'));
    expect(position('Noto Sans')).toBeLessThan(position('DejaVu Sans'));
    expect(position('DejaVu Sans')).toBeLessThan(position('Liberation Sans'));
    expect(position('sans-serif')).toBe(names.length - 1);

    // Real glyphs, not .notdef boxes: wide Cyrillic letters are much wider than narrow Latin
    // ones in any text face, while tofu boxes all have the same advance.
    const widths = await page.evaluate<{ wide: number; narrow: number; ascii: number }>(
      GLYPH_WIDTHS,
    );
    expect(widths.wide).toBeGreaterThan(widths.narrow * 1.6);
    expect(widths.wide).toBeGreaterThan(widths.ascii * 0.6);
  });
});

/* ------------------------------------------------------------------------ */
/* Menus from the keyboard (core-less capable)                              */
/* ------------------------------------------------------------------------ */

test.describe('menus from the keyboard', () => {
  test('Alt+F opens File, arrows navigate, Escape closes, F10 focuses the bar', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await waitForStartupDocument(page);
    await page.keyboard.press('Alt+f');
    const popup = page.getByTestId('menu-file-popup');
    await expect(popup).toBeVisible();
    await expect(popup).toBeFocused();
    const items = popup.locator('[role="menuitem"], [role="menuitemcheckbox"]');
    await expect(items.first()).toHaveClass(/mfbe-menu-item-highlighted/);
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toHaveClass(/mfbe-menu-item-highlighted/);
    await page.keyboard.press('End');
    await expect(items.last()).toHaveClass(/mfbe-menu-item-highlighted/);
    await page.keyboard.press('Home');
    await expect(items.first()).toHaveClass(/mfbe-menu-item-highlighted/);
    // Right/Left move to the neighbouring menus.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('menu-edit-popup')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(popup).toBeVisible();
    // Escape closes and returns the focus to the File button (visible focus ring).
    await page.keyboard.press('Escape');
    await expectClosed(popup);
    const fileButton = page.getByTestId('menu-file');
    await expect(fileButton).toBeFocused();
    expect(await withElement<boolean>(page, FOCUS_RING, testIdSelector('menu-file'))).toBe(true);
    // F10 focuses the first menu; Right moves along the bar; Enter opens.
    await page.keyboard.press('Escape');
    await page.keyboard.press('F10');
    await expect(fileButton).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('menu-edit')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('menu-edit-popup')).toBeVisible();
    await page.keyboard.press('Escape');
    await expectClosed(page.getByTestId('menu-edit-popup'));
  });

  test('the Help menu and About open from the keyboard (core)', async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
    await waitForStartupDocument(page);
    // With a document open Alt+H is the original's "Select Href" hotkey: Help opens through the
    // menu bar (F10).
    await openMenuByKeyboard(page, 'help');
    await page.keyboard.press('a'); // About's accelerator (after Check for new version)
    const about = page.getByTestId('dialog-about');
    await expect(about).toBeVisible();
    // The dictionary notices arrive from the core after the dialog opens and add a Tab stop
    // (feature 003): the cycle is measured once the dialog is complete.
    await expect(about.getByTestId('about-dictionaries')).toBeVisible();
    assertCycle(await tabCycle(page, 'dialog-about'), 'About');
    await page.keyboard.press('Escape');
    await expectClosed(about);
  });
});

/* ------------------------------------------------------------------------ */
/* Dialogs, view tabs and Fast mode (core)                                  */
/* ------------------------------------------------------------------------ */

test.describe('dialogs from the keyboard', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('Find, Replace, Link and Table: Tab order, default button, focus ring, Escape', async ({
    core,
    page,
  }) => {
    await openBook(core, page, 'modern-utf8.fb2');
    await focusParagraph(page);

    await page.keyboard.press(`${MOD}+f`);
    const find = page.getByTestId('dialog-find');
    await expect(find).toBeVisible();
    assertCycle(await tabCycle(page, 'dialog-find'), 'Find');
    await page.keyboard.press('Escape');
    await expectClosed(find);

    await page.keyboard.press(REPLACE);
    const replace = page.getByTestId('dialog-replace');
    await expect(replace).toBeVisible();
    assertCycle(await tabCycle(page, 'dialog-replace'), 'Replace');
    await page.keyboard.press('Escape');
    await expectClosed(replace);

    // Link needs a text selection: select the first word with the keyboard.
    await focusParagraph(page);
    await page.keyboard.press(LINE_START);
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    // The editor picks the DOM selection up asynchronously (selectionchange).
    await expect(page.getByTestId('body-view')).toHaveAttribute('data-selected-text', /\S/);
    await page.keyboard.press(`${MOD}+l`);
    const link = page.getByTestId('dialog-link');
    await expect(link).toBeVisible();
    assertCycle(await tabCycle(page, 'dialog-link'), 'Link');
    await page.keyboard.press('Escape');
    await expectClosed(link);

    await focusParagraph(page);
    await page.keyboard.press('Alt+t'); // insert.table wins over the Tools mnemonic (enabled)
    const table = page.getByTestId('dialog-table');
    await expect(table).toBeVisible();
    assertCycle(await tabCycle(page, 'dialog-table'), 'Table');
    await page.keyboard.press('Escape');
    await expectClosed(table);
  });

  test('Words and Spelling dialogs', async ({ core, page }) => {
    await openBook(core, page, 'modern-utf8.fb2');
    await focusParagraph(page);

    await page.keyboard.press('Alt+w');
    const words = page.getByTestId('dialog-words');
    await expect(words).toBeVisible();
    await expect(page.getByTestId('words-loading')).toHaveCount(0, { timeout: 15_000 });
    assertCycle(await tabCycle(page, 'dialog-words'), 'Words');
    await page.keyboard.press('Escape');
    await expectClosed(words);

    await page.keyboard.press('F7');
    const spelling = page.getByTestId('dialog-spelling');
    const complete = page.getByTestId('spelling-complete');
    await expect(spelling.or(complete)).toBeVisible({ timeout: 15_000 });
    if (await spelling.isVisible()) {
      // Wait for the first misspelled word (controls are disabled while checking).
      await expect(page.getByTestId('spelling-change-to')).toBeEnabled({ timeout: 15_000 });
      assertCycle(await tabCycle(page, 'dialog-spelling'), 'Spelling');
      await page.keyboard.press('Escape');
      await expectClosed(spelling);
    } else {
      assertCycle(await tabCycle(page, 'spelling-complete'), 'Spelling complete');
      await page.keyboard.press('Escape');
      await expectClosed(complete);
    }
  });

  test('Settings: tabs with arrows, Tab order on every page', async ({ core, page }) => {
    await openBook(core, page, 'modern-utf8.fb2');
    const popup = await openMenuByKeyboard(page, 'tools');
    await activateItemByKeyboard(page, popup, 'menu-tools-settings');
    const dialog = page.getByTestId('dialog-settings');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('settings-loading')).toHaveCount(0, { timeout: 15_000 });
    const pages = ['view', 'other', 'hotkeys', 'words'];
    for (const [index, id] of pages.entries()) {
      const tab = page.getByTestId(`settings-tab-${id}`);
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(tab).toBeFocused();
      assertCycle(await tabCycle(page, 'dialog-settings'), `Settings/${id}`);
      // Back on the tab button, ArrowRight selects the next page.
      await tab.focus();
      if (index < pages.length - 1) await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('ArrowRight'); // wraps to the first page
    await expect(page.getByTestId('settings-tab-view')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expectClosed(dialog);
  });

  test('Encoding chooser and the Save-changes prompt', async ({ core, page }) => {
    await openBook(core, page, 'modern-utf8.fb2');
    // Save As with a native dialog that returns no encoding -> the Encoding chooser.
    await core.enqueueDialog('dialog.saveFile', { path: path.join(core.dataDir!, 'copy.fb2') });
    let popup = await openMenuByKeyboard(page, 'file');
    await activateItemByKeyboard(page, popup, 'menu-file-saveAs');
    const encoding = page.getByTestId('dialog-encoding');
    await expect(encoding).toBeVisible();
    assertCycle(await tabCycle(page, 'dialog-encoding'), 'Encoding');
    await page.keyboard.press('Escape');
    await expectClosed(encoding);
    await expect(page).toHaveTitle(/^modern-utf8\.fb2 - /); // cancelled: nothing written

    // A modified document + File > New -> "Save changes?" prompt; Escape cancels.
    await focusParagraph(page);
    await page.keyboard.type('x');
    await expect(page).toHaveTitle(/^modern-utf8\.fb2\* - /);
    popup = await openMenuByKeyboard(page, 'file');
    await activateItemByKeyboard(page, popup, 'menu-file-new');
    const prompt = page.getByTestId('dialog-save-changes');
    await expect(prompt).toBeVisible();
    assertCycle(await tabCycle(page, 'dialog-save-changes'), 'Save changes');
    await page.keyboard.press('Escape');
    await expectClosed(prompt);
    await expect(page).toHaveTitle(/^modern-utf8\.fb2\* - /);
  });

  test('view tabs follow the ARIA tabs pattern (arrows switch views)', async ({ core, page }) => {
    await openBook(core, page, 'modern-utf8.fb2');
    const body = page.getByTestId('view-body');
    await body.focus();
    await expect(body).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');
    // The view takes the focus (the editor is ready for typing); the tab stays operable.
    await page.getByTestId('view-source').focus();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('view-description')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('view-description').focus();
    await page.keyboard.press('End');
    await expect(page.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('view-source').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(body).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('body-editor')).toBeVisible();
  });

  test('View > Fast Mode toggles the reduced-fidelity class, collapses images and persists', async ({
    core,
    page,
  }) => {
    await openBook(core, page, 'modern-utf8.fb2');
    const view = page.getByTestId('body-view');
    const IMAGE_IMG = '[data-testid="body-editor"] figure.fb-image img';
    const image = page.getByTestId('body-editor').locator('figure.fb-image').first();
    await expect(image).toBeVisible();
    await expect(view).not.toHaveClass(/mfbe-body-view--fast/);
    expect(await withElement<string>(page, COMPUTED_DISPLAY, IMAGE_IMG)).not.toBe('none');
    await expect(image.locator('.fb-image-placeholder')).toBeHidden();

    const popup = await openMenuByKeyboard(page, 'view');
    await activateItemByKeyboard(page, popup, 'menu-view-fastMode');
    await expect(view).toHaveClass(/mfbe-body-view--fast/);
    await expect(view).toHaveAttribute('data-fast-mode', 'true');
    // Images collapse to the placeholder box; section frames disappear.
    expect(await withElement<string>(page, COMPUTED_DISPLAY, IMAGE_IMG)).toBe('none');
    await expect(image.locator('.fb-image-placeholder')).toBeVisible();
    expect(
      await withElement<string>(
        page,
        COMPUTED_BORDER_LEFT,
        '[data-testid="body-editor"] .fb-section',
      ),
    ).toBe('none');
    // Persisted through settings.set and shown checked in the menu.
    await expect
      .poll(
        async () => (await core.rpc<{ view: { fastMode: boolean } }>('settings.get')).view.fastMode,
      )
      .toBe(true);
    await page.keyboard.press('Alt+v');
    await expect(page.getByTestId('menu-view-fastMode')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');

    // F5 (the original hotkey) toggles it back.
    await focusParagraph(page);
    await page.keyboard.press('F5');
    await expect(view).not.toHaveClass(/mfbe-body-view--fast/);
    await expect
      .poll(
        async () => (await core.rpc<{ view: { fastMode: boolean } }>('settings.get')).view.fastMode,
      )
      .toBe(false);
    await expect(image).toBeVisible();
  });
});
