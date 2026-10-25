/**
 * Smoke journey: the shell loads, the eight menus of the original editor are visible with their
 * English labels, the Commands toolbar has the File > New button and the status bar reports the
 * core connection ("Ready" with a core, "Not connected" in core-less mode).
 */

import { expect, fileNew, test, waitForStartupDocument, type RpcCallError } from './fixtures/core';
import { label } from './fixtures/keys';

const MENUS: ReadonlyArray<[id: string, label: string]> = [
  ['file', 'File'],
  ['edit', 'Edit'],
  ['view', 'View'],
  ['add', 'Add'],
  ['style', 'Style'],
  ['tools', 'Tools'],
  ['scripts', 'Scripts'],
  ['help', 'Help'],
];

test.describe('smoke', () => {
  test('page loads with the eight menus, the Commands toolbar and the status bar', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    // With a core the editor starts with a new document (feature 002).
    if (core.hasCore) await waitForStartupDocument(page);
    else await expect(page).toHaveTitle('Maxima Fiction Book Editor');

    for (const [id, label] of MENUS) {
      const menu = page.getByTestId(`menu-${id}`);
      await expect(menu).toBeVisible();
      await expect(menu).toHaveText(label);
    }
    await expect(page.getByTestId('menubar').getByRole('menuitem')).toHaveCount(MENUS.length);

    await expect(page.getByTestId('toolbar-commands')).toBeVisible();
    await expect(page.getByTestId('toolbar-file.new')).toBeVisible();
    await expect(page.getByTestId('toolbar-file.new')).toHaveAttribute('title', 'New');
    await expect(page.getByTestId('toolbar-file.new').locator('img')).toHaveJSProperty(
      'naturalWidth',
      24,
    );

    await expect(page.getByTestId('view-body')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('panel-tree-caption')).toHaveText('Document structure');
    await expect(page.getByTestId('status-insmode')).toHaveText('INS');

    if (core.hasCore) {
      await expect(page.getByTestId('status-message')).toHaveText('Ready');
      await expect(page.getByTestId('toolbar-file.new')).toBeEnabled();
    } else {
      await expect(page.getByTestId('status-message')).toHaveText('Not connected');
      await expect(page.getByTestId('toolbar-file.new')).toBeDisabled();
    }
  });

  test('menus open with the mouse and the keyboard and close with Escape', async ({
    core,
    page,
  }) => {
    await core.openApp(page);

    await page.getByTestId('menu-file').click();
    await expect(page.getByTestId('menu-file-popup')).toBeVisible();
    await expect(page.getByTestId('menu-file-new').locator('.mfbe-menu-label')).toHaveText('New');
    await expect(page.getByTestId('menu-file-exit').locator('.mfbe-menu-label')).toHaveText('Exit');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu-file-popup')).toBeHidden();

    await page.keyboard.press('Alt+V');
    await expect(page.getByTestId('menu-view-popup')).toBeVisible();
    await expect(page.getByTestId('menu-view-statusBar')).toHaveAttribute('data-checked', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('menu-add-popup')).toBeVisible();
    await expect(page.getByTestId('menu-add-body').locator('.mfbe-menu-label')).toHaveText('Body');
    await expect(page.getByTestId('menu-add-body').locator('.mfbe-menu-hotkey')).toHaveText(
      label('Alt+Shift+B'),
    );
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu-add-popup')).toBeHidden();
  });

  test('the view switcher and View menu change the active view', async ({ core, page }) => {
    await core.openApp(page);
    if (core.hasCore) await waitForStartupDocument(page);
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('panel-source')).toBeVisible();
    await expect(page.getByTestId('toolbar-view.source')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Alt+F1'); // FBE default: View > Description
    await expect(page.getByTestId('panel-description')).toBeVisible();
    await page.getByTestId('menu-view').click();
    await page.getByTestId('menu-view-body').click();
    await expect(page.getByTestId('panel-body')).toBeVisible();
  });

  test('Help > About opens a dialog that closes with Enter', async ({ core, page }) => {
    await core.openApp(page);
    await page.getByTestId('menu-help').click();
    await page.getByTestId('menu-help-about').click();
    const about = page.getByTestId('dialog-about');
    await expect(about).toBeVisible();
    await expect(page.getByTestId('about-name')).toContainText('Maxima Fiction Book Editor');
    if (core.hasCore) {
      // Feature 006 (FR-055): the running core's version label and build id, e.g. "0.0.6-rc"
      // and "0.0.6-rc+<hash>".
      const info = await core.rpc<{ version: string; build: string }>('app.info');
      await expect(page.getByTestId('about-version')).toContainText(info.version);
      await expect(page.getByTestId('about-build')).toHaveText(info.build);
    }
    await expect(page.getByTestId('dialog-about-button-close')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(about).toBeHidden();
  });

  test('the core answers app.info over the test RPC helper', async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    const info = await core.rpc<{
      apiVersion: number;
      apiMinor: number;
      version: string;
      build: string;
      gitHash: string;
    }>('app.info');
    expect(info.apiVersion).toBe(1);
    expect(info.apiMinor).toBe(4);
    // Feature 006 (FR-055, decision 14): the version label - 0.0.6-rc untagged, 0.0.6-rc.N from a
    // release tag - and the build id, the label, "+" and the commit hash.
    expect(info.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
    expect(info.build).toBe(`${info.version}+${info.gitHash}`);
  });

  test('File > New creates a document and File > Open consumes a queued native dialog', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    // doc.new arrives with US1 (T045); until then the core answers -32601.
    const supportsDocNew = await core
      .rpc('doc.new')
      .then(() => true)
      .catch((error: RpcCallError) => error.code !== -32601);
    test.skip(!supportsDocNew, 'the core does not implement doc.new yet (US1)');

    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');

    await fileNew(page);
    await expect(page.getByTestId('panel-body-document')).toBeVisible();
    await expect(page).toHaveTitle('Untitled - Maxima Fiction Book Editor');

    // The queued answer cancels the file dialog: nothing changes, no error is shown.
    await core.enqueueDialog('dialog.openFile', { paths: [] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    // The worker's later tests share this core: an answer still queued when the test ends would
    // cancel their next File > Open.
    await expect
      .poll(async () => (await core.rpc<{ pendingDialogs: number }>('test.metrics')).pendingDialogs)
      .toBe(0);
    await expect(page.getByTestId('panel-body-document')).toBeVisible();
    await expect(page.getByTestId('dialog-layer')).toBeHidden();
  });
});
