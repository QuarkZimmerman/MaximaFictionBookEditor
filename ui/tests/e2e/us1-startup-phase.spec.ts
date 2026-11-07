/**
 * Feature 010, US1 (T033): a start-up without a half-working window (D1, D2). With the core's
 * answers held back, the window says "Starting..." in the views, the tree and the status bar;
 * the menus open nothing, the toolbar's commands are greyed and hotkeys do nothing; once the
 * template is shown everything works.
 */

import { APP_TITLE, expect, test } from './fixtures/core';
import { pageText } from './fixtures/i18n';
import { MOD } from './fixtures/keys';

test.describe('US1 (010) - a start-up without a half-working window', () => {
  test('1, 2. held answers: nothing acts and the window says Starting...; then the template and everything works', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    const starting = await pageText(page, 'app.starting');
    const requestsBefore = await core.rpc<unknown[]>('test.dialogRequests');

    await core.rpc('test.holdStartup', { ms: 2500 });
    await page.reload();
    const root = page.getByTestId('app-root');
    await expect(root).toHaveAttribute('data-startup', 'starting');
    await expect(page.getByTestId('status-message')).toHaveText(starting);
    await expect(page.getByTestId('panel-body-empty')).toHaveText(starting);
    await expect(page.getByTestId('panel-tree-empty')).toHaveText(starting);

    // The menus open nothing, the toolbar's commands are greyed, a hotkey does nothing.
    await page.getByTestId('menu-file').click();
    await expect(page.getByTestId('menu-file-popup')).toHaveCount(0);
    await expect(page.getByTestId('toolbar-file.open')).toBeDisabled();
    await page.keyboard.press(`${MOD}+o`);
    expect(await core.rpc<unknown[]>('test.dialogRequests')).toHaveLength(requestsBefore.length);

    // The template arrives: the window works.
    await expect(root).toHaveAttribute('data-startup', 'ready', { timeout: 15_000 });
    await expect(page).toHaveTitle(`${await pageText(page, 'app.untitled')} - ${APP_TITLE}`);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    await expect(page.getByTestId('toolbar-file.open')).toBeEnabled();
    await page.getByTestId('menu-file').click();
    await expect(page.getByTestId('menu-file-popup')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
