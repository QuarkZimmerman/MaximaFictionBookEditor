/**
 * Feature 018, User Story 5 (T041, SC-006): ZIP export (store for MOBI/AZW3 + deflate for FBD),
 * untouched archive silent round-trip, modified archive FBD conflict prompt (The FBD's / The MOBI's
 * / Cancel), multi-book & multi-FBD choosers with None, bare foreign sibling FBD, bare own ignoring
 * sibling FBD, ZIP ignoring outside FBD, corrupt FBD recovery, and File > Open refusal vs FBD+MOBI.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';
import { findPython, inspectZipMethods } from './fixtures/mobi';
import { scratchDir } from './fixtures/scratch';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE_SCRIPT = path.join(REPO_ROOT, 'tests/fixtures/mobi/make-fixtures.py');

let foreignFixturesDir = '';

async function openBook(core: CoreHandle, page: Page, filePath: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [filePath] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  const savePrompt = page.getByTestId('dialog-save-changes');
  if (await savePrompt.isVisible({ timeout: 300 }).catch(() => false)) {
    await savePrompt.getByTestId('dialog-save-changes-button-no').click();
  }
  await waitForBook(page, filePath);
}

async function clickImportMobi(page: Page): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  await page.getByTestId('menu-file-import-importMobi').click();
}

async function waitExportDone(page: Page, targetPath: string): Promise<void> {
  const summary = page.getByTestId('dialog-mobi-export-summary');
  const failed = page.getByTestId('dialog-mobi-export-failed');
  const base = path.basename(targetPath);
  await expect
    .poll(
      async () => {
        if (await failed.isVisible())
          throw new Error(`Export failed: ${await failed.textContent()}`);
        if (await summary.isVisible()) {
          await summary.getByRole('button').first().click();
          return true;
        }
        const msg = (await page.getByTestId('status-message').textContent()) ?? '';
        return msg.includes('Exported to') && msg.includes(base);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

async function waitImportDone(
  page: Page,
  opts: { expectSummary?: boolean } = {},
): Promise<{ text: string; sawUnreadableFbd: boolean }> {
  const summary = page.getByTestId('dialog-mobi-import-summary');
  const failed = page.getByTestId('dialog-mobi-import-failed');
  const unreadable = page.getByTestId('dialog-mobi-fbd-unreadable');
  let text = '';
  let sawUnreadableFbd = false;
  await expect
    .poll(
      async () => {
        if (await failed.isVisible())
          throw new Error(`Import failed: ${await failed.textContent()}`);
        if (await unreadable.isVisible()) {
          sawUnreadableFbd = true;
          await unreadable.getByRole('button').first().click();
          return false;
        }
        if (await summary.isVisible()) {
          text = (await summary.textContent()) ?? '';
          await summary.getByRole('button').first().click();
          return true;
        }
        if (opts.expectSummary) return false;
        text = (await page.getByTestId('status-message').textContent()) ?? '';
        return text.includes('Imported from MOBI:');
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  return { text, sawUnreadableFbd };
}

function makeZip(
  zipPath: string,
  entries: Array<{ name: string; src: string; store?: boolean }>,
): void {
  execFileSync(
    findPython(),
    [
      '-c',
      `import json, sys, zipfile
entries = json.loads(sys.argv[2])
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    for e in entries:
        comp = zipfile.ZIP_STORED if e.get('store') else zipfile.ZIP_DEFLATED
        z.write(e['src'], arcname=e['name'], compress_type=comp)`,
      zipPath,
      JSON.stringify(entries),
    ],
    { stdio: 'pipe' },
  );
}

test.describe('US5 (feature 018) - ZIP export (store+deflate) & archive/sibling FBD workflows', () => {
  test.beforeAll(() => {
    foreignFixturesDir = scratchDir('mobi-us5-foreign-');
    execFileSync(findPython(), [FIXTURE_SCRIPT, '--out', foreignFixturesDir, '--no-oversized'], {
      stdio: 'pipe',
    });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('ZIP export packs MOBI uncompressed (store) + FBD compressed (deflate), untouched archive round-trips silently, modified FBD prompts conflict', async ({
    core,
    page,
  }) => {
    const dir = scratchDir('mobi-us5-zip-');
    await openBook(core, page, fixtureBook('reference-all-elements.fb2'));

    // 1. Export in ZIP archive
    const zipPath = path.join(dir, 'ref-bundle.zip');
    await core.enqueueDialog('dialog.saveFile', {
      path: zipPath,
      zip: true,
      selects: { format: 'mobi7', tocPlacement: 'afterTitle' },
    });
    await clickExport(core, page, 'exportMobi');
    await waitExportDone(page, zipPath);

    // Inspect ZIP entries and exact compression methods (0 = ZIP_STORED, 8 = ZIP_DEFLATED)
    const methods = inspectZipMethods(zipPath);
    expect(methods['ref-bundle.mobi']).toBe(0); // ZIP_STORED
    expect(methods['ref-bundle.fbd']).toBe(8); // ZIP_DEFLATED

    // 2. Untouched archive imports silently without conflict prompt!
    await core.enqueueDialog('dialog.openFile', { paths: [zipPath] });
    await clickImportMobi(page);
    await waitImportDone(page);
    expect(await page.getByTestId('dialog-mobi-fbd-conflict').isVisible()).toBe(false);
    await page.getByRole('button', { name: 'Description' }).click();
    await expect(page.locator('input[value="The Reference Book"]').first()).toBeVisible();

    // 3. Create modified archive where ref-bundle.fbd has a different <book-title>
    const modZip = path.join(dir, 'modified-fbd.zip');
    execFileSync(
      findPython(),
      [
        '-c',
        `import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as zin, zipfile.ZipFile(sys.argv[2], 'w') as zout:
    for info in zin.infolist():
        data = zin.read(info.filename)
        if info.filename.endswith('.fbd'):
            data = data.replace(b'The Reference Book', b'Modified Archive FBD Title', 1)
            zout.writestr(info.filename, data, compress_type=zipfile.ZIP_DEFLATED)
        else:
            zout.writestr(info.filename, data, compress_type=zipfile.ZIP_STORED)`,
        zipPath,
        modZip,
      ],
      { stdio: 'pipe' },
    );

    // Open modern-utf8.fb2 first so we can prove Cancel leaves the window book untouched
    await openBook(core, page, fixtureBook('modern-utf8.fb2'));
    await page.getByRole('button', { name: 'Body' }).click();
    await expect(page.locator('.ProseMirror')).toContainText('Современная книга');

    // 3a. Conflict -> Cancel leaves window book untouched!
    await core.enqueueDialog('dialog.openFile', { paths: [modZip] });
    await clickImportMobi(page);
    const conflict = page.getByTestId('dialog-mobi-fbd-conflict');
    await expect(conflict).toBeVisible({ timeout: 20_000 });
    await conflict.getByTestId('dialog-mobi-fbd-conflict-button-cancel').click();
    await expect(conflict).toBeHidden();
    await expect(page.getByTestId('status-message')).toContainText(/cancelled/i);
    await expect(page.locator('.ProseMirror')).toContainText('Современная книга');

    // 3b. Conflict -> The MOBI's (no button) keeps embedded MFBE title
    await core.enqueueDialog('dialog.openFile', { paths: [modZip] });
    await clickImportMobi(page);
    await expect(conflict).toBeVisible({ timeout: 20_000 });
    await conflict.getByTestId('dialog-mobi-fbd-conflict-button-no').click();
    await waitImportDone(page);
    await page.getByRole('button', { name: 'Description' }).click();
    await expect(page.locator('input[value="The Reference Book"]').first()).toBeVisible();

    // 3c. Conflict -> The FBD's (yes button) applies modified archive FBD title
    await core.enqueueDialog('dialog.openFile', { paths: [modZip] });
    await clickImportMobi(page);
    const savePrompt = page.getByTestId('dialog-save-changes');
    if (await savePrompt.isVisible({ timeout: 500 }).catch(() => false)) {
      await savePrompt.getByTestId('dialog-save-changes-button-no').click();
    }
    await expect(conflict).toBeVisible({ timeout: 20_000 });
    await conflict.getByTestId('dialog-mobi-fbd-conflict-button-yes').click();
    const appliedRes = await waitImportDone(page, { expectSummary: true });
    expect(appliedRes.text).toContain('ref-bundle.fbd');
    await page.getByRole('button', { name: 'Description' }).click();
    await expect(page.locator('input[value="Modified Archive FBD Title"]').first()).toBeVisible();

    // 4. File > Open refuses MOBI-only ZIP while opening FBD+MOBI ZIP cleanly!
    const mobiBytesPath = path.join(dir, 'only.mobi');
    execFileSync(
      findPython(),
      [
        '-c',
        `import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    open(sys.argv[2], 'wb').write(z.read('ref-bundle.mobi'))`,
        zipPath,
        mobiBytesPath,
      ],
      { stdio: 'pipe' },
    );
    const mobiOnlyZip = path.join(dir, 'mobi-only.zip');
    makeZip(mobiOnlyZip, [{ name: 'only.mobi', src: mobiBytesPath, store: true }]);

    await core.enqueueDialog('dialog.openFile', { paths: [mobiOnlyZip] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    if (await savePrompt.isVisible({ timeout: 500 }).catch(() => false)) {
      await savePrompt.getByTestId('dialog-save-changes-button-no').click();
    }
    const refused = page.getByTestId('dialog-archive-error');
    await expect(refused).toBeVisible({ timeout: 15_000 });
    await expect(refused).toContainText('File > Import > MOBI File');
    await refused.getByRole('button').first().click();

    // Opening FBD+MOBI ZIP via File > Open opens the FBD directly!
    await core.enqueueDialog('dialog.openFile', { paths: [zipPath] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    if (await savePrompt.isVisible({ timeout: 500 }).catch(() => false)) {
      await savePrompt.getByTestId('dialog-save-changes-button-no').click();
    }
    await expect(page).toHaveTitle(/^ref-bundle\.fbd \(ref-bundle\.zip\)/);
    await page.getByRole('button', { name: 'Description' }).click();
    await expect(page.locator('input[value="The Reference Book"]').first()).toBeVisible();
  });

  test('multi-book & multi-FBD choosers, bare foreign vs own sibling FBD, ZIP ignoring outside FBD, and corrupt FBD recovery', async ({
    core,
    page,
  }) => {
    const dir = scratchDir('mobi-us5-choosers-');
    const foreign1 = path.join(foreignFixturesDir, 'mobi7-uncompressed.mobi');
    const foreign2 = path.join(foreignFixturesDir, 'mobi7-palmdoc.mobi');
    const descriptorFbd = fixtureBook('descriptor.fbd');

    // Make a second distinct FBD
    const secondFbd = path.join(dir, 'second.fbd');
    const fbdXml = readFileSync(descriptorFbd, 'utf8').replace(
      'Только описание',
      'Second Archive Descriptor',
    );
    writeFileSync(secondFbd, fbdXml, 'utf8');

    // 1. Multi-book + matched-stem FBD chooser
    const multiMatchedZip = path.join(dir, 'multi-matched.zip');
    makeZip(multiMatchedZip, [
      { name: 'alpha.mobi', src: foreign1, store: true },
      { name: 'beta.mobi', src: foreign2, store: true },
      { name: 'alpha.fbd', src: descriptorFbd },
      { name: 'beta.fbd', src: secondFbd },
    ]);
    await core.enqueueDialog('dialog.openFile', { paths: [multiMatchedZip] });
    await clickImportMobi(page);
    const bookChooser = page.getByRole('dialog').filter({ hasText: 'beta.mobi' });
    await expect(bookChooser).toBeVisible({ timeout: 15_000 });
    await bookChooser.getByText('beta.mobi').click();
    await bookChooser.getByRole('button', { name: 'OK' }).click();
    const matchedRes = await waitImportDone(page);
    expect(matchedRes.text).toContain('beta.fbd');
    await page.getByRole('button', { name: 'Description' }).click();
    await expect(page.locator('input[value="Second Archive Descriptor"]').first()).toBeVisible();

    // 2. Unmatched multi-FBD ZIP -> FBD chooser with None; also place outside <zip>.fbd to prove it is ignored!
    const unmatchedZip = path.join(dir, 'unmatched.zip');
    makeZip(unmatchedZip, [
      { name: 'novel.mobi', src: foreign1, store: true },
      { name: 'first.fbd', src: descriptorFbd },
      { name: 'second.fbd', src: secondFbd },
    ]);
    copyFileSync(descriptorFbd, path.join(dir, 'unmatched.fbd'));

    await core.enqueueDialog('dialog.openFile', { paths: [unmatchedZip] });
    await clickImportMobi(page);
    const savePrompt = page.getByTestId('dialog-save-changes');
    if (await savePrompt.isVisible({ timeout: 500 }).catch(() => false)) {
      await savePrompt.getByTestId('dialog-save-changes-button-no').click();
    }
    const fbdChooser = page.getByRole('dialog').filter({ hasText: 'first.fbd' });
    await expect(fbdChooser).toBeVisible({ timeout: 15_000 });
    await fbdChooser.getByText(/None/).click();
    await fbdChooser.getByRole('button', { name: 'OK' }).click();
    await waitImportDone(page);
    // Kept MOBI's own title ("Uncompressed Sample"), NOT descriptorFbd or unmatched.fbd!
    await page.getByRole('button', { name: 'Description' }).click();
    await expect(page.locator('input[value="Uncompressed Sample"]').first()).toBeVisible();

    // 3. Bare foreign MOBI beside sibling .fbd -> applies sibling .fbd silently!
    const bareForeign = path.join(dir, 'foreign-book.mobi');
    copyFileSync(foreign1, bareForeign);
    copyFileSync(descriptorFbd, path.join(dir, 'foreign-book.fbd'));
    await core.enqueueDialog('dialog.openFile', { paths: [bareForeign] });
    await clickImportMobi(page);
    if (await savePrompt.isVisible({ timeout: 500 }).catch(() => false)) {
      await savePrompt.getByTestId('dialog-save-changes-button-no').click();
    }
    const sibRes = await waitImportDone(page, { expectSummary: true });
    expect(sibRes.text).toContain('foreign-book.fbd');
    await page.getByRole('button', { name: 'Description' }).click();
    await expect(page.locator('input[value="Только описание"]').first()).toBeVisible();

    // 4. Bare editor-made MOBI beside sibling .fbd -> IGNORES sibling .fbd!
    await openBook(core, page, fixtureBook('reference-all-elements.fb2'));
    const bareOwn = path.join(dir, 'own-book.mobi');
    await core.enqueueDialog('dialog.saveFile', {
      path: bareOwn,
      zip: false,
      selects: { format: 'mobi7', tocPlacement: 'afterTitle' },
    });
    await clickExport(core, page, 'exportMobi');
    await waitExportDone(page, bareOwn);
    copyFileSync(descriptorFbd, path.join(dir, 'own-book.fbd'));

    await core.enqueueDialog('dialog.openFile', { paths: [bareOwn] });
    await clickImportMobi(page);
    await waitImportDone(page);
    await page.getByRole('button', { name: 'Description' }).click();
    await expect(page.locator('input[value="The Reference Book"]').first()).toBeVisible();

    // 5. Corrupt sibling .fbd beside bare foreign MOBI -> warning dialog + continues importing!
    const corruptMobi = path.join(dir, 'corrupt-sib.mobi');
    copyFileSync(foreign1, corruptMobi);
    writeFileSync(path.join(dir, 'corrupt-sib.fbd'), '<FictionBook><broken<<<', 'utf8');
    await core.enqueueDialog('dialog.openFile', { paths: [corruptMobi] });
    await clickImportMobi(page);
    if (await savePrompt.isVisible({ timeout: 500 }).catch(() => false)) {
      await savePrompt.getByTestId('dialog-save-changes-button-no').click();
    }
    const unreadable = page.getByTestId('dialog-mobi-fbd-unreadable');
    await expect(unreadable).toBeVisible({ timeout: 20_000 });
    await unreadable.getByRole('button').first().click();
    await waitImportDone(page);
    await page.getByRole('button', { name: 'Description' }).click();
    await expect(page.locator('input[value="Uncompressed Sample"]').first()).toBeVisible();
  });
});
