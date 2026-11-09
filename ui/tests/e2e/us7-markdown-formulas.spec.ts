/**
 * Feature 011 (D50, FR-075b, SC-022) - formulas of an imported Markdown file become pictures, drawn
 * offline by the bundled MathJax: an inline one in its line (small), block ones of their own; a price
 * stays text, a formula that cannot be drawn stays as written and is listed; exported again, the
 * formulas come back as written.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/core';

interface Binary {
  id: string;
  contentType: string;
  size: number;
}

declare const window: {
  __mfbeTest?: {
    scripts?: { toXml(): Promise<string>; document(): { binaries: Binary[] } | null };
  };
};

const INLINE = 'e^{i\\pi} + 1 = 0';
const BLOCK = '\\int_0^1 x^2\\,dx = \\frac{1}{3}';
const MATH = 'a^2 + b^2 = c^2';
const BROKEN = '\\frac{1';

const MARKDOWN = `# Formulas

Euler's identity $${INLINE}$ is short; it costs $5 or $10.

$$
${BLOCK}
$$

\`\`\`math
${MATH}
\`\`\`

A broken one: $${BROKEN}$.
`;

const xml = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.toXml());
const binaries = (page: Page) =>
  page.evaluate(() => window.__mfbeTest!.scripts!.document()?.binaries ?? []);

test.describe('US7 (feature 011) - formulas on import', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-011-formulas-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('formulas become pictures, a price stays text, a broken one is listed; the export gives them back', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    const source = path.join(dir, 'formulas.md');
    writeFileSync(source, MARKDOWN, 'utf8');
    await core.openApp(page);
    await core.enqueueDialog('dialog.openFile', { paths: [source] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    await page.getByTestId('menu-file-import-importMarkdown').click();
    const summary = page.getByTestId('dialog-markdown-summary');
    await expect(summary).toBeVisible({ timeout: 60_000 });
    await expect(summary).toContainText('Formula kept as written');
    await page.keyboard.press('Enter');

    await expect
      .poll(async () => (await binaries(page)).filter((b) => b.id.startsWith('formula-')).length)
      .toBe(3);
    for (const picture of (await binaries(page)).filter((b) => b.id.startsWith('formula-'))) {
      console.log(`formula ${picture.id}: ${picture.contentType}, ${picture.size} bytes`);
      test.info().annotations.push({
        type: 'formula',
        description: `${picture.id}: ${picture.contentType}, ${picture.size} bytes`,
      });
      expect(['image/png', 'image/jpeg']).toContain(picture.contentType);
    }
    const inline = (await binaries(page)).find((b) => b.id === 'formula-1')!;
    expect(inline.size).toBeLessThan(10 * 1024);
    const book = await xml(page);
    expect(book).toContain('costs $5 or $10.');
    expect(book).toContain('<image l:href="#formula-1"');
    expect(book).toContain(`$${BROKEN}$`);

    const target = path.join(dir, 'again.md');
    await core.enqueueDialog('dialog.saveFile', { path: target });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-export').hover();
    await page.getByTestId('menu-file-export-exportMarkdown').click();
    const question = page.getByTestId('dialog-markdown-pictures');
    await expect(question).toBeVisible({ timeout: 15_000 });
    await question.getByTestId('dialog-markdown-pictures-button-yes').click();
    await expect(page.getByTestId('status-message')).toContainText(`Exported to ${target}:`, {
      timeout: 30_000,
    });
    const exported = readFileSync(target, 'utf8');
    expect(exported).toContain(`$${INLINE}$`);
    expect(exported).toContain(`$$\n${BLOCK}\n$$`);
    expect(exported).toContain(`$$\n${MATH}\n$$`);
    expect(exported).not.toContain('data:image');
  });
});
