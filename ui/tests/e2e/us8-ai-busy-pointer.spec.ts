/**
 * Feature 008, User Story 8 (T063, FR-080 to FR-086, SC-010): while the assistant's request is
 * at work the document pane shows the arrow with a turning atom (the frames change), the banner
 * and the status bar show the atom, and the ordinary pointer returns within a second after the
 * answer. Under reduced motion the frame stands still. The service is the loopback stand-in,
 * which holds its answer (`delayMs`).
 */
import type { Page } from '@playwright/test';

import {
  ensureAssistantOn,
  expect,
  fixtureBook,
  test,
  waitForBook,
  type CoreHandle,
  type StandinHandle,
} from './fixtures/core';

const BOOK = 'notes-6.fb2';

async function setUp(core: CoreHandle, page: Page, standin: StandinHandle): Promise<void> {
  test.skip(!process.env.MFBE_CORE_BIN, 'the AI journeys need the real core');
  await core.rpc('settings.set', {
    patch: {
      ai: {
        mode: 'custom',
        custom: { address: `${standin.url}/v1`, key: '', model: 'standin-chat' },
      },
    },
  });
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await core.enqueueDialog('dialog.openFile', { paths: [fixtureBook(BOOK)] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
  await ensureAssistantOn(page);
}

const pane = (page: Page) => page.locator('.mfbe-view-content');
const cursorValue = (page: Page) =>
  pane(page).evaluate((node) =>
    (node as { style: { getPropertyValue(name: string): string } }).style.getPropertyValue(
      '--mfbe-ai-cursor',
    ),
  );

async function ask(page: Page): Promise<void> {
  await page.getByTestId('ai-input').fill('Привет');
  await page.getByTestId('ai-input').press('Enter');
}

test.describe('US8: see that the AI assistant is at work', () => {
  test('the atom turns over the pane, in the banner and the status bar, and goes after the answer', async ({
    core,
    page,
    standin,
  }) => {
    await setUp(core, page, standin);
    await standin.scenarios([{ text: 'Готово.', delayMs: 3000 }]);
    await ask(page);
    await expect(pane(page)).toHaveClass(/mfbe-ai-busy/);
    const first = await cursorValue(page);
    expect(first).toContain('./cursors/ai-busy-');
    await expect.poll(() => cursorValue(page), { timeout: 2000 }).not.toBe(first);
    await expect(page.getByTestId('script-run-banner').getByTestId('ai-atom')).toBeVisible();
    await expect(page.getByTestId('script-run-bar').getByTestId('ai-atom')).toBeVisible();
    await expect(page.getByTestId('script-run-banner')).toHaveCount(0, { timeout: 30_000 });
    const ended = Date.now();
    await expect(pane(page)).not.toHaveClass(/mfbe-ai-busy/, { timeout: 1000 });
    expect(Date.now() - ended).toBeLessThan(1000);
    expect(await cursorValue(page)).toBe('');
  });

  test('under reduced motion the atom stands still', async ({ core, page, standin }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setUp(core, page, standin);
    await standin.scenarios([{ text: 'Готово.', delayMs: 2000 }]);
    await ask(page);
    await expect(pane(page)).toHaveClass(/mfbe-ai-busy/);
    expect(await cursorValue(page)).toContain('-static.svg');
    await page.waitForTimeout(400);
    expect(await cursorValue(page)).toContain('-static.svg');
    await expect(page.getByTestId('script-run-banner')).toHaveCount(0, { timeout: 30_000 });
  });
});
