/**
 * US4 (feature 002) - every menu item is readable (FR-020, FR-021, SC-005): every item of every
 * menu-bar menu, every submenu (opened with the mouse, so its parent item is highlighted - the
 * Scripts groups and File > Recent Files) and the Body and Document Tree context menus has a
 * text-to-background contrast of at least 4.5:1 when enabled and 2.5:1 when disabled (and
 * stays dimmer than the enabled items), the highlighted item stands out, in the light and the
 * dark theme and with custom Body colours; with forced colours (high contrast) the highlighted
 * item keeps a distinct background. On release 0.0.1 enabled submenu items were white on white
 * (contrast 1.00) and the Body context menu took the user's Body text colour.
 */

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

const MENUS = ['file', 'edit', 'view', 'add', 'style', 'tools', 'scripts', 'help'];

/** Browser-side test hooks (`src/scripting/testHooks.ts`); the e2e tsconfig has no DOM lib. */
declare const window: { __mfbeTest?: { scripts?: { list(): unknown[] } } };

interface ItemContrast {
  testId: string | null;
  text: string;
  ratio: number;
  disabled: boolean;
  highlighted: boolean;
  /** The background seen behind the item (transparent layers resolved), "r,g,b". */
  background: string;
}

/* The e2e tsconfig has no DOM lib: browser-side probes are string snippets. */
const CONTRAST = `((popupTestId) => {
  const popup = document.querySelector('[data-testid="' + popupTestId + '"]');
  if (!popup) return null;
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const channel = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const background = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  return [...popup.querySelectorAll('.mfbe-menu-item')]
    .filter((el) => el.closest('.mfbe-menu-popup') === popup)
    .map((el) => {
      const label = el.querySelector('.mfbe-menu-label') || el;
      const fg = parse(getComputedStyle(label).color);
      const bg = background(el);
      const l1 = lum(fg);
      const l2 = lum(bg);
      return {
        testId: el.getAttribute('data-testid'),
        text: (el.textContent || '').trim(),
        ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
        disabled: el.classList.contains('mfbe-menu-item-disabled'),
        highlighted: el.classList.contains('mfbe-menu-item-highlighted'),
        background: [bg.r, bg.g, bg.b].join(','),
      };
    });
})`;

async function contrastOf(page: Page, popupTestId: string): Promise<ItemContrast[]> {
  const items = await page.evaluate<ItemContrast[] | null>(
    `${CONTRAST}(${JSON.stringify(popupTestId)})`,
  );
  expect(items, `popup ${popupTestId}`).not.toBeNull();
  return items ?? [];
}

function problemsOf(items: ItemContrast[], where: string): string[] {
  const problems: string[] = [];
  const enabled = items.filter((item) => !item.disabled);
  const weakestEnabled = Math.min(...enabled.map((item) => item.ratio));
  for (const item of items) {
    const name = `${where} > ${item.testId ?? item.text}`;
    if (!item.disabled && item.ratio < 4.5) {
      problems.push(`${name}: enabled item contrast ${item.ratio.toFixed(2)} < 4.5`);
    }
    if (item.disabled && !item.highlighted) {
      if (item.ratio < 2.5) {
        problems.push(`${name}: disabled item contrast ${item.ratio.toFixed(2)} < 2.5`);
      }
      if (enabled.length > 0 && item.ratio >= weakestEnabled) {
        problems.push(`${name}: disabled item is not dimmer than the enabled items`);
      }
    }
  }
  const highlighted = items.find((item) => item.highlighted);
  const plain = items.find((item) => !item.highlighted);
  if (highlighted && plain && highlighted.background === plain.background) {
    problems.push(`${where}: the highlighted item has the same background as the others`);
  }
  return problems;
}

/** Opens every menu-bar menu and every submenu; returns the contrast problems found. */
async function walkMenus(page: Page, where: string): Promise<string[]> {
  const problems: string[] = [];
  let submenusSeen = 0;
  for (const id of MENUS) {
    await page.getByTestId(`menu-${id}`).click();
    const popupId = `menu-${id}-popup`;
    await expect(page.getByTestId(popupId)).toBeVisible();
    problems.push(...problemsOf(await contrastOf(page, popupId), `${where} ${id}`));
    const submenus = await page
      .getByTestId(popupId)
      .locator(':scope > [aria-haspopup="true"]:not([aria-disabled="true"])')
      .all();
    for (const submenu of submenus) {
      const testId = await submenu.getAttribute('data-testid');
      await submenu.hover();
      const subPopupId = `${testId}-popup`;
      await expect(page.getByTestId(subPopupId)).toBeVisible();
      await expect(submenu).toHaveClass(/mfbe-menu-item-highlighted/);
      submenusSeen += 1;
      problems.push(...problemsOf(await contrastOf(page, subPopupId), `${where} ${testId}`));
    }
    // Escape closes an open submenu first, then the menu.
    for (let attempt = 0; attempt < 3 && (await page.getByTestId(popupId).count()) > 0; attempt++) {
      await page.keyboard.press('Escape');
    }
    await expect(page.getByTestId(popupId)).toHaveCount(0);
  }
  expect(submenusSeen, 'submenus opened').toBeGreaterThan(5);
  return problems;
}

/** Opens the Body and Document Tree context menus; returns the contrast problems found. */
async function walkContextMenus(page: Page, where: string): Promise<string[]> {
  const problems: string[] = [];
  const paragraph = page.getByTestId('body-editor').locator('p').first();
  await paragraph.click({ button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  problems.push(...problemsOf(await contrastOf(page, 'context-menu'), `${where} body menu`));
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('context-menu')).toHaveCount(0);

  await page.locator('.mfbe-tree-row').nth(1).click({ button: 'right' });
  await expect(page.getByTestId('tree-menu')).toBeVisible();
  problems.push(...problemsOf(await contrastOf(page, 'tree-menu'), `${where} tree menu`));
  await page.keyboard.press('Escape');
  return problems;
}

async function prepare(core: CoreHandle, page: Page, view: Record<string, unknown>): Promise<void> {
  await core.rpc('settings.set', { patch: { view } });
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  // A book makes the scripts available and puts an entry into File > Recent Files.
  await core.enqueueDialog('dialog.openFile', { paths: [fixtureBook('modern-utf8.fb2')] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, 'modern-utf8.fb2');
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
  await expect
    .poll(async () => page.evaluate(() => window.__mfbeTest?.scripts?.list().length ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
}

const SETUPS: ReadonlyArray<[name: string, view: Record<string, unknown>]> = [
  ['light theme, default Body colours', { theme: 'light' }],
  ['dark theme', { theme: 'dark' }],
  [
    'white Body text on black',
    { theme: 'light', bodyTextColor: '#ffffff', bodyBackground: '#000000' },
  ],
  [
    'navy Body text on dark',
    { theme: 'dark', bodyTextColor: '#000080', bodyBackground: '#202030' },
  ],
];

test.describe('US4 - every menu item is readable', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });
  test.afterEach(async ({ core }) => {
    if (core.hasCore) await core.rpc('settings.set', { patch: { view: null } }).catch(() => {});
  });

  for (const [name, view] of SETUPS) {
    test(`menus, submenus and context menus are readable: ${name}`, async ({ core, page }) => {
      test.setTimeout(180_000);
      await prepare(core, page, view);
      const problems = [...(await walkMenus(page, name)), ...(await walkContextMenus(page, name))];
      expect(problems).toEqual([]);
    });
  }

  test('high contrast: the highlighted item keeps a distinct background', async ({
    core,
    page,
  }) => {
    await prepare(core, page, { theme: 'light' });
    await page.emulateMedia({ forcedColors: 'active' });
    await page.getByTestId('menu-file').click();
    const items = page.getByTestId('menu-file-popup').locator(':scope > .mfbe-menu-item');
    await items.nth(1).hover();
    await expect(items.nth(1)).toHaveClass(/mfbe-menu-item-highlighted/);
    const contrast = await contrastOf(page, 'menu-file-popup');
    const highlighted = contrast.find((item) => item.highlighted);
    const plain = contrast.find((item) => !item.highlighted && !item.disabled);
    expect(highlighted).toBeDefined();
    expect(plain).toBeDefined();
    expect(highlighted!.background).not.toBe(plain!.background);
    expect(highlighted!.ratio).toBeGreaterThanOrEqual(4.5);
  });
});
