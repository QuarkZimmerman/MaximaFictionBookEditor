/**
 * Guard G5 (feature 010, research §2.4): what the assistant sends. One exchange through the AI
 * stand-in, its chat body with the volatile parts normalised (the book's node ids, dates, the
 * system prompt's length-dependent figures stay - they are part of what is sent), compared with
 * the committed snapshot taken from 0.0.7's behaviour. With *Model's default* - no effort chosen -
 * the body must stay exactly that; only a chosen effort may add its parameter (US11, D40).
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { ensureAssistantOn, expect, fixtureBook, test, waitForBook } from './fixtures/core';
import { pageText } from './fixtures/i18n';

const BOOK = fixtureBook('ai-selection.fb2');

/** The body with the parts that change from run to run replaced by markers. */
function normalised(body: unknown): string {
  const text = JSON.stringify(body, null, 2);
  return `${text
    .replace(/"call_[A-Za-z0-9_-]+"/g, '"call_<id>"')
    // The version label the prompt names: 0.0.8-rc on the branch, 0.0.8-rc.1 on a tagged build.
    .replace(
      /Maxima Fiction Book Editor \d+\.\d+\.\d+(-[0-9A-Za-z.]+)?/g,
      'Maxima Fiction Book Editor <version>',
    )
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\b/g, '<time>')}\n`;
}

test.describe('guard G5: the assistant request body', () => {
  test('one instruction sends the same chat body as 0.0.7 under the model default', async ({
    core,
    page,
    standin,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await standin.reset();
    await core.rpc('settings.set', {
      patch: {
        ai: {
          mode: 'custom',
          custom: { address: `${standin.url}/v1`, key: '', model: 'standin-chat' },
        },
        session: { aiPanelVisible: true },
      },
    });
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await waitForBook(page, BOOK);
    await ensureAssistantOn(page);
    await standin.scenarios([{ text: 'Done.' }]);
    await page.getByTestId('ai-input').fill('Count the sections of the book.');
    await page.getByTestId('ai-input').press('Enter');
    await expect.poll(async () => (await standin.requests()).length).toBe(1);
    const [request] = await standin.requests();
    expect(request.path).toBe('/v1/chat/completions');
    const body = request.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('reasoning_effort');
    // MFBE_G5_WRITE=1 refreshes the baseline - only when a requirement changes the body, and
    // recorded in specs/010-sixth-feedback-batch/test-changes.md with that requirement.
    const baseline = new URL('./fixtures/ai-requests-baseline.json', import.meta.url);
    if (process.env.MFBE_G5_WRITE === '1') writeFileSync(baseline, normalised(body));
    expect(normalised(body)).toBe(readFileSync(baseline, 'utf8'));
  });
});
