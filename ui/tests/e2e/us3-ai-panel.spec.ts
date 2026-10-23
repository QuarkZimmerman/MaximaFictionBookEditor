/**
 * User Story 3 (feature 005) - turn the assistant on, tell it what to change in the book, turn
 * it off (T049; quickstart §3): the panel, the transitions, the limits and the sizes. The
 * tool-chain details, the wrong calls, the rendering and the keyboard passes are
 * `us3-ai-tools.spec.ts` (T050). Needs the real core (`MFBE_CORE_BIN`); skipped in core-less
 * mode. The custom target is the loopback stand-in (`fixtures/ai-standin.mjs`, quickstart
 * §0.3), so no first-use notice is due and nothing but the stand-in is ever contacted
 * (`recordOutside`). Fixtures: `tests/fixtures/books/ai-selection.fb2`, `many-sections.fb2`.
 *
 * Scenarios (spec.md US3; the task text of T049):
 *  1+2. nothing of the assistant at start but the View entry and the toolbar button; a reload
 *     after the panel was open → off again (FR-090); turn on → the panel with its divider at
 *     360 px, the service and model with the settings link, an empty conversation, the context
 *     entry, no request within 2 s (FR-091), the modified state and the undo history unchanged
 *     (FR-095); the divider drag is stored, the presets 200 → 280 and 900 → 800 (FR-040)
 *  5. a document-wide request on `many-sections.fb2`: the chain of tool calls answered with
 *     `tool` messages, the activity list in order, the summary as the last message, the titles
 *     changed, one Mod+z, the panel's Undo and its hint after a later edit; the banner
 *     naming the exchange and the countdown of a 429 wait; no cap on exchanges (45 reads)
 *  6+7. a question → the number in the panel, not modified, no undo step (`answered`); an
 *     ask-back → unlocked, unchanged, the reply continues the conversation with the history
 *     (user + final text + `[No change]`, no tool traffic); a question after a change →
 *     committed as one step, `[Changes applied in this turn: replace_node ×1]` in the history;
 *     the popup's general request answered in the panel, Continue in panel focuses it
 *  8+4+3+9. Stop during an exchange; close while running → the question, No and Yes; close →
 *     reopen empty, the context entry gone, no request while typing; Clear; File → New;
 *     nothing of the instruction on disk (FR-045)
 *  limits and sizes: the wait sources body / message / default / beyond 5 min (FR-023), the
 *     pacing on `ratelimit-remaining: 0`, the split of a tool result, the cut outline, the
 *     trimmed history (FR-025)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import {
  expect,
  fixtureBook,
  recordOutside,
  test,
  waitForBook,
  type CoreHandle,
  type StandinHandle,
} from './fixtures/core';
import { pageText } from './fixtures/i18n';
import { MOD } from './fixtures/keys';

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

interface LastRequest {
  id: string;
  state: string;
  exchanges: number;
  changes: number;
}

interface ChatMessage {
  role: string;
  content: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

interface ChatBody {
  model: string;
  messages: ChatMessage[];
  tools?: unknown[];
}

interface ActivityRow {
  kind: string;
  /** The request the entry belongs to (`r<N>`). */
  request: string;
  /** The localised line without its time stamp. */
  text: string;
}

const SELECTION_BOOK = fixtureBook('ai-selection.fb2');
const MANY_SECTIONS = fixtureBook('many-sections.fb2');
const DEFAULT_WIDTH = 360;

const documentXml = (page: Page) => page.evaluate<string>('window.__mfbeTest.scripts.toXml()');
const lastRequest = (page: Page) =>
  page.evaluate<LastRequest | null>('window.__mfbeTest.ai.lastRequest()');
const assistantOn = (page: Page) => page.evaluate<boolean>('window.__mfbeTest.ai.on');
const isModified = (page: Page) =>
  page.title().then((title) => title.startsWith('*') || /\* - /.test(title));

const panel = (page: Page) => page.getByTestId('ai-panel');
const input = (page: Page) => page.getByTestId('ai-input');
const banner = (page: Page) => page.getByTestId('script-run-banner');

/** Every `ai-activity-<n>` row of the conversation in order: its kind, request and text. */
const allActivityRows = (page: Page) =>
  page.evaluate<ActivityRow[]>(`Array.from(
    document.querySelectorAll('[data-testid^="ai-activity-"]'),
    (li) => ({
      kind: li.getAttribute('data-kind'),
      request: li.getAttribute('data-request'),
      text: li.querySelector('.mfbe-ai-activity-text').textContent,
    }),
  )`);

/** The activity rows of the latest request alone, in order. */
async function activityRows(page: Page): Promise<ActivityRow[]> {
  const rows = await allActivityRows(page);
  const last = rows.at(-1)?.request;
  return rows.filter((row) => row.request === last);
}

/** The kinds of the activity rows of the latest request, in order. */
async function activityKinds(page: Page): Promise<string[]> {
  return (await activityRows(page)).map((row) => row.kind);
}

/** Every `ai-message-<n>` in order: its role and its text. */
const messageRows = (page: Page) =>
  page.evaluate<{ role: string; text: string }[]>(`Array.from(
    document.querySelectorAll('[data-testid^="ai-message-"]'),
    (div) => ({
      role: div.getAttribute('data-role'),
      text: div.querySelector('.mfbe-ai-message-text').textContent,
    }),
  )`);

async function configureTarget(core: CoreHandle, standin: StandinHandle): Promise<void> {
  await core.rpc('settings.set', {
    patch: {
      ai: {
        mode: 'custom',
        custom: { address: `${standin.url}/v1`, key: '', model: 'standin-chat' },
      },
    },
  });
}

async function openBook(
  core: CoreHandle,
  page: Page,
  standin: StandinHandle,
  book = SELECTION_BOOK,
): Promise<void> {
  await configureTarget(core, standin);
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

/** View → AI Assistant. */
async function toggleFromMenu(page: Page): Promise<void> {
  await page.getByTestId('menu-view').click();
  await page.getByTestId('menu-view-toggle').click();
}

async function turnOn(page: Page): Promise<void> {
  await toggleFromMenu(page);
  await expect(panel(page)).toBeVisible();
  await expect.poll(() => assistantOn(page)).toBe(true);
}

/** The id of the last request so far (null before the first) - `waitForEnd` waits for a newer one. */
const lastRequestId = async (page: Page) => (await lastRequest(page))?.id ?? null;

/** Types the instruction into the panel's field and presses Enter; returns the id to wait past. */
async function send(page: Page, instruction: string): Promise<string | null> {
  const before = await lastRequestId(page);
  await input(page).fill(instruction);
  await input(page).press('Enter');
  return before;
}

/** Waits for the request after `before` to end (its summary published, the slot empty). */
async function waitForEnd(
  page: Page,
  before: string | null,
  timeout = 30_000,
): Promise<LastRequest> {
  await expect.poll(() => lastRequestId(page), { timeout }).not.toBe(before);
  await expect(page.getByTestId('ai-send')).toBeVisible({ timeout });
  await expect(banner(page)).toHaveCount(0, { timeout });
  return (await lastRequest(page))!;
}

async function sendAndWait(page: Page, instruction: string, timeout?: number) {
  const before = await send(page, instruction);
  return waitForEnd(page, before, timeout);
}

/** File > New, a "Save changes?" prompt answered No; resolves when the new document is shown. */
async function newDocument(page: Page): Promise<void> {
  const docId = () =>
    page.evaluate<string | null>(
      `document.querySelector('[data-testid="body-view"]')?.getAttribute('data-doc-id') ?? null`,
    );
  const before = await docId();
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-new').click();
  const prompt = page.getByTestId('dialog-save-changes');
  await expect
    .poll(async () => (await prompt.count()) > 0 || (await docId()) !== before)
    .toBe(true);
  if ((await prompt.count()) > 0) await page.getByTestId('dialog-save-changes-button-no').click();
  await expect.poll(() => docId()).not.toBe(before);
}

const serviceLabel = (page: Page, standin: StandinHandle) =>
  pageText(page, 'ai.banner.label', {
    service: `127.0.0.1:${standin.port}`,
    model: 'standin-chat',
  });

/** The user-visible paragraph locator of the Body view. */
const paragraphLocator = (page: Page, text: string) =>
  page.getByTestId('body-editor').locator('p.fb-p', { hasText: text }).first();

/** Opens the Body context menu on a paragraph and returns the menu. */
async function openContextMenu(page: Page, text: string): Promise<Locator> {
  await paragraphLocator(page, text).click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** The three title replacements of `many-sections.fb2` (title case). */
const NEW_TITLES = ['Глава первая', 'Глава вторая', 'Глава третья'];

/** The recorded chat bodies since the last `standin.reset()`. */
async function chatBodies(standin: StandinHandle): Promise<ChatBody[]> {
  const requests = await standin.requests();
  return requests.map((r) => r.body as unknown as ChatBody);
}

/** Every file under `dir`, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('US3 (005) - the AI assistant panel', () => {
  let outside: string[] = [];

  test.beforeEach(async ({ core, standin, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    outside = await recordOutside(context);
    await standin.reset();
    await core.resetAiRequests();
    await core.setAiResolve([]);
    await core.rpc('settings.set', { patch: { ai: null } });
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    expect(outside).toEqual([]);
    await core
      .rpc('settings.set', { patch: { ai: null, session: { aiPanelWidth: DEFAULT_WIDTH } } })
      .catch(() => {});
  });

  test('1+2. nothing at start but the entry and the button; turn on → the panel at 360 px with service, link, empty conversation and context entry, no request, nothing changed; the divider is stored, presets clamped; a reload turns it off', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    const xmlBefore = await documentXml(page);

    // Scenario 1: no panel, no popup, no context entry; the View entry and the toolbar button.
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByTestId('ai-splitter')).toHaveCount(0);
    await expect(page.getByTestId('dialog-ai-ask')).toHaveCount(0);
    await expect(page.getByTestId('toolbar-ai.toggle')).toBeVisible();
    await page.getByTestId('menu-view').click();
    await expect(page.getByTestId('menu-view-toggle')).toBeVisible();
    await page.keyboard.press('Escape');
    await openContextMenu(page, 'Поезд пришёл');
    await expect(page.getByTestId('context-menu-ai.ask')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('toolbar-edit.undo')).toBeDisabled();

    // Scenario 2: the toolbar button turns it on - the panel, the divider at 360 px, the
    // service and model, the settings link, the empty conversation, the field focused.
    await page.getByTestId('toolbar-ai.toggle').click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toHaveAttribute('data-ai-width', String(DEFAULT_WIDTH));
    const splitter = page.getByTestId('ai-splitter');
    await expect(splitter).toBeVisible();
    await expect(splitter).toHaveAttribute('role', 'separator');
    await expect(splitter).toHaveCSS('cursor', 'col-resize');
    const panelBox = (await panel(page).boundingBox())!;
    expect(Math.abs(panelBox.width - DEFAULT_WIDTH)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('ai-service')).toHaveText(await serviceLabel(page, standin));
    await expect(page.getByTestId('ai-settings-link')).toBeVisible();
    await expect(page.getByTestId('ai-empty')).toBeVisible();
    await expect(page.locator('[data-testid^="ai-message-"]')).toHaveCount(0);
    await expect(input(page)).toBeFocused();
    await expect(page.getByTestId('ai-send')).toBeDisabled(); // nothing typed yet
    await openContextMenu(page, 'Поезд пришёл');
    await expect(page.getByTestId('context-menu-ai.ask')).toBeVisible();
    await page.keyboard.press('Escape');
    // Turning on made no request, gathered nothing and locked nothing (FR-091).
    await page.waitForTimeout(2000);
    expect(await standin.requests()).toHaveLength(0);
    expect(await core.aiRequests()).toHaveLength(0);
    await expect(banner(page)).toHaveCount(0);
    expect(await documentXml(page)).toBe(xmlBefore);
    expect(await isModified(page)).toBe(false);
    await expect(page.getByTestId('toolbar-edit.undo')).toBeDisabled(); // FR-095
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');

    // The divider drag (as us1-tree-divider does): 100 px to the left widens the panel; the
    // width lands in settings.json as `session.aiPanelWidth`.
    const box = (await splitter.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + Math.min(box.height / 2, 200);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 50, y, { steps: 5 });
    await page.mouse.move(x - 100, y, { steps: 5 });
    await page.mouse.up();
    await expect(panel(page)).not.toHaveAttribute('data-ai-width', String(DEFAULT_WIDTH));
    const committed = Number(await panel(page).getAttribute('data-ai-width'));
    expect(Math.abs(committed - (DEFAULT_WIDTH + 100))).toBeLessThanOrEqual(1);
    const wider = (await panel(page).boundingBox())!;
    expect(Math.abs(wider.width - committed)).toBeLessThanOrEqual(1);
    await expect
      .poll(
        async () =>
          (await core.rpc<{ session: { aiPanelWidth: number } }>('settings.get')).session
            .aiPanelWidth,
        { timeout: 15_000 },
      )
      .toBe(committed);
    await expect
      .poll(() => {
        const file = path.join(core.dataDir!, 'settings.json');
        const settings = JSON.parse(readFileSync(file, 'utf8')) as {
          session?: { aiPanelWidth?: number };
        };
        return settings.session?.aiPanelWidth ?? null;
      })
      .toBe(committed);

    // A reload: the assistant is off again (FR-090) - the width is the one thing remembered.
    await page.reload();
    await page.getByTestId('app-root').waitFor();
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => assistantOn(page)).toBe(false);
    await expect(page.getByTestId('toolbar-ai.toggle')).toBeVisible();

    // Presets: a stored 200 is applied as 280, a stored 900 as 800 (the core keeps the values).
    for (const [stored, applied] of [
      [200, 280],
      [900, 800],
    ] as const) {
      await core.rpc('settings.set', { patch: { session: { aiPanelWidth: stored } } });
      await page.setViewportSize({ width: 1600, height: 900 });
      await core.openApp(page);
      await expect(page.getByTestId('status-message')).toHaveText(
        await pageText(page, 'status.ready'),
      );
      await page.getByTestId('toolbar-ai.toggle').click();
      await expect(panel(page)).toHaveAttribute('data-ai-width', String(stored));
      const shown = (await panel(page).boundingBox())!;
      expect(Math.abs(shown.width - applied)).toBeLessThanOrEqual(1);
      expect(
        (await core.rpc<{ session: { aiPanelWidth: number } }>('settings.get')).session
          .aiPanelWidth,
      ).toBe(stored);
    }
  });

  test('5. a document-wide request: the chain answered with tool messages, the activity in order, the summary last, three titles changed, one undo step; the panel Undo and its hint; the banner names the exchange and counts a wait down; no cap on exchanges', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin, MANY_SECTIONS);
    const xmlBefore = await documentXml(page);
    await turnOn(page);

    const title = (n: number) => `<title><p>${NEW_TITLES[n - 1]}</p></title>`;
    await standin.scenarios([
      { toolCalls: [{ id: 'c-outline', name: 'get_outline', arguments: {} }] },
      {
        toolCalls: [
          { id: 'c-read-1', name: 'read_part', arguments: { node: 'body[1]/section[1]' } },
        ],
      },
      {
        toolCalls: [
          { id: 'c-read-2', name: 'read_part', arguments: { node: 'body[1]/section[2]' } },
        ],
      },
      {
        toolCalls: [
          {
            id: 'c-read-3',
            name: 'read_part',
            arguments: '{"node": "body[1]/section[3]", "format": "fb2xml"}',
          },
        ],
      },
      // The banner names the exchange under way while the stand-in holds this answer.
      {
        delayMs: 3000,
        toolCalls: [
          {
            id: 'c-rep-1',
            name: 'replace_node',
            arguments: { node: 'body[1]/section[1]/title[1]', content: { xml: title(1) } },
          },
        ],
      },
      // A limit with Retry-After: the countdown, then the request continues.
      { status: 429, retryAfter: 2, body: { message: 'API rate limit exceeded' } },
      {
        toolCalls: [
          {
            id: 'c-rep-2',
            name: 'replace_node',
            arguments: { node: 'body[1]/section[2]/title[1]', content: { xml: title(2) } },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: 'c-rep-3',
            name: 'replace_node',
            arguments: { node: 'body[1]/section[3]/title[1]', content: { xml: title(3) } },
          },
        ],
      },
      { text: 'Три заголовка приведены к обычному регистру.' },
    ]);
    const instruction = 'Make the first three chapter titles title case';
    const before = await send(page, instruction);

    // The banner (FR-022): kind ai, service · model, the elapsed time ticking, the operation
    // always named; during the held exchange it names the exchange, during the wait the
    // countdown; the panel shows Stop in Send's place and the countdown in `ai-wait`.
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toHaveAttribute('data-run-kind', 'ai');
    await expect(page.getByTestId('script-run-name')).toHaveText(await serviceLabel(page, standin));
    await expect(page.getByTestId('ai-stop')).toBeVisible();
    await expect(page.getByTestId('ai-banner-operation')).toHaveText(
      await pageText(page, 'ai.phase.waiting'),
      { timeout: 20_000 },
    );
    const elapsedBefore = await page.getByTestId('script-run-elapsed').textContent();
    await expect(page.getByTestId('script-run-elapsed')).not.toHaveText(elapsedBefore ?? '', {
      timeout: 5000,
    });
    await expect(page.getByTestId('ai-wait')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('ai-banner-operation')).toHaveText(/\d+/);
    await expect(page.getByTestId('ai-banner-operation')).not.toHaveText('');
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'false');
    const done = await waitForEnd(page, before, 40_000);
    expect(done.state).toBe('committed');
    expect(done.exchanges).toBe(9); // 8 answers + the 429 retried
    expect(done.changes).toBe(3);

    // The record: every tool answered by its own `tool` message with string content and the
    // id echoed; the first exchange is [system, user], the general form without caret block.
    const bodies = await chatBodies(standin);
    expect(bodies).toHaveLength(9);
    expect(bodies[0]!.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(bodies[0]!.messages[1]!.content).toBe(instruction);
    expect(bodies[0]!.messages[0]!.content).toContain('"kind": "general"');
    expect(bodies[0]!.messages[0]!.content).not.toContain('Context — the paragraph at the caret');
    const last = bodies[8]!.messages;
    const toolMessages = last.filter((m) => m.role === 'tool');
    expect(toolMessages.map((m) => m.tool_call_id)).toEqual([
      'c-outline',
      'c-read-1',
      'c-read-2',
      'c-read-3',
      'c-rep-1',
      'c-rep-2',
      'c-rep-3',
    ]);
    for (const message of toolMessages) expect(typeof message.content).toBe('string');
    const outline = JSON.parse(toolMessages[0]!.content) as { entries: { title: string }[] };
    expect(outline.entries[0]!.title).toBe('Много разделов');
    const read1 = JSON.parse(toolMessages[1]!.content) as {
      node: { path: string };
      blocks: { text: string }[];
    };
    expect(read1.node.path).toBe('body[1]/section[1]');
    expect(read1.blocks[0]!.text).toBe('Глава 1');
    const read3 = JSON.parse(toolMessages[3]!.content) as { xml: string };
    expect(read3.xml).toContain('<title>');
    // The 429 retried the same body.
    expect(JSON.stringify(bodies[5]!.messages)).toBe(JSON.stringify(bodies[6]!.messages));

    // The activity list, in order: the reads named, each change tried, validated, accepted,
    // the wait, the end line; the summary is the last message.
    const rows = await activityRows(page);
    const kinds = rows.map((r) => r.kind);
    const interesting = kinds.filter((k) =>
      [
        'tool.call',
        'change.try',
        'validate',
        'change.accepted',
        'limit.wait',
        'request.done',
      ].includes(k),
    );
    expect(interesting).toEqual([
      'tool.call', // outline
      'tool.call', // section 1
      'tool.call', // section 2
      'tool.call', // section 3
      'tool.call',
      'change.try',
      'validate',
      'change.accepted',
      'limit.wait',
      'tool.call',
      'change.try',
      'validate',
      'change.accepted',
      'tool.call',
      'change.try',
      'validate',
      'change.accepted',
      'request.done',
    ]);
    const calls = rows.filter((r) => r.kind === 'tool.call').map((r) => r.text);
    expect(calls[0]).toContain(await pageText(page, 'ai.activity.summary.getOutline'));
    expect(calls[1]).toContain('section 1 "Глава 1"');
    expect(calls[2]).toContain('section 2 "Глава 2"');
    expect(calls[3]).toContain('section 3 "Глава 3"');
    expect(calls[4]).toContain('body[1]/section[1]/title[1]');
    const wait = rows.find((r) => r.kind === 'limit.wait')!;
    expect(wait.text).toContain(
      await pageText(page, 'ai.activity.limitWait', {
        seconds: 2,
        source: await pageText(page, 'ai.activity.limitSource.header'),
      }),
    );
    expect(kinds[kinds.length - 1]).toBe('request.done');
    const donePrefix = (
      await pageText(page, 'ai.activity.requestDone', {
        count: 3,
        exchanges: await pageText(page, 'ai.activity.exchanges', { count: 9 }),
        elapsed: 'ELAPSED',
      })
    ).split('ELAPSED')[0]!;
    expect(rows[rows.length - 1]!.text).toContain(donePrefix);
    const messages = await messageRows(page);
    expect(messages[0]).toEqual({ role: 'user', text: instruction });
    expect(messages[messages.length - 1]).toEqual({
      role: 'assistant',
      text: 'Три заголовка приведены к обычному регистру.',
    });

    // The three titles changed; one Mod+z restores the XML byte for byte (SC-003).
    const xmlAfter = await documentXml(page);
    for (const t of NEW_TITLES) expect(xmlAfter).toContain(`<p>${t}</p>`);
    expect(xmlAfter).not.toBe(xmlBefore);
    expect(await isModified(page)).toBe(true);
    await expect(page.getByTestId('ai-undo')).toBeEnabled();
    await page.getByTestId('body-editor').click();
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => documentXml(page)).toBe(xmlBefore);

    // The same chain again: the panel's Undo does it; after a further user edit it is
    // disabled with the hint to Edit > Undo.
    await standin.reset();
    await standin.scenarios([
      {
        toolCalls: [
          {
            name: 'replace_node',
            arguments: { node: 'body[1]/section[1]/title[1]', content: { xml: title(1) } },
          },
        ],
      },
      { text: 'Готово.' },
    ]);
    const again = await sendAndWait(page, 'Title case for chapter 1');
    expect(again.state).toBe('committed');
    expect(await documentXml(page)).toContain(`<p>${NEW_TITLES[0]}</p>`);
    await expect(page.getByTestId('ai-undo')).toBeEnabled();
    await page.getByTestId('ai-undo').click();
    await expect.poll(() => documentXml(page)).toBe(xmlBefore);
    await expect(page.getByTestId('ai-undo')).toBeDisabled();
    await standin.scenarios([
      {
        toolCalls: [
          {
            name: 'replace_node',
            arguments: { node: 'body[1]/section[2]/title[1]', content: { xml: title(2) } },
          },
        ],
      },
      { text: 'Готово.' },
    ]);
    await sendAndWait(page, 'Title case for chapter 2');
    await expect(page.getByTestId('ai-undo')).toBeEnabled();
    await paragraphLocator(page, 'В доме было тихо').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' x');
    await expect(page.getByTestId('ai-undo')).toBeDisabled();
    await expect(page.getByTestId('ai-undo-hint')).toHaveText(
      await pageText(page, 'ai.panel.undoHint'),
    );

    // No cap (review C2): 45 queued read calls then a text complete.
    await standin.reset();
    const reads = Array.from({ length: 45 }, (_, i) => ({
      toolCalls: [{ name: 'read_part', arguments: { node: `body[1]/section[${(i % 40) + 1}]` } }],
    }));
    await standin.scenarios([...reads, { text: 'Прочитано 45 раз.' }]);
    const many = await sendAndWait(page, 'Read every section', 120_000);
    expect(many.state).toBe('answered');
    expect(many.exchanges).toBe(46);
    expect(await standin.requests()).toHaveLength(46);
    const final = await messageRows(page);
    expect(final[final.length - 1]!.text).toBe('Прочитано 45 раз.');
  });

  test('6+7. a question answers without a change; an ask-back leaves the book unlocked and the reply carries the history without tool traffic; a question after a change commits one step; the popup general request lands in the panel', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    const xmlBefore = await documentXml(page);
    await turnOn(page);

    // Scenario 6: "How many footnotes?" - the outline read, then the number; no change.
    await standin.scenarios([
      { toolCalls: [{ name: 'get_outline', arguments: {} }] },
      { text: 'В книге 2 сноски.' },
    ]);
    const question = await sendAndWait(page, 'How many footnotes does the book have?');
    expect(question.state).toBe('answered');
    expect(question.changes).toBe(0);
    let messages = await messageRows(page);
    expect(messages[messages.length - 1]).toEqual({ role: 'assistant', text: 'В книге 2 сноски.' });
    expect(await documentXml(page)).toBe(xmlBefore);
    expect(await isModified(page)).toBe(false);
    await expect(page.getByTestId('toolbar-edit.undo')).toBeDisabled();
    await expect(page.getByTestId('ai-undo')).toBeDisabled();
    expect((await activityKinds(page)).at(-1)).toBe('request.answered');

    // Scenario 7: an ask-back - a question with no change: unlocked, unchanged, no undo step.
    await standin.reset();
    await standin.scenario({ text: 'Какой из двух эпиграфов вы имеете в виду?' });
    const asked = await sendAndWait(page, 'Move the epigraph above the title');
    expect(asked.state).toBe('askedBack');
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    expect(await documentXml(page)).toBe(xmlBefore);
    expect(await isModified(page)).toBe(false);
    await expect(page.getByTestId('toolbar-edit.undo')).toBeDisabled();
    expect((await activityKinds(page)).at(-1)).toBe('request.askedBack');
    messages = await messageRows(page);
    expect(messages[messages.length - 1]!.text).toBe('Какой из двух эпиграфов вы имеете в виду?');

    // The reply continues the conversation: the next request's messages hold the earlier
    // user texts and the final assistant texts with their lines - no tool traffic.
    await standin.reset();
    await standin.scenario({ text: 'Понятно, второй.' });
    await sendAndWait(page, 'The second one');
    const bodies = await chatBodies(standin);
    expect(bodies).toHaveLength(1);
    const roles = bodies[0]!.messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user']);
    const texts = bodies[0]!.messages.map((m) => m.content);
    expect(texts[1]).toBe('How many footnotes does the book have?');
    expect(texts[2]).toBe('В книге 2 сноски.\n[No change]');
    expect(texts[3]).toBe('Move the epigraph above the title');
    expect(texts[4]).toBe('Какой из двух эпиграфов вы имеете в виду?\n[No change]');
    expect(texts[5]).toBe('The second one');
    expect(bodies[0]!.messages.some((m) => m.role === 'tool' || m.tool_calls)).toBe(false);
    expect(JSON.stringify(bodies[0]!.messages)).not.toContain('get_outline');

    // A question after a change (review C5): committed as one undo step, then the question;
    // the next instruction carries `[Changes applied in this turn: replace_node ×1]`.
    await standin.reset();
    await standin.scenarios([
      {
        toolCalls: [
          {
            name: 'replace_node',
            arguments: {
              node: 'body[1]/section[1]/title[1]',
              content: { xml: '<title><p>Глава первая. Ночь на станции</p></title>' },
            },
          },
        ],
      },
      { text: 'Первый заголовок исправлен. Исправить и остальные?' },
    ]);
    const afterChange = await sendAndWait(page, 'Fix the first title');
    expect(afterChange.state).toBe('committed');
    expect(afterChange.changes).toBe(1);
    expect(await documentXml(page)).toContain('<p>Глава первая. Ночь на станции</p>');
    expect(await isModified(page)).toBe(true);
    await expect(page.getByTestId('ai-undo')).toBeEnabled();
    messages = await messageRows(page);
    expect(messages[messages.length - 1]!.text).toBe(
      'Первый заголовок исправлен. Исправить и остальные?',
    );
    expect((await activityKinds(page)).at(-1)).toBe('request.done');
    await standin.reset();
    await standin.scenario({ text: 'Хорошо.' });
    await sendAndWait(page, 'Yes, all of them');
    const next = (await chatBodies(standin))[0]!.messages;
    expect(next.at(-2)!.content).toBe(
      'Первый заголовок исправлен. Исправить и остальные?\n[Changes applied in this turn: replace_node ×1]',
    );
    expect(next.at(-1)!.content).toBe('Yes, all of them');
    expect(next.filter((m) => m.role === 'tool')).toHaveLength(0);
    // One Mod+z undoes the change of that request alone.
    await page.getByTestId('body-editor').click();
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => documentXml(page)).toBe(xmlBefore);

    // US2 scenario 4's panel half: a general popup request's answer appears in the panel and
    // Continue in panel focuses the field.
    await standin.reset();
    await paragraphLocator(page, 'Дежурный подошёл').click();
    await page.keyboard.press(`${MOD}+k`);
    const popup = page.getByTestId('dialog-ai-ask');
    await expect(popup).toBeVisible();
    await standin.scenario({ text: 'Это значит, что дежурный спросил, куда ей нужно.' });
    await page.getByTestId('dialog-ai-ask-input').fill('What does this paragraph say?');
    await page.getByTestId('dialog-ai-ask-input').press('Enter');
    await expect(page.getByTestId('dialog-ai-ask-status')).toHaveAttribute(
      'data-state',
      'answered',
      { timeout: 20_000 },
    );
    messages = await messageRows(page);
    expect(messages.at(-2)).toEqual({ role: 'user', text: 'What does this paragraph say?' });
    expect(messages.at(-1)).toEqual({
      role: 'assistant',
      text: 'Это значит, что дежурный спросил, куда ей нужно.',
    });
    await page.getByTestId('dialog-ai-ask-continue').click();
    await expect(popup).toHaveCount(0);
    await expect(input(page)).toBeFocused();
    // The popup's general request carried the caret block and the history.
    const popupBody = (await chatBodies(standin))[0]!.messages;
    expect(popupBody.at(-1)!.content).toContain('Context — the paragraph at the caret');
    expect(popupBody.map((m) => m.role).slice(0, 3)).toEqual(['system', 'user', 'assistant']);
  });

  test('8+4+3+9. Stop during an exchange; close while running asks - No continues, Yes cancels and closes; off discards the conversation and the entry, no request while typing; Clear and File > New empty it; nothing on disk', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    const xmlBefore = await documentXml(page);
    await turnOn(page);
    const token = `aiq-${crypto.randomUUID()}`;

    // Scenario 8: Stop during a held exchange → cancelled, the XML unchanged.
    await standin.scenario({ text: 'late', delayMs: 8000 });
    const beforeStop = await send(page, `Rename the chapters ${token}`);
    await expect(page.getByTestId('ai-stop')).toBeVisible();
    await expect(banner(page)).toBeVisible();
    await page.getByTestId('ai-stop').click();
    const stopped = await waitForEnd(page, beforeStop);
    expect(stopped.state).toBe('cancelled');
    expect((await activityKinds(page)).at(-1)).toBe('request.cancelled');
    await expect
      .poll(async () => (await core.aiRequests()).map((r) => r.outcome))
      .toEqual(['cancelled']);
    expect(await documentXml(page)).toBe(xmlBefore);
    expect(await isModified(page)).toBe(false);
    const messages = await messageRows(page);
    expect(messages.at(-1)).toEqual({
      role: 'notice',
      text: await pageText(page, 'ai.end.cancelled'),
    });

    // Scenario 4: close while running → the question; No leaves the panel and the request.
    await standin.reset();
    await standin.scenario({ text: 'late', delayMs: 8000 });
    await send(page, 'Another instruction');
    await expect(page.getByTestId('ai-stop')).toBeVisible();
    await page.getByTestId('ai-panel-close').click();
    const confirm = page.getByTestId('dialog-ai-stop-confirm');
    await expect(confirm).toBeVisible();
    await page.getByTestId('dialog-ai-stop-confirm-button-no').click();
    await expect(confirm).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
    await expect(page.getByTestId('ai-stop')).toBeVisible();
    await expect(banner(page)).toBeVisible();
    // Yes: cancelled, the panel gone, the assistant off, nothing changed.
    await toggleFromMenu(page);
    await expect(confirm).toBeVisible();
    await page.getByTestId('dialog-ai-stop-confirm-button-yes').click();
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => assistantOn(page)).toBe(false);
    await expect(banner(page)).toHaveCount(0);
    await expect.poll(async () => (await lastRequest(page))?.state).toBe('cancelled');
    expect(await documentXml(page)).toBe(xmlBefore);
    expect(await isModified(page)).toBe(false);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');

    // Scenario 3: off - the context entry gone; typing for a while makes no request; reopen
    // shows an empty conversation.
    await openContextMenu(page, 'Поезд пришёл');
    await expect(page.getByTestId('context-menu-ai.ask')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await standin.reset();
    await core.resetAiRequests();
    await paragraphLocator(page, 'Дежурный подошёл').click();
    await page.keyboard.press('End');
    const typingStarted = Date.now();
    while (Date.now() - typingStarted < 6000) {
      await page.keyboard.type(' слово', { delay: 40 });
    }
    expect(await standin.requests()).toHaveLength(0);
    expect(await core.aiRequests()).toHaveLength(0);
    await page.keyboard.press(`${MOD}+z`);
    await turnOn(page);
    await expect(page.getByTestId('ai-empty')).toBeVisible();
    await expect(page.locator('[data-testid^="ai-message-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="ai-activity-"]')).toHaveCount(0);
    await expect(banner(page)).toHaveCount(0);

    // Scenario 9: Clear empties the conversation; File > New empties it too.
    await standin.scenario({ text: 'Ответ.' });
    await sendAndWait(page, `Question ${token}`);
    await expect(page.locator('[data-testid^="ai-message-"]')).toHaveCount(2);
    await page.getByTestId('ai-clear').click();
    await expect(page.locator('[data-testid^="ai-message-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="ai-activity-"]')).toHaveCount(0);
    await expect(page.getByTestId('ai-clear')).toBeDisabled();
    await standin.scenario({ text: 'Ещё ответ.' });
    await sendAndWait(page, `Second question ${token}`);
    await expect(page.locator('[data-testid^="ai-message-"]')).toHaveCount(2);
    await newDocument(page);
    await expect(panel(page)).toBeVisible(); // the panel stays open, empty
    await expect(page.locator('[data-testid^="ai-message-"]')).toHaveCount(0);
    await expect.poll(() => assistantOn(page)).toBe(true);

    // Nothing of the instruction reached the disk (FR-045): the data folder after the session
    // settings were flushed.
    await toggleFromMenu(page);
    await expect(panel(page)).toHaveCount(0);
    await core.rpc('settings.get');
    await page.waitForTimeout(1500);
    const files = walk(core.dataDir!);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file, 'utf8').includes(token), `${file} holds the instruction`).toBe(
        false,
      );
    }
    expect(JSON.stringify(await core.rpc('settings.get'))).not.toContain(token);
  });

  test('limits: the wait from the body, the message and the default, a wait beyond 5 minutes reported; pacing on ratelimit-remaining 0', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);

    // 402 with `retry_after` in the body → a 2 s wait (source body), then the answer.
    await standin.scenarios([
      {
        status: 402,
        body: {
          status: 402,
          success: false,
          error: { code: 'FREE_LIMIT', message: 'Free limit reached', retry_after: 2 },
        },
      },
      { text: 'После паузы.' },
    ]);
    const body = await sendAndWait(page, 'Wait for me');
    expect(body.state).toBe('answered');
    let rows = await activityRows(page);
    let wait = rows.find((r) => r.kind === 'limit.wait')!;
    expect(wait.text).toContain(
      await pageText(page, 'ai.activity.limitWait', {
        seconds: 2,
        source: await pageText(page, 'ai.activity.limitSource.body'),
      }),
    );
    expect(await standin.requests()).toHaveLength(2);

    // "Retry after 3s" in the message only → source message.
    await standin.reset();
    await standin.scenarios([
      {
        status: 429,
        body: { error: { message: 'Rate limited. Retry after 3s', code: 'rate_limited' } },
      },
      { text: 'Снова после паузы.' },
    ]);
    const started = Date.now();
    await sendAndWait(page, 'Wait again');
    expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
    rows = await activityRows(page);
    wait = rows.filter((r) => r.kind === 'limit.wait').at(-1)!;
    expect(wait.text).toContain(
      await pageText(page, 'ai.activity.limitWait', {
        seconds: 3,
        source: await pageText(page, 'ai.activity.limitSource.message'),
      }),
    );

    // No hint → 30 s default: the countdown starts; the journey cancels instead of waiting.
    await standin.reset();
    await standin.scenarios([{ status: 429 }, { text: 'unused' }]);
    const beforeDefault = await send(page, 'Wait by default');
    await expect(page.getByTestId('ai-wait')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('ai-wait')).toContainText(/\b(30|29|28)\b/);
    rows = await activityRows(page);
    wait = rows.filter((r) => r.kind === 'limit.wait').at(-1)!;
    expect(wait.text).toContain(
      await pageText(page, 'ai.activity.limitWait', {
        seconds: 30,
        source: await pageText(page, 'ai.activity.limitSource.default'),
      }),
    );
    await page.getByTestId('script-run-cancel').click();
    expect((await waitForEnd(page, beforeDefault)).state).toBe('cancelled');
    expect(await standin.requests()).toHaveLength(1);

    // A wait beyond the 5-minute total → failed with the service's words, not waited for.
    await standin.reset();
    await standin.scenario({
      status: 429,
      body: {
        error: {
          message: 'Daily token quota exceeded. Retry after 84441 seconds.',
          code: 'quota_exceeded',
          retry_after: 84441,
        },
      },
    });
    const quota = await sendAndWait(page, 'Try anyway');
    expect(quota.state).toBe('failed');
    expect(await standin.requests()).toHaveLength(1);
    const messages = await messageRows(page);
    expect(messages.at(-1)!.role).toBe('notice');
    expect(messages.at(-1)!.text).toContain('Daily token quota exceeded');
    expect(messages.at(-1)!.text).toContain(
      await pageText(page, 'ai.failure.limitWait', { seconds: 84441 }),
    );
    expect((await activityKinds(page)).at(-1)).toBe('request.failed');

    // Pacing: `ratelimit-remaining: 0` + `ratelimit-reset: 2` on a tool-call answer → the
    // next exchange is paced by 2 s with a `limit.wait` of source header.
    await standin.reset();
    await standin.scenarios([
      {
        toolCalls: [{ name: 'get_outline', arguments: {} }],
        headers: { 'ratelimit-limit': '2', 'ratelimit-remaining': '0', 'ratelimit-reset': '2' },
      },
      { text: 'Готово после паузы.' },
    ]);
    const paced = await sendAndWait(page, 'Read the outline');
    expect(paced.state).toBe('answered');
    expect(paced.exchanges).toBe(2);
    const requests = await standin.requests();
    expect(requests).toHaveLength(2);
    const gap = Date.parse(requests[1]!.at) - Date.parse(requests[0]!.at);
    expect(gap).toBeGreaterThanOrEqual(1900);
    rows = await activityRows(page);
    const pacing = rows.filter((r) => r.kind === 'limit.wait').at(-1)!;
    expect(pacing.text).toContain(
      await pageText(page, 'ai.activity.limitWait', {
        seconds: 2,
        source: await pageText(page, 'ai.activity.limitSource.header'),
      }),
    );
    const answered = rows.filter((r) => r.kind === 'exchange.answered')[0]!;
    expect(answered.text).toContain(
      await pageText(page, 'ai.activity.rateLimit', { limit: 2, remaining: 0, reset: 2 }),
    );
  });

  test('sizes: an overflow after a long read resends the first part with more.cursor; an overflow on exchange 1 cuts the outline at a top-level entry; a second request drops the oldest turn and says so', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);

    // A `read_part` of section 2 (six long paragraphs), then an overflow: the resent exchange
    // carries the first part - whole blocks - with `more.cursor` (a `split` entry).
    await standin.scenarios([
      {
        toolCalls: [{ id: 'c-read', name: 'read_part', arguments: { node: 'body[1]/section[2]' } }],
      },
      { overflow: true },
      { text: 'Прочитано по частям.' },
    ]);
    const split = await sendAndWait(page, 'Read chapter two');
    expect(split.state).toBe('answered');
    expect(split.exchanges).toBe(3);
    let bodies = await chatBodies(standin);
    expect(bodies).toHaveLength(3);
    const whole = JSON.parse(bodies[1]!.messages.find((m) => m.role === 'tool')!.content) as {
      blocks: { text: string; path: string }[];
      more?: unknown;
    };
    expect(whole.blocks.length).toBe(7); // the title's paragraph and the six paragraphs
    expect(whole.more).toBeUndefined();
    const part = JSON.parse(bodies[2]!.messages.find((m) => m.role === 'tool')!.content) as {
      blocks: { text: string; path: string }[];
      more: { cursor: string; remaining: { blocks: number; characters: number }; hint: string };
    };
    expect(part.blocks.length).toBeGreaterThan(0);
    expect(part.blocks.length).toBeLessThan(whole.blocks.length);
    expect(part.more.cursor).toMatch(/^after:/);
    expect(part.more.remaining.blocks).toBe(whole.blocks.length - part.blocks.length);
    expect(part.more.hint).toContain('read_part');
    for (const [i, block] of part.blocks.entries()) {
      expect(block.text).toBe(whole.blocks[i]!.text); // whole blocks, never cut inside
    }
    let rows = await activityRows(page);
    const splitRow = rows.find((r) => r.kind === 'split')!;
    expect(splitRow.text).toContain(
      await pageText(page, 'ai.activity.splitWhat.toolResult', { tool: 'read_part' }),
    );
    expect(splitRow.text).toContain('maximum context length');

    // An overflow on exchange 1: the resent system message's outline is cut at a top-level
    // entry (the first body alone) with `more` for `get_outline`.
    await standin.reset();
    await page.getByTestId('ai-clear').click();
    await standin.scenarios([{ overflow: true }, { text: 'Оглавление сокращено.' }]);
    const cut = await sendAndWait(page, 'Describe the book');
    expect(cut.state).toBe('answered');
    bodies = await chatBodies(standin);
    expect(bodies).toHaveLength(2);
    const contextOf = (system: string) => {
      const start = system.indexOf('{\n');
      const end = system.indexOf('\n}\n', start);
      return JSON.parse(system.slice(start, end + 2)) as {
        outline: { type: string; name?: string; children: unknown[] }[];
        outlineMore?: { cursor: string; remaining: { entries: number }; hint: string };
      };
    };
    const first = contextOf(bodies[0]!.messages[0]!.content);
    expect(first.outline).toHaveLength(2); // the main body and the notes body
    expect(first.outlineMore).toBeUndefined();
    const resent = contextOf(bodies[1]!.messages[0]!.content);
    expect(resent.outline).toHaveLength(1);
    expect(resent.outline[0]!.children.length).toBeGreaterThan(0); // the subtree whole
    expect(resent.outlineMore!.cursor).toMatch(/^after:/);
    expect(resent.outlineMore!.remaining.entries).toBe(1);
    expect(resent.outlineMore!.hint).toContain('get_outline');
    rows = await activityRows(page);
    expect(rows.find((r) => r.kind === 'split')!.text).toContain(
      await pageText(page, 'ai.activity.splitWhat.outline'),
    );

    // A second request refused once: the oldest turn is dropped (`history.trimmed`), the
    // panel says so, the exchange is resent without it (FR-025).
    await standin.reset();
    await standin.scenarios([{ overflow: true }, { text: 'Без старого хода.' }]);
    const trimmed = await sendAndWait(page, 'And now?');
    expect(trimmed.state).toBe('answered');
    bodies = await chatBodies(standin);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(bodies[1]!.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(bodies[1]!.messages[1]!.content).toBe('And now?');
    rows = await activityRows(page);
    const trimmedRow = rows.find((r) => r.kind === 'history.trimmed')!;
    expect(trimmedRow.text).toBe(await pageText(page, 'ai.activity.historyTrimmed', { count: 1 }));
    const messages = await messageRows(page);
    const notice = messages.find((m) => m.role === 'notice')!;
    expect(notice.text).toBe(await pageText(page, 'ai.panel.historyTrimmed', { count: 1 }));
    expect(messages.at(-1)).toEqual({ role: 'assistant', text: 'Без старого хода.' });

    // The end states seen so far are the contract's.
    expect(['committed', 'answered', 'askedBack', 'failed', 'cancelled', 'rejected']).toContain(
      (await lastRequest(page))!.state,
    );
  });
});
