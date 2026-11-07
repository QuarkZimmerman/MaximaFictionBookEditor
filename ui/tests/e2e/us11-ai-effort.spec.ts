/**
 * Feature 010, US11 (T063; D38-D41): the assistant's thinking effort. With the user's own service
 * at the stand-in: *Fetch models* brings each model's efforts (OpenRouter's style), the drop-down
 * lists them after *Model's default* and is greyed for a model without; the chosen effort is
 * stored with the model, kept across a restart, shown in the banner and carried by every assistant
 * request - not by *Test connection* or *Fetch models*; *Model's default* sends nothing; another
 * model returns it to the default; a service that refuses it is heard, with no second try.
 */

import type { Page } from '@playwright/test';

import {
  ensureAssistantOn,
  expect,
  fixtureBook,
  recordOutside,
  test,
  waitForBook,
  type CoreHandle,
  type StandinHandle,
} from './fixtures/core';
import { pageText } from './fixtures/i18n';

const BOOK = fixtureBook('ai-selection.fb2');

interface StandinRequest {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

const chatBodies = async (standin: StandinHandle) =>
  ((await standin.requests()) as unknown as StandinRequest[])
    .filter((r) => r.method === 'POST' && r.path.endsWith('/chat/completions'))
    .map((r) => r.body ?? {});

async function openAiPage(page: Page): Promise<void> {
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-settings').click();
  await page.getByTestId('settings-tab-ai').click();
  await expect(page.getByTestId('settings-ai-service').locator('option').first()).toBeAttached();
}

async function ownService(page: Page, standin: StandinHandle, model: string): Promise<void> {
  await page.getByTestId('settings-ai-mode-custom').check();
  await page.getByTestId('settings-ai-address').fill(`${standin.url}/v1`);
  await page.getByTestId('settings-ai-key').fill('');
  await page.getByTestId('settings-ai-model').fill(model);
}

async function ok(page: Page): Promise<void> {
  await page.getByTestId('dialog-settings-button-ok').click();
  await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
}

async function ask(page: Page, core: CoreHandle): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
  await ensureAssistantOn(page);
  const paragraph = page.getByTestId('body-editor').locator('p.fb-p').first();
  await paragraph.click();
  await paragraph.click({ button: 'right' });
  await page.getByTestId('context-menu-ai.ask').click();
  const input = page.getByTestId('dialog-ai-ask-input');
  await input.fill('Make it shorter');
  await input.press('Enter');
}

const MODELS = [{ id: 'thinker', supported_parameters: ['tools', 'reasoning'] }, { id: 'plain' }];

test.describe('US11 (010) - the thinking effort', () => {
  let outside: string[] = [];
  test.beforeEach(async ({ core, standin, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    outside = await recordOutside(context);
    await standin.reset();
    await core.rpc('settings.set', { patch: { ai: null } });
  });
  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    expect(outside).toEqual([]);
    await core.rpc('settings.set', { patch: { ai: null } }).catch(() => {});
  });

  test('1. the efforts after Fetch models; High is stored, kept, shown in the banner and carried by every request, not by Test connection or Fetch models', async ({
    core,
    page,
    standin,
  }) => {
    await core.openApp(page);
    await standin.scenario({ models: MODELS });
    await openAiPage(page);
    await ownService(page, standin, 'thinker');
    const effort = page.getByTestId('settings-ai-effort-custom');
    await expect(effort).toBeDisabled();
    await page.getByTestId('settings-ai-fetch-models').click();
    await expect(effort).toBeEnabled({ timeout: 15_000 });
    await expect(effort.locator('option')).toHaveText([
      await pageText(page, 'dialog.settings.ai.effortDefault'),
      await pageText(page, 'ai.effort.low'),
      await pageText(page, 'ai.effort.medium'),
      await pageText(page, 'ai.effort.high'),
    ]);
    await effort.selectOption('high');
    await standin.scenario({ text: 'OK' });
    await page.getByTestId('settings-ai-test').click();
    await expect(page.getByTestId('settings-ai-status')).not.toHaveText('', { timeout: 15_000 });
    await ok(page);
    const stored = await core.rpc<{ ai: { effort: unknown } }>('settings.get');
    expect(stored.ai.effort).toEqual({
      target: 'custom',
      model: 'thinker',
      value: 'high',
      param: 'reasoning.effort',
    });

    // A restart keeps it: the page reads it back.
    await core.openApp(page);
    await openAiPage(page);
    await expect(page.getByTestId('settings-ai-effort-custom')).toHaveValue('high');
    await page.getByTestId('dialog-settings-button-cancel').click();

    await standin.scenario({ text: 'Shorter.', delayMs: 1500 });
    await ask(page, core);
    await expect(page.getByTestId('script-run-name')).toContainText(
      `thinker \u2014 ${await pageText(page, 'ai.effort.high')}`,
    );
    await expect.poll(async () => (await chatBodies(standin)).length, { timeout: 15_000 }).toBe(2);
    const [testBody, request] = await chatBodies(standin);
    expect(testBody).not.toHaveProperty('reasoning');
    expect(request!.reasoning).toEqual({ effort: 'high' });
  });

  test('2. greyed for a model without; another model returns it to the default, which sends nothing', async ({
    core,
    page,
    standin,
  }) => {
    await core.openApp(page);
    await standin.scenario({ models: MODELS });
    await openAiPage(page);
    await ownService(page, standin, 'thinker');
    await page.getByTestId('settings-ai-fetch-models').click();
    const effort = page.getByTestId('settings-ai-effort-custom');
    await expect(effort).toBeEnabled({ timeout: 15_000 });
    await effort.selectOption('low');
    await page.getByTestId('settings-ai-model').fill('plain');
    await expect(effort).toBeDisabled();
    await expect(effort).toHaveAttribute(
      'title',
      await pageText(page, 'tip.settings.ai.effortNone'),
    );
    await ok(page);
    expect((await core.rpc<{ ai: { effort: unknown } }>('settings.get')).ai.effort).toBeNull();

    await standin.scenario({ text: 'Shorter.' });
    await ask(page, core);
    await expect.poll(async () => (await chatBodies(standin)).length, { timeout: 15_000 }).toBe(1);
    const [request] = await chatBodies(standin);
    expect(request).not.toHaveProperty('reasoning');
    expect(request).not.toHaveProperty('reasoning_effort');
  });

  test('3. a service that refuses the effort is heard, with no second try', async ({
    core,
    page,
    standin,
  }) => {
    await core.openApp(page);
    await core.rpc('settings.set', {
      patch: {
        ai: {
          mode: 'custom',
          custom: { address: `${standin.url}/v1`, key: '', model: 'thinker' },
          effort: { target: 'custom', model: 'thinker', value: 'high', param: 'reasoning.effort' },
        },
      },
    });
    await standin.scenario({ models: MODELS });
    await openAiPage(page);
    await page.getByTestId('settings-ai-fetch-models').click();
    await expect(page.getByTestId('settings-ai-effort-custom')).toHaveValue('high', {
      timeout: 15_000,
    });
    await ok(page);
    await standin.scenario({
      status: 400,
      body: { error: { message: 'reasoning is not supported' } },
    });
    await ask(page, core);
    await expect(page.getByTestId('dialog-ai-ask')).toContainText('reasoning is not supported', {
      timeout: 15_000,
    });
    expect(await chatBodies(standin)).toHaveLength(1);
  });
});
