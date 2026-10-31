/**
 * Feature 007, User Story 8 - icons in the Scripts menu (T124; quickstart §5; FR-040 to FR-044;
 * data-model §6; contracts/rpc-api.md §2 of the feature). Needs the real core (`MFBE_CORE_BIN`)
 * for the group icon route; skipped otherwise.
 *
 *  1. Every group of the Scripts menu that has an icon shows it left of its name - its image
 *     is requested from `/script-groups/<folder>/icon` and answered 200 - and a group without
 *     one shows none; the bundled groups with a declared icon are among them.
 *  2. In a group's submenu every script with an icon shows it, the others none, and the names
 *     stay aligned; a user's own group and script that declare an icon show it the same way,
 *     at 16 × 16 CSS pixels.
 *  3. The Scripts toolbar's Customize dialog offers every script that has an icon (FR-044); its
 *     default layout stays "Last script" alone.
 *  4. At 1x and 2x a menu icon is drawn as the Scripts toolbar draws the same icon: 16 × 16 CSS
 *     pixels, with the toolbar's image rendering (FR-043).
 */

import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, test, type CoreHandle } from './fixtures/core';
import { pageText } from './fixtures/i18n';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
/** A 16 × 16 PNG of the script fixtures. */
const ICON_PNG = path.join(
  REPO_ROOT,
  'tests',
  'scripts',
  'fixtures',
  '01_Case',
  '01_Upper',
  'icon.png',
);

/** The user's own group of the journey (the last one of the menu, after 95 and 99). */
const USER_GROUP = '98_us8-icons';

interface CoreScript {
  id: string;
  kind: string;
  iconUrl?: string;
}

interface CoreGroup {
  id: string;
  icon?: string;
  iconUrl?: string;
  scripts: CoreScript[];
}

async function coreGroups(core: CoreHandle): Promise<CoreGroup[]> {
  return (await core.rpc<{ groups: CoreGroup[] }>('scripts.list')).groups;
}

/** The groups the Scripts menu shows: those with a menu script, the tree commands aside. */
const menuGroups = (groups: CoreGroup[]) =>
  groups.filter((group) => group.id !== '' && group.scripts.some((s) => s.kind === 'menu'));

/** The image of a menu item's left column (null without one). */
async function itemImage(page: Page, testId: string) {
  const image = page.getByTestId(testId).locator(':scope > .mfbe-menu-check img');
  return (await image.count()) > 0 ? image : null;
}

/** The left edge of each item's name in an open (sub)menu: equal for aligned names. */
function labelLefts(page: Page, popupTestId: string): Promise<number[]> {
  return page
    .getByTestId(popupTestId)
    .locator(':scope > [role="menuitem"] > .mfbe-menu-label')
    .evaluateAll((labels) => labels.map((label) => Math.round(label.getBoundingClientRect().left)));
}

test.describe('US8 (007) - icons in the Scripts menu', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    // The user's own group: its icon declared in group.json, one script with an icon, one
    // without.
    const group = path.join(core.dataDir!, 'scripts', USER_GROUP);
    rmSync(group, { recursive: true, force: true });
    mkdirSync(path.join(group, '01_with-icon'), { recursive: true });
    mkdirSync(path.join(group, '02_without-icon'), { recursive: true });
    copyFileSync(ICON_PNG, path.join(group, 'icon.png'));
    writeFileSync(
      path.join(group, 'group.json'),
      JSON.stringify({ names: { en: 'US8 icons', ru: 'Значки US8' }, icon: 'icon.png' }),
    );
    const entry = 'export default async function run() { await mfbe.ui.status("us8"); }\n';
    copyFileSync(ICON_PNG, path.join(group, '01_with-icon', 'icon.png'));
    writeFileSync(
      path.join(group, '01_with-icon', 'script.json'),
      JSON.stringify({
        manifestVersion: 1,
        id: 'us8.with-icon',
        name: { en: 'With an icon', ru: 'Со значком' },
        kind: 'menu',
        icon: 'icon.png',
      }),
    );
    writeFileSync(path.join(group, '01_with-icon', 'index.js'), entry);
    writeFileSync(
      path.join(group, '02_without-icon', 'script.json'),
      JSON.stringify({
        manifestVersion: 1,
        id: 'us8.without-icon',
        name: { en: 'Without an icon', ru: 'Без значка' },
        kind: 'menu',
      }),
    );
    writeFileSync(path.join(group, '02_without-icon', 'index.js'), entry);
    await core.rpc('scripts.reload');
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    rmSync(path.join(core.dataDir!, 'scripts', USER_GROUP), { recursive: true, force: true });
    await core.rpc('scripts.reload').catch(() => {});
    await core
      .rpc('settings.set', { patch: { session: { toolbarLayouts: null } } })
      .catch(() => {});
  });

  test('1-2. group and script icons left of the names, requested from the group icon route; none where there is no icon; the names aligned', async ({
    core,
    page,
  }) => {
    const responses: { url: string; status: number }[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/script-groups/')) {
        responses.push({ url: response.url(), status: response.status() });
      }
    });
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    const groups = menuGroups(await coreGroups(core));
    const withIcon = groups.filter((group) => group.iconUrl);
    // The user's group and a bundled one that declares its icon.
    expect(withIcon.map((group) => group.id)).toContain(USER_GROUP);
    expect(withIcon.some((group) => group.id !== USER_GROUP)).toBe(true);

    await page.getByTestId('menu-scripts').click();
    await expect(page.getByTestId('menu-scripts-popup')).toBeVisible();
    for (const group of groups) {
      const image = await itemImage(page, `menu-scripts-${group.id}`);
      if (!group.iconUrl) {
        expect(image, `${group.id}: no icon`).toBeNull();
        continue;
      }
      expect(image, `${group.id}: its icon`).not.toBeNull();
      const src = (await image!.getAttribute('src'))!;
      expect(new URL(src, page.url()).pathname).toBe(group.iconUrl);
      await expect(image!).toHaveAttribute('width', '16');
      await expect(image!).toHaveAttribute('height', '16');
      await expect
        .poll(() =>
          image!.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth),
        )
        .toBe(16);
    }
    // Every group image came from the route, with 200.
    await expect
      .poll(() => new Set(responses.map((r) => new URL(r.url).pathname)).size)
      .toBe(withIcon.length);
    for (const response of responses) {
      expect(response.status, response.url).toBe(200);
      expect(new URL(response.url).pathname).toMatch(/^\/script-groups\/[^/]+\/icon$/);
    }
    // All names of the top level start at one left edge, with and without an icon.
    expect(new Set(await labelLefts(page, 'menu-scripts-popup')).size).toBe(1);

    // The user's group: the script with an icon shows it at 16 × 16, the other none.
    await page.getByTestId(`menu-scripts-${USER_GROUP}`).hover();
    const submenu = `menu-scripts-${USER_GROUP}-popup`;
    await expect(page.getByTestId(submenu)).toBeVisible();
    const scriptImage = await itemImage(page, `menu-scripts-${USER_GROUP}-us8.with-icon`);
    expect(scriptImage).not.toBeNull();
    expect(new URL((await scriptImage!.getAttribute('src'))!, page.url()).pathname).toBe(
      '/scripts/us8.with-icon/icon.png',
    );
    await expect
      .poll(() =>
        scriptImage!.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth),
      )
      .toBe(16);
    const box = (await scriptImage!.boundingBox())!;
    expect(Math.round(box.width)).toBe(16);
    expect(Math.round(box.height)).toBe(16);
    expect(await itemImage(page, `menu-scripts-${USER_GROUP}-us8.without-icon`)).toBeNull();
    expect(new Set(await labelLefts(page, submenu)).size).toBe(1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // A bundled group's submenu: its scripts with icons show them, the others none.
    const bundled = withIcon.find((group) => group.id !== USER_GROUP)!;
    await page.getByTestId('menu-scripts').click();
    await page.getByTestId(`menu-scripts-${bundled.id}`).hover();
    await expect(page.getByTestId(`menu-scripts-${bundled.id}-popup`)).toBeVisible();
    for (const script of bundled.scripts.filter((s) => s.kind === 'menu')) {
      const image = await itemImage(page, `menu-scripts-${bundled.id}-${script.id}`);
      if (script.iconUrl) {
        expect(image, `${script.id}: its icon`).not.toBeNull();
        expect(new URL((await image!.getAttribute('src'))!, page.url()).pathname).toBe(
          script.iconUrl,
        );
      } else {
        expect(image, `${script.id}: no icon`).toBeNull();
      }
    }
    expect(new Set(await labelLefts(page, `menu-scripts-${bundled.id}-popup`)).size).toBe(1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  test('3. the Scripts toolbar offers every script with an icon; its default layout is "Last script" alone (FR-044)', async ({
    core,
    page,
  }) => {
    await core.rpc('settings.set', { patch: { session: { toolbarLayouts: null } } });
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    // Every menu script with an icon, the ungrouped ones too, in menu order.
    const withIcons = (await coreGroups(core))
      .flatMap((group) => group.scripts)
      .filter((script) => script.kind === 'menu' && script.iconUrl)
      .map((script) => `script.${script.id}`);
    expect(withIcons).toContain('script.us8.with-icon');
    const toolbar = page.getByTestId('toolbar-scripts');
    await expect(toolbar.locator('[data-toolbar-index]')).toHaveCount(1);
    await expect(page.getByTestId('toolbar-scripts.last')).toBeVisible();
    await toolbar.locator('[data-toolbar-index]').first().click({ button: 'right' });
    await page.getByTestId('toolbar-menu-customize').click();
    await expect(page.getByTestId('dialog-customize-toolbar')).toBeVisible();
    const offered = await page
      .getByTestId('customize-toolbar-available')
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.getAttribute('data-item') ?? ''));
    expect(offered.filter((item) => item.startsWith('script.'))).toEqual(withIcons);
    expect(offered).not.toContain('script.us8.without-icon');
    await page.getByTestId('dialog-customize-toolbar-button-close').click();
    await expect(page.getByTestId('dialog-customize-toolbar')).toHaveCount(0);
  });

  for (const dpr of [1, 2] as const) {
    test.describe(`at ${dpr}x`, () => {
      test.use({ deviceScaleFactor: dpr });

      test(`4. a menu icon is drawn as the Scripts toolbar draws it, 16 x 16 CSS pixels (FR-043, ${dpr}x)`, async ({
        core,
        page,
      }) => {
        await core.rpc('settings.set', {
          patch: {
            session: { toolbarLayouts: { scripts: ['scripts.last', 'script.us8.with-icon'] } },
          },
        });
        await core.openApp(page);
        expect(await page.evaluate<number>('window.devicePixelRatio')).toBe(dpr);
        const drawn = (selector: string) =>
          page.locator(selector).evaluate((img) => {
            const image = img as unknown as {
              naturalWidth: number;
              getBoundingClientRect(): { width: number; height: number };
            };
            const box = image.getBoundingClientRect();
            return {
              natural: image.naturalWidth,
              width: box.width,
              height: box.height,
              rendering: (
                globalThis as unknown as {
                  getComputedStyle(element: unknown): { imageRendering: string };
                }
              ).getComputedStyle(img).imageRendering,
            };
          });
        const toolbarImage = '[data-testid="scripts-toolbar-us8.with-icon"] img';
        await expect(page.locator(toolbarImage)).toBeVisible();
        await expect.poll(async () => (await drawn(toolbarImage)).natural).toBe(16);
        await page.getByTestId('menu-scripts').click();
        await page.getByTestId(`menu-scripts-${USER_GROUP}`).hover();
        const menuImage = `[data-testid="menu-scripts-${USER_GROUP}-us8.with-icon"] > .mfbe-menu-check img`;
        await expect(page.locator(menuImage)).toBeVisible();
        await expect.poll(async () => (await drawn(menuImage)).natural).toBe(16);
        const inMenu = await drawn(menuImage);
        const onToolbar = await drawn(toolbarImage);
        expect(inMenu).toEqual(onToolbar);
        expect(inMenu).toMatchObject({ width: 16, height: 16 });
        expect(inMenu.rendering).toBe(dpr >= 2 ? 'pixelated' : 'auto');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
      });
    });
  }
});
