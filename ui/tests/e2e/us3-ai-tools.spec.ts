/**
 * User Story 3 (feature 005) - the catalogue's behaviour through the panel (T050; the §9.1
 * rows of ai-catalogue; quickstart §3). Needs the real core (`MFBE_CORE_BIN`); skipped in
 * core-less mode. The custom target is the loopback stand-in (`fixtures/ai-standin.mjs`), so
 * nothing but the stand-in is ever contacted (`recordOutside`). Fixtures:
 * `tests/fixtures/books/ai-selection.fb2`, `many-sections.fb2`.
 *
 * Rows (the task text of T050):
 *  - the structural chain on `ai-selection.fb2`: `insert_node`, `remove_node`, `set_text`,
 *    `replace_all` each once, with the refusals - the first body (`notAllowed`, the content
 *    model in the hint), the last section (`notAllowed`), `set_text` on a section
 *    (`textOnly`), `replace_all` with no match (a success, no `change.try`) - one undo step
 *  - parallel calls: three in one answer → three `tool` messages in order
 *  - wrong calls: an unknown tool, `"1"` coerced and `"x"` refused, an unknown node →
 *    `tool.error` entries with the code and the valid form visible (FR-054)
 *  - `find` with hundreds of matches listed whole, a catastrophic regex refused within ~2 s,
 *    `read_part` of one paragraph too large for a part → the `tooLarge` envelope, the request
 *    going on each time (review C13, C15)
 *  - 503 with Retry-After → a wait, without → a failure with the service's words (D2)
 *  - an internal failure (a tool made to throw) → `failed (internal)`, the lock released, the
 *    log naming the code and the error's name only (review C17)
 *  - rendering: HTML, Markdown and a `javascript:` URL shown verbatim as text (review C16)
 *  - keyboard-only passes of the panel and the popup (FR-105)
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

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
}

interface ChatBody {
  messages: ChatMessage[];
}

interface ActivityRow {
  kind: string;
  request: string;
  text: string;
}

interface Envelope {
  error: {
    code: string;
    message: string;
    hint?: string;
    expected?: unknown;
    strike?: { count: number; of: number };
    [extra: string]: unknown;
  };
}

const SELECTION_BOOK = fixtureBook('ai-selection.fb2');
const MANY_SECTIONS = fixtureBook('many-sections.fb2');

const documentXml = (page: Page) => page.evaluate<string>('window.__mfbeTest.scripts.toXml()');
const lastRequest = (page: Page) =>
  page.evaluate<LastRequest | null>('window.__mfbeTest.ai.lastRequest()');
const lastRequestId = async (page: Page) => (await lastRequest(page))?.id ?? null;
const isModified = (page: Page) =>
  page.title().then((title) => title.startsWith('*') || /\* - /.test(title));
const focusedTestId = (page: Page) =>
  page.evaluate<string | null>(
    'document.activeElement ? document.activeElement.getAttribute("data-testid") : null',
  );
/** True when the focused element shows its focus ring (`:focus-visible`). */
const focusVisible = (page: Page) =>
  page.evaluate<boolean>(
    '!!document.activeElement && document.activeElement.matches(":focus-visible")',
  );

const input = (page: Page) => page.getByTestId('ai-input');
const banner = (page: Page) => page.getByTestId('script-run-banner');

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

const messageRows = (page: Page) =>
  page.evaluate<{ role: string; text: string; html: string }[]>(`Array.from(
    document.querySelectorAll('[data-testid^="ai-message-"]'),
    (div) => {
      const text = div.querySelector('.mfbe-ai-message-text');
      return { role: div.getAttribute('data-role'), text: text.textContent, html: text.innerHTML };
    },
  )`);

async function openBook(
  core: CoreHandle,
  page: Page,
  standin: StandinHandle,
  book = SELECTION_BOOK,
): Promise<void> {
  await core.rpc('settings.set', {
    patch: {
      ai: {
        mode: 'custom',
        custom: { address: `${standin.url}/v1`, key: '', model: 'standin-chat' },
      },
    },
  });
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

/**
 * The assistant on: the panel is restored as the session left it (FR-040 as amended, T100) -
 * live already at start, or shown through View → AI Assistant when hidden.
 */
async function turnOn(page: Page): Promise<void> {
  await ensureAssistantOn(page);
}

async function sendAndWait(page: Page, instruction: string, timeout = 30_000) {
  const before = await lastRequestId(page);
  await input(page).fill(instruction);
  await input(page).press('Enter');
  await expect.poll(() => lastRequestId(page), { timeout }).not.toBe(before);
  await expect(page.getByTestId('ai-send')).toBeVisible({ timeout });
  await expect(banner(page)).toHaveCount(0, { timeout });
  return (await lastRequest(page))!;
}

/** The `tool` messages of the last recorded exchange, parsed. */
async function lastToolMessages(standin: StandinHandle): Promise<ChatMessage[]> {
  const requests = await standin.requests();
  const body = requests.at(-1)!.body as unknown as ChatBody;
  return body.messages.filter((m) => m.role === 'tool');
}

const parse = <T>(message: ChatMessage): T => JSON.parse(message.content) as T;

const logFile = (core: CoreHandle) => path.join(core.dataDir!, 'logs', 'mfbe-errors.log');
const logText = (core: CoreHandle) =>
  existsSync(logFile(core)) ? readFileSync(logFile(core), 'utf8') : '';

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('US3 (005) - the catalogue through the panel', () => {
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
    await core.rpc('settings.set', { patch: { ai: null } }).catch(() => {});
  });

  test('the structural chain: insert, remove, set_text and replace_all once each with their refusals; one undo step; parallel calls in order', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    const xmlBefore = await documentXml(page);
    await turnOn(page);

    await standin.scenarios([
      // Refused: the first body (notAllowed with the content model), the last section of the
      // notes body after its first one went, set_text on a section (textOnly); accepted:
      // insert_node after a paragraph, remove_node of a paragraph, set_text on a paragraph.
      { toolCalls: [{ id: 'c-body', name: 'remove_node', arguments: { node: 'body[1]' } }] },
      {
        toolCalls: [
          {
            id: 'c-insert',
            name: 'insert_node',
            arguments: {
              where: 'after',
              node: 'body[1]/section[1]/p[3]',
              content: { xml: '<p>Новый абзац.</p><p>И ещё один.</p>' },
            },
          },
        ],
      },
      {
        toolCalls: [
          { id: 'c-rm-n1', name: 'remove_node', arguments: { node: 'body[2]/section[1]' } },
        ],
      },
      {
        toolCalls: [
          { id: 'c-rm-n2', name: 'remove_node', arguments: { node: 'body[2]/section[1]' } },
        ],
      },
      {
        toolCalls: [
          {
            id: 'c-text-section',
            name: 'set_text',
            arguments: { node: 'body[1]/section[4]', text: 'Plain' },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: 'c-text',
            name: 'set_text',
            arguments: { node: 'body[1]/section[4]/p[2]', text: 'Фраза-маркер заменена.' },
          },
        ],
      },
      // replace_all: no match → a success without the hook; a real one → count and blocks.
      {
        toolCalls: [
          {
            id: 'c-ra-0',
            name: 'replace_all',
            arguments: { text: 'нет такого слова', replacement: 'x' },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: 'c-ra',
            name: 'replace_all',
            arguments: { text: 'Анна', replacement: 'Марта', matchCase: true },
          },
        ],
      },
      { text: 'Структура изменена.' },
    ]);
    const chain = await sendAndWait(page, 'Rework the structure');
    expect(chain.state).toBe('committed');
    expect(chain.exchanges).toBe(9);
    expect(chain.changes).toBe(4); // insert, remove n1, set_text p, replace_all

    const tools = await lastToolMessages(standin);
    expect(tools.map((m) => m.tool_call_id)).toEqual([
      'c-body',
      'c-insert',
      'c-rm-n1',
      'c-rm-n2',
      'c-text-section',
      'c-text',
      'c-ra-0',
      'c-ra',
    ]);
    const body = parse<Envelope>(tools[0]!);
    expect(body.error.code).toBe('notAllowed');
    expect(body.error.hint).toContain('content model');
    expect(body.error.strike).toEqual({ count: 1, of: 3 });
    const inserted = parse<{ nodes: { path: string; type: string }[] }>(tools[1]!);
    expect(inserted.nodes.map((n) => n.path)).toEqual([
      'body[1]/section[1]/p[4]',
      'body[1]/section[1]/p[5]',
    ]);
    const removed = parse<{ removed: { type: string }; characters: number }>(tools[2]!);
    expect(removed.removed.type).toBe('section');
    const lastSection = parse<Envelope>(tools[3]!);
    expect(lastSection.error.code).toBe('notAllowed');
    expect(lastSection.error.hint).toBeTruthy();
    const textOnly = parse<Envelope>(tools[4]!);
    expect(textOnly.error.code).toBe('textOnly');
    expect(textOnly.error.message).toContain('p, subtitle, text-author, v, td, th, date');
    const setText = parse<{ node: { path: string } }>(tools[5]!);
    expect(setText.node.path).toBe('body[1]/section[4]/p[2]');
    const noMatch = parse<{ count: number; blocks: unknown[] }>(tools[6]!);
    expect(noMatch).toEqual({ count: 0, blocks: [] });
    const replaced = parse<{ count: number; blocks: { path: string }[] }>(tools[7]!);
    const bodiesXml = xmlBefore.slice(
      xmlBefore.indexOf('<body>'),
      xmlBefore.lastIndexOf('</body>'),
    );
    expect(replaced.count).toBe((bodiesXml.match(/Анна/g) ?? []).length);
    expect(replaced.count).toBeGreaterThan(0);
    expect(replaced.blocks.length).toBeGreaterThan(0);
    expect(replaced.blocks.length).toBeLessThanOrEqual(replaced.count);

    // The activity: the refusals as tool.error with code and hint, the no-match replace_all as
    // a success without change.try, the accepted changes tried, validated, accepted.
    const rows = await activityRows(page);
    const errors = rows.filter((r) => r.kind === 'tool.error');
    expect(errors.map((r) => r.text)).toEqual([
      expect.stringContaining('notAllowed'),
      expect.stringContaining('notAllowed'),
      expect.stringContaining('textOnly'),
    ]);
    expect(errors[0]!.text).toContain(
      (await pageText(page, 'ai.activity.toolErrorHint', { hint: '' })).trim(),
    );
    expect(errors[0]!.text).toContain('content model');
    expect(errors[0]!.text).toContain(
      await pageText(page, 'ai.activity.strike', { count: 1, of: 3 }),
    );
    const callIndex = rows.findIndex(
      (r) => r.kind === 'tool.call' && r.text.includes('нет такого слова'),
    );
    expect(callIndex).toBeGreaterThan(0);
    const afterNoMatch = rows.slice(callIndex + 1, callIndex + 3).map((r) => r.kind);
    expect(afterNoMatch[0]).toBe('tool.result');
    expect(afterNoMatch).not.toContain('change.try');
    expect(rows.filter((r) => r.kind === 'change.try')).toHaveLength(7); // 3 refused + 4 accepted
    expect(rows.filter((r) => r.kind === 'change.accepted')).toHaveLength(4);
    expect(rows.filter((r) => r.kind === 'change.rejected')).toHaveLength(3);
    const calls = rows.filter((r) => r.kind === 'tool.call').map((r) => r.text);
    expect(calls[1]).toContain(await pageText(page, 'ai.activity.summary.where.after'));
    expect(calls[7]).toContain(
      await pageText(page, 'ai.activity.summary.replaceAllCount', {
        text: 'Анна',
        count: replaced.count,
      }),
    );

    // The document: the two paragraphs inserted, note 1 gone, the marker replaced, Анна →
    // Марта; one Mod+z restores everything.
    const xmlAfter = await documentXml(page);
    expect(xmlAfter).toContain('<p>Новый абзац.</p>');
    expect(xmlAfter).toContain('<p>И ещё один.</p>');
    expect(xmlAfter).not.toContain('Дежурный по станции — работник');
    expect(xmlAfter).toContain('<p>Фраза-маркер заменена.</p>');
    // The bodies only: the description's author keeps her name (replace_all never touches it).
    const bodiesAfter = xmlAfter.slice(xmlAfter.indexOf('<body>'), xmlAfter.lastIndexOf('</body>'));
    expect(bodiesAfter).not.toContain('Анна');
    expect(bodiesAfter).toContain('Марта');
    expect(xmlAfter).toContain('<first-name>Анна</first-name>');
    expect(await isModified(page)).toBe(true);
    await page.getByTestId('body-editor').click();
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => documentXml(page)).toBe(xmlBefore);

    // Parallel calls: three in one answer → three tool messages in the service's order.
    await standin.reset();
    await standin.scenarios([
      {
        toolCalls: [
          { id: 'p-1', name: 'get_outline', arguments: {} },
          { id: 'p-2', name: 'read_part', arguments: { node: 'body[1]/section[4]' } },
          { id: 'p-3', name: 'get_context', arguments: {} },
        ],
      },
      { text: 'Три вызова выполнены.' },
    ]);
    const parallel = await sendAndWait(page, 'Read three things at once');
    expect(parallel.state).toBe('answered');
    const three = await lastToolMessages(standin);
    expect(three.map((m) => m.tool_call_id)).toEqual(['p-1', 'p-2', 'p-3']);
    expect(parse<{ entries: unknown[] }>(three[0]!).entries).toHaveLength(2);
    expect(parse<{ node: { path: string } }>(three[1]!).node.path).toBe('body[1]/section[4]');
    expect(parse<{ changesInThisRequest: number }>(three[2]!).changesInThisRequest).toBe(0);
    const order = (await activityRows(page))
      .filter((r) => r.kind === 'tool.call')
      .map((r) => r.text);
    expect(order[0]).toContain(await pageText(page, 'ai.activity.summary.getOutline'));
    expect(order[1]).toContain('section 4');
    expect(order[2]).toContain(await pageText(page, 'ai.activity.summary.getContext'));
  });

  test('wrong calls answered with the valid form, visible in the activity list; find lists hundreds of matches whole', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin, MANY_SECTIONS);
    await turnOn(page);

    // Wrong calls (FR-054): an unknown tool, "1" coerced, "x" refused, an unknown node.
    await standin.scenarios([
      {
        toolCalls: [
          { id: 'w-unknown', name: 'count_words', arguments: {} },
          { id: 'w-coerced', name: 'get_outline', arguments: { depth: '1' } },
          { id: 'w-refused', name: 'get_outline', arguments: { depth: 'x' } },
          { id: 'w-node', name: 'read_part', arguments: { node: 'body[9]/section[1]' } },
        ],
      },
      { text: 'Ошибки учтены.' },
    ]);
    const wrong = await sendAndWait(page, 'Try some calls');
    expect(wrong.state).toBe('answered');
    const tools = await lastToolMessages(standin);
    expect(tools.map((m) => m.tool_call_id)).toEqual([
      'w-unknown',
      'w-coerced',
      'w-refused',
      'w-node',
    ]);
    const unknown = parse<Envelope>(tools[0]!);
    expect(unknown.error.code).toBe('unknownTool');
    expect(unknown.error.hint).toContain('get_outline');
    const coerced = parse<{ entries: { children: unknown[] }[] }>(tools[1]!);
    expect(coerced.entries).toHaveLength(1);
    expect(coerced.entries[0]!.children).toHaveLength(0); // depth 1 = the body alone
    const refused = parse<Envelope>(tools[2]!);
    expect(refused.error.code).toBe('invalidArguments');
    expect(refused.error.expected).toBeTruthy();
    const unknownNode = parse<Envelope>(tools[3]!);
    expect(unknownNode.error.code).toBe('unknownNode');
    expect(unknownNode.error.hint).toContain('get_outline');
    let rows = await activityRows(page);
    const errors = rows.filter((r) => r.kind === 'tool.error').map((r) => r.text);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('unknownTool');
    expect(errors[0]).toContain(
      (await pageText(page, 'ai.activity.toolErrorHint', { hint: '' })).trim(),
    );
    expect(errors[1]).toContain('invalidArguments');
    expect(errors[1]).toContain(
      (await pageText(page, 'ai.activity.toolErrorExpected', { expected: '' })).trim(),
    );
    expect(errors[2]).toContain('unknownNode');
    expect(errors[2]).toContain('body[9]/section[1]');

    // find whole (review C13): every match of a frequent letter in one message, no `more`.
    await standin.reset();
    await standin.scenarios([
      { toolCalls: [{ id: 'f-many', name: 'find', arguments: { text: 'н' } }] },
      { text: 'Найдено.' },
    ]);
    const found = await sendAndWait(page, 'Count the letter');
    expect(found.state).toBe('answered');
    const findResult = parse<{ matches: { text: string }[]; total: number; more?: unknown }>(
      (await lastToolMessages(standin))[0]!,
    );
    expect(findResult.total).toBeGreaterThanOrEqual(300);
    expect(findResult.matches).toHaveLength(findResult.total);
    expect(findResult.more).toBeUndefined();
    rows = await activityRows(page);
    expect(rows.find((r) => r.kind === 'tool.call')!.text).toBe(
      await pageText(page, 'ai.activity.summary.findCount', { text: 'н', count: findResult.total }),
    );
  });

  test('503 with and without Retry-After; a catastrophic regex refused within ~2 s and a paragraph too large for a part, the request going on; an internal failure logged by code and name only; model text shown verbatim', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    const xmlBefore = await documentXml(page);
    await turnOn(page);

    // 503 with Retry-After: 2 → a limit wait (source header), then the request continues.
    await standin.scenarios([
      { status: 503, retryAfter: 2, body: { error: { message: 'Overloaded' } } },
      { text: 'После перегрузки.' },
    ]);
    const waited = await sendAndWait(page, 'Try while overloaded');
    expect(waited.state).toBe('answered');
    expect(await standin.requests()).toHaveLength(2);
    let rows = await activityRows(page);
    expect(rows.find((r) => r.kind === 'limit.wait')!.text).toContain(
      await pageText(page, 'ai.activity.limitWait', {
        seconds: 2,
        source: await pageText(page, 'ai.activity.limitSource.header'),
      }),
    );

    // 503 without Retry-After: a failure like any other, the service's words, not waited.
    await standin.reset();
    await standin.scenarios([{ status: 503 }, { text: 'unused' }]);
    const started = Date.now();
    const failed = await sendAndWait(page, 'Try again');
    expect(failed.state).toBe('failed');
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await standin.requests()).toHaveLength(1);
    let messages = await messageRows(page);
    expect(messages.at(-1)!.role).toBe('notice');
    expect(messages.at(-1)!.text).toContain(await pageText(page, 'ai.failure.service'));
    expect(messages.at(-1)!.text).toContain('The stand-in is overloaded.');
    rows = await activityRows(page);
    expect(rows.filter((r) => r.kind === 'limit.wait')).toHaveLength(0);
    expect(rows.at(-1)!.kind).toBe('request.failed');
    expect(await documentXml(page)).toBe(xmlBefore);

    // An internal failure (review C17): a tool made to throw by the test hook → failed
    // (internal), the lock released, the document unchanged, the log with the code and the
    // error's name - never its message.
    await standin.reset();
    const secret = `secret-${crypto.randomUUID()}`;
    expect(
      await page.evaluate<boolean>(
        `window.__mfbeTest.ai.failNextTool('get_outline', ${JSON.stringify(secret)})`,
      ),
    ).toBe(true);
    const logBefore = logText(core);
    await standin.scenarios([
      { toolCalls: [{ name: 'get_outline', arguments: {} }] },
      { text: 'unused' },
    ]);
    const internal = await sendAndWait(page, 'Read the outline');
    expect(internal.state).toBe('failed');
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    expect(await documentXml(page)).toBe(xmlBefore);
    expect(await isModified(page)).toBe(false);
    messages = await messageRows(page);
    expect(messages.at(-1)!.text).toContain(await pageText(page, 'ai.failure.internal'));
    expect(messages.at(-1)!.text).not.toContain(secret);
    await expect
      .poll(() => logText(core).slice(logBefore.length).includes('ai.internal'), {
        timeout: 10_000,
      })
      .toBe(true);
    const added = logText(core).slice(logBefore.length);
    const entry = added
      .split('\n')
      .filter((line) => line.includes('ai.internal'))
      .map((line) => JSON.parse(line) as { code: string; message: string; stack?: string })
      .at(-1)!;
    expect(entry.code).toBe('ai.internal');
    expect(entry.message).toBe('Error');
    expect(entry.stack).toBeUndefined();
    expect(added).not.toContain(secret);
    expect(await standin.requests()).toHaveLength(1);

    // A catastrophic regex (review C15): invalidArguments "took too long" within ~2 s, the UI
    // responsive meanwhile, the request continues.
    await standin.reset();
    await standin.scenarios([
      {
        toolCalls: [{ id: 'f-bad', name: 'find', arguments: { text: '(.*\\s)*Ы', regex: true } }],
      },
      { text: 'Поиск не удался, продолжаю.' },
    ]);
    const regexStarted = Date.now();
    const before = await lastRequestId(page);
    await input(page).fill('Search with a bad pattern');
    await input(page).press('Enter');
    await expect(page.getByTestId('ai-stop')).toBeVisible();
    // The page answers while the worker runs the pattern.
    await page.getByTestId('ai-settings-link').hover();
    await expect.poll(() => lastRequestId(page), { timeout: 15_000 }).not.toBe(before);
    const elapsed = Date.now() - regexStarted;
    expect(elapsed).toBeLessThan(6000);
    await expect(page.getByTestId('ai-send')).toBeVisible();
    expect((await lastRequest(page))!.state).toBe('answered');
    const bad = parse<Envelope>((await lastToolMessages(standin))[0]!);
    expect(bad.error.code).toBe('invalidArguments');
    expect(bad.error.hint).toContain('took too long');
    rows = await activityRows(page);
    expect(rows.find((r) => r.kind === 'tool.error')!.text).toContain('invalidArguments');

    // read_part of one paragraph, then an overflow: the paragraph alone does not fit a part
    // → the tooLarge envelope {node, characters} travels and the request continues. The
    // conversation is cleared first: with earlier turns the refusal would drop those first
    // (§6.12 step 1 before step 2).
    await standin.reset();
    await page.getByTestId('ai-clear').click();
    await expect(page.locator('[data-testid^="ai-message-"]')).toHaveCount(0);
    const target = 'body[1]/section[2]/p[2]'; // a 300-character paragraph of chapter two
    await standin.scenarios([
      { toolCalls: [{ id: 'r-big', name: 'read_part', arguments: { node: target } }] },
      { overflow: true },
      { text: 'Абзац слишком велик.' },
    ]);
    const large = await sendAndWait(page, 'Read that paragraph');
    expect(large.state).toBe('answered');
    expect(large.exchanges).toBe(3);
    const requests = await standin.requests();
    expect(requests).toHaveLength(3);
    const wholeTool = (requests[1]!.body as unknown as ChatBody).messages.find(
      (m) => m.role === 'tool',
    )!;
    const whole = parse<{ node: { path: string; characters: number }; blocks: unknown[] }>(
      wholeTool,
    );
    expect(whole.node.path).toBe(target);
    expect(whole.blocks).toHaveLength(1);
    const partTool = (requests[2]!.body as unknown as ChatBody).messages.find(
      (m) => m.role === 'tool',
    )!;
    const tooLarge = parse<Envelope>(partTool);
    expect(tooLarge.error.code).toBe('tooLarge');
    expect((tooLarge.error.node as { path: string }).path).toBe(target);
    expect(tooLarge.error.characters).toBe(whole.node.characters);
    rows = await activityRows(page);
    expect(rows.some((r) => r.kind === 'split')).toBe(true);
    expect(rows.at(-1)!.kind).toBe('request.answered');

    // Rendering (review C16): HTML, a Markdown link and a javascript: URL verbatim as text.
    await standin.reset();
    const raw = '<b>bold</b> and [a link](https://example.com) and javascript:alert(1)';
    await standin.scenario({ text: raw });
    const shown = await sendAndWait(page, 'Say something tricky');
    expect(shown.state).toBe('answered');
    messages = await messageRows(page);
    const last = messages.at(-1)!;
    expect(last.role).toBe('assistant');
    expect(last.text).toBe(raw);
    expect(last.html).not.toContain('<b>');
    expect(last.html).not.toContain('<a');
    expect(last.html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(await page.locator('[data-testid^="ai-message-"] a').count()).toBe(0);
    expect(await page.locator('[data-testid^="ai-message-"] b').count()).toBe(0);
  });

  test('keyboard only (FR-105): the panel - Tab reaches the field, Enter sends one record, Shift+Enter a newline, the Tab order with focus rings; the popup - Mod+K, Enter, Shift+Enter, Tab, Escape', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);

    // A committed request first, so that Undo and Clear are enabled for the Tab walk.
    await standin.scenarios([
      {
        toolCalls: [
          {
            name: 'set_text',
            arguments: { node: 'body[1]/section[4]/p[2]', text: 'Фраза заменена.' },
          },
        ],
      },
      { text: 'Готово.' },
    ]);
    expect((await sendAndWait(page, 'Change the marker')).state).toBe('committed');
    expect(await standin.requests()).toHaveLength(2);

    // Tab from the panel's first control (the settings link) reaches the field.
    await page.getByTestId('ai-settings-link').focus();
    await page.keyboard.press('Tab');
    expect(await focusedTestId(page)).toBe('ai-input');
    expect(await focusVisible(page)).toBe(true);

    // Shift+Enter: a second line in the field and no record; Enter: exactly one record.
    await standin.reset();
    await page.keyboard.type('First line');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Second line');
    await expect(input(page)).toHaveValue('First line\nSecond line');
    await page.waitForTimeout(500);
    expect(await standin.requests()).toHaveLength(0);
    await standin.scenario({ text: 'Две строки получены.' });
    const before = await lastRequestId(page);
    await page.keyboard.press('Enter');
    await expect.poll(() => lastRequestId(page)).not.toBe(before);
    await expect(page.getByTestId('ai-send')).toBeVisible();
    expect(await standin.requests()).toHaveLength(1);
    const sent = (await standin.requests())[0]!.body as unknown as ChatBody;
    expect(sent.messages.at(-1)!.content).toBe('First line\nSecond line');
    await expect(input(page)).toHaveValue('');
    await expect(input(page)).toBeFocused();

    // Escape in the field changes nothing.
    await page.keyboard.type('Draft');
    await page.keyboard.press('Escape');
    await expect(input(page)).toHaveValue('Draft');
    await expect(page.getByTestId('ai-panel')).toBeVisible();
    await expect(page.getByTestId('ai-undo')).toBeEnabled();

    // The Tab order: ai-input → ai-send → ai-clear → ai-undo → ai-panel-close, each stop
    // showing its focus ring.
    const order: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      order.push((await focusedTestId(page)) ?? '');
      expect(await focusVisible(page)).toBe(true);
    }
    expect(order).toEqual(['ai-send', 'ai-clear', 'ai-undo', 'ai-panel-close']);
    await input(page).fill('');

    // The popup: Mod+K opens it with the focus in its field; Shift+Enter a newline; Tab
    // reaches Send and Cancel; Enter sends; Escape closes.
    await page
      .getByTestId('body-editor')
      .locator('p.fb-p', { hasText: 'Дежурный подошёл' })
      .click();
    await page.keyboard.press(`${MOD}+k`);
    const popup = page.getByTestId('dialog-ai-ask');
    await expect(popup).toBeVisible();
    await expect(page.getByTestId('dialog-ai-ask-input')).toBeFocused();
    await page.keyboard.type('Line one');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Line two');
    await expect(page.getByTestId('dialog-ai-ask-input')).toHaveValue('Line one\nLine two');
    const reached: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      reached.push((await focusedTestId(page)) ?? '');
    }
    expect(reached).toContain('dialog-ai-ask-button-send');
    expect(reached).toContain('dialog-ai-ask-button-cancel');
    await page.getByTestId('dialog-ai-ask-input').focus();
    await standin.reset();
    await standin.scenario({ text: 'Ответ на две строки.' });
    const beforePopup = await lastRequestId(page);
    await page.keyboard.press('Enter');
    await expect.poll(() => lastRequestId(page)).not.toBe(beforePopup);
    await expect(page.getByTestId('dialog-ai-ask-status')).toHaveAttribute(
      'data-state',
      'answered',
      { timeout: 20_000 },
    );
    expect(await standin.requests()).toHaveLength(1);
    expect(
      ((await standin.requests())[0]!.body as unknown as ChatBody).messages.at(-1)!.content,
    ).toContain('Line one\nLine two');
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
  });
});
