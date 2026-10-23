/**
 * US10 (feature 002) - the editor carries the original's licence and notices (FR-095 to FR-098):
 * Help > About names the GNU GPL version 3, shows the editor's copyright line, the
 * no-warranty and redistribution sentence, where to read the licence, and - in a scrollable
 * read-only box, as the original's About dialog did - the original's contributor notice
 * (CONTRIBUTORS.txt) word for word. On release 0.0.1 the dialog said "MIT License" and showed
 * no notices, so every check below fails there.
 *
 * Feature 005 (research R12.3; resource-formats §C): the Linux packages ship Mozilla's CA
 * certificate bundle for the assistant's TLS connections, so on Linux - by the running core's
 * `app.info().platform`, never the browser's - the dialog shows its notice
 * (`resources/certs/cacert.NOTICE.txt`) word for word in a third captioned box; the Windows and
 * macOS packages carry no bundle, and the third journey is skipped there.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, test, type CoreHandle } from './fixtures/core';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * A bundled notice as the dialog shows it (`src/dialogs/notices.ts`): LF line ends on every
 * platform - a Windows checkout gives the files CRLF - and without the final newline.
 */
function noticeText(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\n$/, '');
}

const CONTRIBUTORS = noticeText(readFileSync(path.join(REPO_ROOT, 'CONTRIBUTORS.txt'), 'utf8'));
/** The shipped CA bundle's notice as the dialog shows it. */
const CA_BUNDLE_NOTICE = noticeText(
  readFileSync(path.join(REPO_ROOT, 'resources', 'certs', 'cacert.NOTICE.txt'), 'utf8'),
);
const GPL_URL = 'https://www.gnu.org/licenses/gpl-3.0.html';

async function openAbout(core: CoreHandle, page: Page, lang?: 'ru'): Promise<void> {
  if (lang) {
    const url = new URL(core.baseURL);
    url.searchParams.set('lang', lang);
    await page.goto(url.toString());
    await page.getByTestId('app-root').waitFor();
  } else {
    await core.openApp(page);
  }
  await page.getByTestId('menu-help').click();
  await page.getByTestId('menu-help-about').click();
  await expect(page.getByTestId('dialog-about')).toBeVisible();
}

test.describe('US10 - licence and notices in the About dialog', () => {
  test('1. English: GPL-3.0, copyright, no warranty, where to read it, the original contributors', async ({
    core,
    page,
  }) => {
    await openAbout(core, page);
    await expect(page.getByTestId('about-licence')).toHaveText(
      'Licence: GNU General Public License version 3 (GPL-3.0-only)',
    );
    await expect(page.getByTestId('about-copyright')).toHaveText(
      'Copyright © 2026 Quark Zimmerman',
    );
    await expect(page.getByTestId('about-based-on')).toContainText('FictionBook Editor 2.7');
    const notice = page.getByTestId('about-gpl-notice');
    await expect(notice).toContainText('free software');
    await expect(notice).toContainText('GNU General Public License version 3');
    await expect(notice).toContainText('WITHOUT ANY WARRANTY');
    const link = page.getByTestId('about-licence-link');
    await expect(link).toHaveAttribute('href', GPL_URL);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(page.getByTestId('about-licence-where')).toContainText('LICENSE');

    const box = page.getByTestId('about-contributors');
    await expect(box).toHaveValue(CONTRIBUTORS);
    await expect(box).toHaveAttribute('readonly', '');
    // The e2e tsconfig has no DOM lib: browser-side probes are string snippets.
    const scroll = await page.evaluate<{ overflowY: string; scrollable: boolean }>(`(() => {
      const el = document.querySelector('[data-testid="about-contributors"]');
      return { overflowY: getComputedStyle(el).overflowY, scrollable: el.scrollHeight > el.clientHeight };
    })()`);
    expect(scroll.overflowY).toMatch(/auto|scroll/);
    expect(scroll.scrollable).toBe(true);
    await expect(page.getByTestId('dialog-about')).not.toContainText(/\bMIT\b/);
  });

  test('2. Russian: the same notices in Russian, the original contributor notice as written', async ({
    core,
    page,
  }) => {
    await openAbout(core, page, 'ru');
    await expect(page.getByTestId('about-licence')).toHaveText(
      'Лицензия: Стандартная общественная лицензия GNU версии 3 (GPL-3.0-only)',
    );
    await expect(page.getByTestId('about-copyright')).toHaveText(
      'Copyright © 2026 Quark Zimmerman',
    );
    const notice = page.getByTestId('about-gpl-notice');
    await expect(notice).toContainText('свободное программное обеспечение');
    await expect(notice).toContainText('БЕЗ КАКИХ-ЛИБО ГАРАНТИЙ');
    await expect(page.getByTestId('about-licence-link')).toHaveAttribute('href', GPL_URL);
    await expect(page.getByTestId('about-contributors')).toHaveValue(CONTRIBUTORS);
  });

  test('3. Linux: the notice of the shipped CA bundle, word for word, in a captioned box (feature 005)', async ({
    core,
    page,
  }) => {
    test.skip(
      !core.hasCore,
      'needs mfbe-core (MFBE_CORE_BIN): the box follows app.info().platform',
    );
    const { platform } = await core.rpc<{ platform: string }>('app.info');
    test.skip(
      platform !== 'linux',
      `the bundle ships with the Linux packages only (core: ${platform})`,
    );

    await openAbout(core, page);
    await expect(page.getByTestId('about-platform')).toHaveText('linux');
    const box = page.getByTestId('about-ca-bundle');
    await expect(box).toBeVisible();
    await expect(page.getByTestId('about-ca-bundle-caption')).toContainText(
      'Root certificate bundle',
    );
    const notice = page.getByTestId('about-ca-bundle-notice');
    await expect(notice).toHaveText(CA_BUNDLE_NOTICE);
    // `toHaveText` folds whitespace; the `<pre>` must carry the file's lines exactly.
    expect(await notice.textContent()).toBe(CA_BUNDLE_NOTICE);
    // The box is a scrollable region labelled by its caption, like the dictionaries' box.
    await expect(box).toHaveAttribute('role', 'region');
    const caption = await page.getByTestId('about-ca-bundle-caption').getAttribute('id');
    expect(caption).toBeTruthy();
    await expect(box).toHaveAttribute('aria-labelledby', caption!);
    const scroll = await page.evaluate<{ overflowY: string; scrollable: boolean }>(`(() => {
      const el = document.querySelector('[data-testid="about-ca-bundle"]');
      return { overflowY: getComputedStyle(el).overflowY, scrollable: el.scrollHeight > el.clientHeight };
    })()`);
    expect(scroll.overflowY).toMatch(/auto|scroll/);
    expect(scroll.scrollable).toBe(true);
  });
});
