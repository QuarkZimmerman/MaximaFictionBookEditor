/**
 * US10 (feature 002) - the editor carries the original's licence and notices (FR-095 to FR-098):
 * Help > About names the GNU GPL version 3, shows the editor's copyright line, the
 * no-warranty and redistribution sentence, where to read the licence, and - in a scrollable
 * read-only box, as the original's About dialog did - the original's contributor notice
 * (CONTRIBUTORS.txt) word for word. On release 0.0.1 the dialog said "MIT License" and showed
 * no notices, so every check below fails there.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, test, type CoreHandle } from './fixtures/core';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CONTRIBUTORS = readFileSync(path.join(REPO_ROOT, 'CONTRIBUTORS.txt'), 'utf8').replace(
  /\n$/,
  '',
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
});
