/**
 * Feature 010, US11 (T085; D42, FR-127): Anthropic's services in their own interface. The user's
 * own service on Anthropic's address - reached at the stand-in through `test.setAiResolve`, so no
 * test contacts Anthropic: *Fetch models* brings the effort levels Anthropic's list marks as
 * supported; the chosen one goes as `output_config.effort`; every request goes to `/v1/messages`
 * in Anthropic's form - its system text, its tools, a tool's result first in the next turn - and the
 * answers, a tool call among them, come back to the assistant; an error is shown in the service's
 * words; *Test connection* uses the same interface.
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
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

const messagesRequests = async (standin: StandinHandle) =>
  ((await standin.requests()) as unknown as StandinRequest[]).filter(
    (r) => r.method === 'POST' && r.path.endsWith('/messages'),
  );

/** Anthropic's model list ("List Models"): `max` and `low` supported, `medium` not, no `xhigh`. */
const MODELS = [
  {
    type: 'model',
    id: 'claude-test',
    display_name: 'Claude Test',
    capabilities: {
      effort: {
        supported: true,
        low: { supported: true },
        medium: { supported: false },
        high: { supported: true },
        xhigh: null,
        max: { supported: true },
      },
    },
  },
];

/** The own service on Anthropic's address, resolved to the stand-in, agreed to. */
async function anthropicService(core: CoreHandle, standin: StandinHandle): Promise<void> {
  const host = `api.anthropic.com:${new URL(standin.url).port}`;
  const address = `http://${host}/v1`;
  await core.rpc('test.setAiResolve', { entries: [`${host}:127.0.0.1`] });
  await core.rpc('settings.set', {
    patch: {
      ai: {
        mode: 'custom',
        custom: { address, key: '', model: 'claude-test' },
        agreements: [{ service: `custom:${address}`, host, at: '2026-11-07T10:00:00Z' }],
      },
    },
  });
}

async function openAiPage(page: Page): Promise<void> {
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-settings').click();
  await page.getByTestId('settings-tab-ai').click();
  await expect(page.getByTestId('settings-ai-service').locator('option').first()).toBeAttached();
}

async function ok(page: Page): Promise<void> {
  await page.getByTestId('dialog-settings-button-ok').click();
  await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
}

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
  await ensureAssistantOn(page);
}

async function askPopup(page: Page): Promise<void> {
  const paragraph = page.getByTestId('body-editor').locator('p.fb-p').first();
  await paragraph.click();
  await paragraph.click({ button: 'right' });
  await page.getByTestId('context-menu-ai.ask').click();
  const input = page.getByTestId('dialog-ai-ask-input');
  await input.fill('Make it shorter');
  await input.press('Enter');
}

test.describe("US11 (010) - Anthropic's services in their own interface", () => {
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
    await core.rpc('test.setAiResolve', { entries: [] }).catch(() => {});
    await core.rpc('settings.set', { patch: { ai: null } }).catch(() => {});
  });

  test("1. Anthropic's efforts offered; the chosen one goes as output_config.effort to /v1/messages; Test connection there too", async ({
    core,
    page,
    standin,
  }) => {
    await core.openApp(page);
    await anthropicService(core, standin);
    await standin.scenario({ models: MODELS });
    await openAiPage(page);
    const effort = page.getByTestId('settings-ai-effort-custom');
    await page.getByTestId('settings-ai-fetch-models').click();
    await expect(effort).toBeEnabled({ timeout: 15_000 });
    await expect(effort.locator('option')).toHaveText([
      await pageText(page, 'dialog.settings.ai.effortDefault'),
      await pageText(page, 'ai.effort.low'),
      await pageText(page, 'ai.effort.high'),
      await pageText(page, 'ai.effort.max'),
    ]);
    await effort.selectOption('high');
    await standin.scenario({ text: 'OK' });
    await page.getByTestId('settings-ai-test').click();
    await expect(page.getByTestId('settings-ai-status')).not.toHaveText('', { timeout: 15_000 });
    await expect.poll(async () => (await messagesRequests(standin)).length).toBe(1);
    await ok(page);
    const stored = await core.rpc<{ ai: { effort: unknown } }>('settings.get');
    expect(stored.ai.effort).toEqual({
      target: 'custom',
      model: 'claude-test',
      value: 'high',
      param: 'output_config.effort',
    });

    await openBook(core, page);
    await standin.scenario({ text: 'Shorter.' });
    await askPopup(page);
    await expect
      .poll(async () => (await messagesRequests(standin)).length, { timeout: 15_000 })
      .toBe(2);
    const [connection, request] = await messagesRequests(standin);
    // Test connection carries no effort; the assistant's request does, in Anthropic's form.
    expect(connection!.body).not.toHaveProperty('output_config');
    expect(request!.headers['anthropic-version']).toBe('2023-06-01');
    const body = request!.body!;
    expect(body.model).toBe('claude-test');
    expect(body.output_config).toEqual({ effort: 'high' });
    // D43: Anthropic's automatic prompt caching, one top-level marker.
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.max_tokens).toBe(16000);
    expect(Array.isArray(body.system)).toBe(true);
    expect((body.messages as { role: string }[])[0]!.role).toBe('user');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body).not.toHaveProperty('reasoning');
    expect(await standin.requests()).not.toContainEqual(
      expect.objectContaining({ path: expect.stringContaining('/chat/completions') }),
    );
  });

  test('2. a tool call comes back to the assistant and its result goes first in the next turn; an error in the words of the service', async ({
    core,
    page,
    standin,
  }) => {
    await core.openApp(page);
    await anthropicService(core, standin);
    await openBook(core, page);
    await standin.scenarios([
      { toolCalls: [{ id: 'toolu_1', name: 'get_outline', arguments: {} }] },
      { text: 'The book has sections.' },
    ]);
    await page.getByTestId('ai-input').fill('Count the sections of the book.');
    await page.getByTestId('ai-input').press('Enter');
    await expect(
      page.locator('[data-testid^="ai-message-"][data-role="assistant"]').last(),
    ).toContainText('The book has sections.', { timeout: 15_000 });
    const [first, second] = await messagesRequests(standin);
    const tools = (first!.body!.tools ?? []) as { name: string; input_schema: unknown }[];
    expect(tools.map((tool) => tool.name)).toContain('get_outline');
    expect(tools.every((tool) => typeof tool.input_schema === 'object')).toBe(true);
    const turns = second!.body!.messages as {
      role: string;
      content: { type: string; id?: string; tool_use_id?: string }[];
    }[];
    const call = turns.findIndex(
      (turn) =>
        turn.role === 'assistant' && turn.content.some((block) => block.type === 'tool_use'),
    );
    expect(call).toBeGreaterThanOrEqual(0);
    expect(turns[call]!.content.find((block) => block.type === 'tool_use')!.id).toBe('toolu_1');
    expect(turns[call + 1]!.role).toBe('user');
    expect(turns[call + 1]!.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_1',
    });

    await standin.scenario({
      status: 400,
      body: { error: { type: 'invalid_request_error', message: 'effort is not supported' } },
    });
    await askPopup(page);
    await expect(page.getByTestId('dialog-ai-ask')).toContainText('effort is not supported', {
      timeout: 15_000,
    });
  });
});
