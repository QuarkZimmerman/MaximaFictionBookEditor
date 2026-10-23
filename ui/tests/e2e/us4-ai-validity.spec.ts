/**
 * User Story 4 (feature 005) - nothing invalid reaches the book (T058; quickstart §4;
 * ai-catalogue §1.4, §3.1, §6.10; data-model §7; FR-055, FR-060 to FR-065; SC-002, SC-003,
 * SC-005). Needs the real core (`MFBE_CORE_BIN`); skipped in core-less mode. The custom target
 * is the loopback stand-in (`fixtures/ai-standin.mjs`), nothing else is ever contacted
 * (`recordOutside`). Fixtures: `tests/fixtures/books/ai-selection.fb2` (valid, two binaries)
 * and `ai-preexisting.fb2` (the same book with a misplaced `<title>` in chapter three).
 *
 * Scenarios:
 *  1. a `<title>` appended after the paragraphs of a new section is refused before the round
 *     trip (the ProseMirror pre-check, `notAllowed`, the issue with element and path); a
 *     duplicate `id` passes the pre-check and is caught by the schema pass (`rejected`, the
 *     core's element, path, line and message, `strike: {count: 1, of: 3}`); the corrected
 *     section is applied; `validate`, `get_schema` whole / `section` / unknown; one undo step;
 *     the core's reserved `schema.element` is never called
 *  2. `ai-preexisting.fb2` (FR-062): an unrelated change applied; an insertion before the old
 *     error (it moves) accepted - outside and inside its section; a new error inside the broken
 *     section rejected; the baseline error neither new nor cleared; Save still asks
 *  3. three rejections of one key - a 1001, a 1201 and a schema-invalid fragment - end the
 *     request as `rejected` with nothing applied, the earlier valid change of another key
 *     and a rejection of another key in between notwithstanding (FR-063)
 *  4. the SC-002 table: 26 invalid answers through the change tools, 0 applied
 *  5. `set_description`: an invalid description change rejected, a new title applied; FR-055:
 *     no image data in any request; the §9.1 refusals as results while the request goes on
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import type { JsonValue, StandinToolCall } from './fixtures/ai-standin.mjs';
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

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

interface LastRequest {
  id: string;
  state: string;
  exchanges: number;
  changes: number;
  validations: { durationMs: number }[];
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

interface Issue {
  code: string;
  element: string;
  path?: string;
  line?: number;
  message: string;
}

interface Envelope {
  error: {
    code: string;
    message: string;
    hint?: string;
    expected?: unknown;
    issues?: Issue[];
    strike?: { count: number; of: number };
    [extra: string]: unknown;
  };
}

/** The codes of a rejected attempt of a change tool (ai-catalogue §1.4 - each one strike). */
const STRIKE_CODES = new Set([
  'rejected',
  'invalidArguments',
  'unknownNode',
  'invalidNode',
  'notAllowed',
  'textOnly',
  'noSelection',
  'selectionRequired',
  'invalidXml',
  'fragmentNotAllowed',
]);

const SELECTION_BOOK = fixtureBook('ai-selection.fb2');
const PREEXISTING_BOOK = fixtureBook('ai-preexisting.fb2');

const documentXml = (page: Page) => page.evaluate<string>('window.__mfbeTest.scripts.toXml()');
const lastRequest = (page: Page) =>
  page.evaluate<LastRequest | null>('window.__mfbeTest.ai.lastRequest()');
const lastRequestId = async (page: Page) => (await lastRequest(page))?.id ?? null;
const assistantOn = (page: Page) => page.evaluate<boolean>('window.__mfbeTest.ai.on');
const isModified = (page: Page) =>
  page.title().then((title) => title.startsWith('*') || /\* - /.test(title));

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
  page.evaluate<{ role: string; text: string }[]>(`Array.from(
    document.querySelectorAll('[data-testid^="ai-message-"]'),
    (div) => ({
      role: div.getAttribute('data-role'),
      text: div.querySelector('.mfbe-ai-message-text').textContent,
    }),
  )`);

async function openBook(
  core: CoreHandle,
  page: Page,
  standin: StandinHandle,
  book: string,
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

async function turnOn(page: Page): Promise<void> {
  await page.getByTestId('menu-view').click();
  await page.getByTestId('menu-view-toggle').click();
  await expect(page.getByTestId('ai-panel')).toBeVisible();
  await expect.poll(() => assistantOn(page)).toBe(true);
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

/** The `tool` messages of the last recorded exchange, parsed, by tool_call_id. */
async function lastToolMessages(standin: StandinHandle): Promise<ChatMessage[]> {
  const requests = await standin.requests();
  const body = requests.at(-1)!.body as unknown as ChatBody;
  return body.messages.filter((m) => m.role === 'tool');
}

const parse = <T>(message: ChatMessage): T => JSON.parse(message.content) as T;

const logFile = (core: CoreHandle) => path.join(core.dataDir!, 'logs', 'mfbe-errors.log');
const logText = (core: CoreHandle) =>
  existsSync(logFile(core)) ? readFileSync(logFile(core), 'utf8') : '';

async function undoAll(page: Page, xmlBefore: string): Promise<void> {
  await page.getByTestId('body-editor').click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => documentXml(page)).toBe(xmlBefore);
}

/** The arguments of a stand-in tool call. */
type Args = { [member: string]: JsonValue | undefined };

/** One answer item with one tool call. */
const toolCall = (id: string, name: string, args: Args) => ({
  toolCalls: [{ id, name, arguments: args }],
});

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('US4 (005) - nothing invalid reaches the book', () => {
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

  test('1+4. a misplaced title and a duplicate id are rejected with element, path and strike; the corrected section is applied as one undo step; validate and get_schema answer; schema.element is never called', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin, SELECTION_BOOK);
    const xmlBefore = await documentXml(page);
    await turnOn(page);

    const section =
      '<section><title><p>ГЛАВА ПЯТАЯ. ВЕЧЕР</p></title><p>Первый абзац новой главы.</p><p>Второй абзац.</p><p>Третий абзац.</p></section>';
    await standin.scenarios([
      // The new section after chapter four: applied (body[1]/section[5]).
      toolCall('c-section', 'insert_node', {
        where: 'after',
        node: 'body[1]/section[4]',
        content: { xml: section },
      }),
      // A <title> after its paragraphs: refused before the round trip by the content model.
      toolCall('c-late-title', 'insert_node', {
        where: 'append',
        node: 'body[1]/section[5]',
        content: { xml: '<title><p>ПОЗДНИЙ ЗАГОЛОВОК</p></title>' },
      }),
      // A section with the id of chapter one: the pre-check lets it through, the schema pass
      // rejects it with the core's element, path, line and message.
      toolCall('c-dup-id', 'insert_node', {
        where: 'after',
        node: 'body[1]/section[5]',
        content: { xml: '<section id="ch1"><p>Дубль идентификатора.</p></section>' },
      }),
      toolCall('c-validate', 'validate', {}),
      toolCall('c-schema', 'get_schema', {}),
      toolCall('c-schema-section', 'get_schema', { element: 'section' }),
      toolCall('c-schema-unknown', 'get_schema', { element: 'chapter' }),
      { text: 'Глава добавлена.' },
    ]);
    const request = await sendAndWait(page, 'Add a section with a title and three paragraphs');
    expect(request.state).toBe('committed');
    expect(request.changes).toBe(1);
    expect(request.exchanges).toBe(8);

    const tools = await lastToolMessages(standin);
    expect(tools.map((m) => m.tool_call_id)).toEqual([
      'c-section',
      'c-late-title',
      'c-dup-id',
      'c-validate',
      'c-schema',
      'c-schema-section',
      'c-schema-unknown',
    ]);
    const inserted = parse<{ nodes: { path: string; type: string }[] }>(tools[0]!);
    expect(inserted.nodes.map((n) => [n.type, n.path])).toEqual([
      ['section', 'body[1]/section[5]'],
    ]);

    // The pre-check stage: notAllowed, the issue in the ErrorForModel form (no line).
    const late = parse<Envelope>(tools[1]!);
    expect(late.error.code).toBe('notAllowed');
    expect(late.error.strike).toEqual({ count: 1, of: 3 });
    expect(late.error.hint).toContain('content model');
    expect(late.error.issues).toHaveLength(1);
    expect(late.error.issues![0]).toMatchObject({
      code: 'schema.invalid',
      element: 'title',
      path: 'body[1]/section[5]',
    });
    expect(late.error.issues![0]!.message).toContain('title');
    expect(late.error.issues![0]).not.toHaveProperty('line');

    // The hook stage: rejected, the core's issue with element, path, line and message.
    const dup = parse<Envelope>(tools[2]!);
    expect(dup.error.code).toBe('rejected');
    expect(dup.error.strike).toEqual({ count: 1, of: 3 });
    expect(dup.error.issues).toHaveLength(1);
    const issue = dup.error.issues![0]!;
    expect(issue.code).toBe('schema.invalid');
    expect(issue.element).toBe('section');
    expect(issue.path).toBe('body[1]/section[6]');
    expect(issue.line).toBeGreaterThan(0);
    expect(issue.message).toContain("'ch1' is not a valid value of the atomic type 'xs:ID'");

    // validate after a rejected and an accepted change: ok, nothing new, nothing pre-existing.
    const validated = parse<{
      ok: boolean;
      newErrors: unknown[];
      preExistingErrors: unknown[];
      warnings: number;
      durationMs: number;
    }>(tools[3]!);
    expect(validated.ok).toBe(true);
    expect(validated.newErrors).toEqual([]);
    expect(validated.preExistingErrors).toEqual([]);
    expect(typeof validated.warnings).toBe('number');
    expect(typeof validated.durationMs).toBe('number');

    // get_schema whole: the five files and the notice.
    const schema = parse<{ files: { name: string; text: string }[]; notice: string }>(tools[4]!);
    expect(schema.files.map((f) => f.name)).toEqual([
      'FictionBook.xsd',
      'FictionBookGenres.xsd',
      'FictionBookLang.xsd',
      'FictionBookLinks.xsd',
      'FictionNotes.xsd',
    ]);
    expect(schema.files[0]!.text).toContain('<xs:schema');
    expect(schema.notice).toContain('Dmitry Gribov');
    // get_schema of one element: from the table - children, attributes, text.
    const sectionSchema = parse<{
      known: boolean;
      name: string;
      children: { name: string }[];
      attributes: { name: string; required: boolean }[];
      text: boolean;
    }>(tools[5]!);
    expect(sectionSchema.known).toBe(true);
    const children = sectionSchema.children.map((c) => c.name);
    for (const name of [
      'title',
      'epigraph',
      'p',
      'poem',
      'subtitle',
      'cite',
      'empty-line',
      'table',
      'image',
      'section',
    ]) {
      expect(children, name).toContain(name);
    }
    expect(sectionSchema.attributes.map((a) => a.name)).toEqual(['id', 'xml:lang']);
    expect(sectionSchema.text).toBe(false);
    expect(parse<{ known: boolean; name: string }>(tools[6]!)).toEqual({
      known: false,
      name: 'chapter',
    });
    // The core's reserved schema.element is never called: no methodNotFound in the log, and
    // the core made exactly the chat completions of this request.
    expect(logText(core)).not.toContain('schema.element');
    const aiRequests = await core.aiRequests();
    expect(aiRequests.every((r) => r.method === 'ai.complete')).toBe(true);

    // The activity: two rejections with "correction requested" and the errors, the strikes.
    const rows = await activityRows(page);
    const rejected = rows.filter((r) => r.kind === 'change.rejected');
    expect(rejected).toHaveLength(2);
    const strike1 = await pageText(page, 'ai.activity.strike', { count: 1, of: 3 });
    expect(rejected[0]!.text).toContain(
      await pageText(page, 'ai.activity.changeRejected', { count: 1, strike: strike1 }),
    );
    expect(rejected[0]!.text).toContain('title');
    expect(rejected[1]!.text).toContain("'ch1' is not a valid value");
    expect(rejected[1]!.text).toContain('body[1]/section[6]');
    const errors = rows.filter((r) => r.kind === 'tool.error');
    expect(errors.map((r) => r.text)).toEqual([
      expect.stringContaining('notAllowed'),
      expect.stringContaining('rejected'),
    ]);
    expect(rows.filter((r) => r.kind === 'change.accepted')).toHaveLength(1);
    const calls = rows.filter((r) => r.kind === 'tool.call').map((r) => r.text);
    // The call summary, completed by the result (new / pre-existing counts).
    expect(calls[3]).toBe(
      await pageText(page, 'ai.activity.summary.validateResult', { new: 0, preExisting: 0 }),
    );
    expect(calls[4]).toBe(await pageText(page, 'ai.activity.summary.getSchema'));
    expect(calls[5]).toBe(
      await pageText(page, 'ai.activity.summary.getSchemaElement', { element: 'section' }),
    );
    expect(rows.at(-1)!.kind).toBe('request.done');

    // The document: the section applied, nothing of the two rejections; one undo step.
    const xmlAfter = await documentXml(page);
    expect(xmlAfter).toContain('<p>ГЛАВА ПЯТАЯ. ВЕЧЕР</p>');
    expect(xmlAfter).toContain('<p>Третий абзац.</p>');
    expect(xmlAfter).not.toContain('ПОЗДНИЙ ЗАГОЛОВОК');
    expect(xmlAfter).not.toContain('Дубль идентификатора');
    expect((xmlAfter.match(/id="ch1"/g) ?? []).length).toBe(1);
    expect(await isModified(page)).toBe(true);
    await undoAll(page, xmlBefore);
  });

  test('2. pre-existing errors do not block (FR-062): an unrelated change and two insertions before the old error are applied, a new error beside it is rejected, the old one is reported as before; Save still asks', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin, PREEXISTING_BOOK);
    const xmlBefore = await documentXml(page);
    expect(xmlBefore).toContain('ЛИШНИЙ ЗАГОЛОВОК');
    await turnOn(page);

    await standin.scenarios([
      // Unrelated: a paragraph of chapter four.
      toolCall('p-text', 'set_text', {
        node: 'body[1]/section[4]/p[2]',
        text: 'Фраза-маркер заменена.',
      }),
      // Before the old error, outside its section: a new chapter after chapter two - the
      // error's path and line move (section[3] → section[4]), its key and count do not.
      toolCall('p-before', 'insert_node', {
        where: 'after',
        node: 'body[1]/section[2]',
        content: {
          xml: '<section><title><p>ВСТАВЛЕННАЯ ГЛАВА</p></title><p>Новая глава перед песней.</p></section>',
        },
      }),
      // Before the old error, inside its section: still one error of that key.
      toolCall('p-inside', 'insert_node', {
        where: 'before',
        node: 'body[1]/section[4]/p[1]',
        content: { xml: '<p>Абзац перед лишним заголовком.</p>' },
      }),
      // A new error inside the broken section - a duplicate id, which the schema pass reports
      // beside the old title error (libxml2 names one misplaced child per parent, so a second
      // misplaced title there would not be seen; the count rule is the unit tests' case) -
      // rejected: the old error does not shield the section.
      toolCall('p-second', 'insert_node', {
        where: 'before',
        node: 'body[1]/section[4]/p[1]',
        content: { xml: '<p id="ch1">Дубль идентификатора.</p>' },
      }),
      toolCall('p-validate', 'validate', {}),
      { text: 'Изменения внесены.' },
    ]);
    const request = await sendAndWait(page, 'Change a few things');
    expect(request.state).toBe('committed');
    expect(request.changes).toBe(3);

    const rows = await activityRows(page);
    expect(rows.find((r) => r.kind === 'validate.baseline')!.text).toBe(
      await pageText(page, 'ai.activity.validateBaseline', { count: 1 }),
    );
    const tools = await lastToolMessages(standin);
    expect(tools.map((m) => m.tool_call_id)).toEqual([
      'p-text',
      'p-before',
      'p-inside',
      'p-second',
      'p-validate',
    ]);
    expect(parse<{ node: { path: string } }>(tools[0]!).node.path).toBe('body[1]/section[4]/p[2]');
    expect(parse<{ nodes: { path: string }[] }>(tools[1]!).nodes[0]!.path).toBe(
      'body[1]/section[3]',
    );
    expect(parse<{ nodes: { path: string }[] }>(tools[2]!).nodes[0]!.path).toBe(
      'body[1]/section[4]/p[1]',
    );
    const second = parse<Envelope>(tools[3]!);
    expect(second.error.code).toBe('rejected');
    expect(second.error.strike).toEqual({ count: 1, of: 3 });
    // The new error alone is returned (the old title error is within the baseline's count).
    expect(second.error.issues!.map((i) => [i.element, i.path])).toEqual([
      ['p', 'body[1]/section[4]/p[1]'],
    ]);
    expect(second.error.issues![0]!.message).toContain("'ch1' is not a valid value");
    expect(second.error.issues![0]!.line).toBeGreaterThan(0);
    // validate: the old error is pre-existing (moved), nothing new.
    const validated = parse<{ ok: boolean; newErrors: Issue[]; preExistingErrors: Issue[] }>(
      tools[4]!,
    );
    expect(validated.ok).toBe(true);
    expect(validated.newErrors).toEqual([]);
    expect(validated.preExistingErrors.map((i) => [i.element, i.path])).toEqual([
      ['title', 'body[1]/section[4]/title[2]'],
    ]);

    // The document: the three accepted changes, the old error still there, the new one not.
    const xmlAfter = await documentXml(page);
    expect(xmlAfter).toContain('<p>Фраза-маркер заменена.</p>');
    expect(xmlAfter).toContain('<p>ВСТАВЛЕННАЯ ГЛАВА</p>');
    expect(xmlAfter).toContain('<p>Абзац перед лишним заголовком.</p>');
    expect(xmlAfter).toContain('ЛИШНИЙ ЗАГОЛОВОК');
    expect(xmlAfter).not.toContain('Дубль идентификатора');
    expect((xmlAfter.match(/id="ch1"/g) ?? []).length).toBe(1);

    // Save still asks as before: Save as → the validation-failed question; No writes nothing.
    const dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us4-'));
    const file = path.join(dir, 'preexisting-saved.fb2');
    try {
      await core.enqueueDialog('dialog.saveFile', { path: file, encoding: 'utf-8' });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-saveAs').click();
      const prompt = page.getByTestId('dialog-validation-failed');
      await expect(prompt).toBeVisible();
      await page.getByTestId('dialog-validation-failed-button-no').click();
      await expect(prompt).toHaveCount(0);
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // One undo step restores the book as it was.
    await undoAll(page, xmlBefore);
  });

  test('3. three rejections of one key - a 1001, a 1201 and a schema-invalid fragment - end the request as rejected: nothing applied, the earlier valid change discarded, the issues and the last message shown', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin, SELECTION_BOOK);
    const xmlBefore = await documentXml(page);
    await turnOn(page);

    const target = 'body[1]/section[1]/p[3]';
    await standin.scenarios([
      // A valid change of another key first.
      toolCall('s-ok', 'set_text', { node: 'body[1]/section[4]/p[2]', text: 'Текст заменён.' }),
      // Strike 1: malformed XML (1001).
      toolCall('s-1001', 'replace_node', {
        node: target,
        content: { xml: '<p>Незакрытый <emphasis>абзац</p>' },
      }),
      // A rejection of another key in between: the counter of the target stays at 1.
      toolCall('s-other', 'remove_node', { node: 'body[1]' }),
      // Strike 2: a title under p (1201).
      toolCall('s-1201', 'replace_node', {
        node: target,
        content: { xml: '<p><title><p>Заголовок в абзаце</p></title></p>' },
      }),
      // Strike 3: a schema-invalid fragment - the pre-check admits it, the schema pass does
      // not (a duplicate id). The request ends here; the text is the assistant's last words.
      {
        toolCalls: [
          {
            id: 's-hook',
            name: 'replace_node',
            arguments: { node: target, content: { xml: '<p id="ch1">Дубль идентификатора.</p>' } },
          },
        ],
        content: 'Пробую ещё раз.',
      },
      // Never reached: the request ends on the third strike without another exchange.
      { text: 'unused' },
    ]);
    const request = await sendAndWait(page, 'Rewrite the third paragraph');
    expect(request.state).toBe('rejected');
    expect(request.exchanges).toBe(5);
    const requests = await standin.requests();
    expect(requests).toHaveLength(5);

    // The recorded envelopes: the strikes 1 and 2 of the target, the other key's own strike.
    const body = requests[4]!.body as unknown as ChatBody;
    const tools = body.messages.filter((m) => m.role === 'tool');
    expect(tools.map((m) => m.tool_call_id)).toEqual(['s-ok', 's-1001', 's-other', 's-1201']);
    const first = parse<Envelope>(tools[1]!);
    expect(first.error.code).toBe('invalidXml');
    expect(first.error.strike).toEqual({ count: 1, of: 3 });
    expect(first.error.issues![0]!.code).toBe('xml.notWellFormed');
    expect(parse<Envelope>(tools[2]!).error).toMatchObject({
      code: 'notAllowed',
      strike: { count: 1, of: 3 },
    });
    const secondStrike = parse<Envelope>(tools[3]!);
    expect(secondStrike.error.code).toBe('fragmentNotAllowed');
    expect(secondStrike.error.strike).toEqual({ count: 2, of: 3 });
    expect(secondStrike.error.element).toBe('title');
    expect(secondStrike.error.parent).toBe('p');

    // The activity: the third rejection ended the request; its entry lists the three
    // rejections' issues; the assistant's last text is shown in the conversation.
    const rows = await activityRows(page);
    const rejected = rows.filter((r) => r.kind === 'change.rejected');
    expect(rejected).toHaveLength(4); // 1001, the other key, 1201, the hook
    expect(rejected[3]!.text).toContain(
      await pageText(page, 'ai.activity.strike', { count: 3, of: 3 }),
    );
    const end = rows.at(-1)!;
    expect(end.kind).toBe('request.rejected');
    expect(end.text).toContain(await pageText(page, 'ai.activity.requestRejected'));
    expect(end.text).toContain('Opening and ending tag mismatch');
    expect(end.text).toContain('title');
    expect(end.text).toContain("'ch1' is not a valid value");
    const messages = await messageRows(page);
    expect(messages.some((m) => m.role === 'assistant' && m.text.includes('Пробую ещё раз.'))).toBe(
      true,
    );
    expect(messages.at(-1)!.text).toBe(await pageText(page, 'ai.end.rejected'));

    // Nothing applied: the earlier accepted set_text included (SC-005: byte for byte).
    expect(await documentXml(page)).toBe(xmlBefore);
    expect(await isModified(page)).toBe(false);
    // The lock is released: the panel takes the next instruction.
    await expect(input(page)).toBeEnabled();
  });

  test('4. the SC-002 table: 26 invalid answers through the change tools, 0 applied, each with its envelope, the XML byte-identical after every request', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin, SELECTION_BOOK);
    const xmlBefore = await documentXml(page);
    await turnOn(page);

    const insert = (where: string, node: string, xml: string) => ({
      name: 'insert_node',
      arguments: { where, node, content: { xml } },
    });
    const replace = (node: string, xml: string) => ({
      name: 'replace_node',
      arguments: { node, content: { xml } },
    });
    const describe = (description: Args) => ({
      name: 'set_description',
      arguments: { description },
    });
    // The table (quickstart §4): [name, call]. Grouped into requests so that no strike key is
    // struck three times (that would end the request - scenario 3 covers it).
    const groups: [string, StandinToolCall][][] = [
      [
        // malformed XML (1001 → invalidXml)
        [
          'unclosed tag',
          insert('after', 'body[1]/section[1]/p[1]', '<p>Незакрытый <emphasis>абзац</p>'),
        ],
        ['stray &', insert('after', 'body[1]/section[1]/p[2]', '<p>A &amp; B & C</p>')],
        ['two roots in replace_node', replace('body[1]/section[1]/p[3]', '<p>Раз.</p><p>Два.</p>')],
        ['unterminated attribute', insert('after', 'body[1]/section[2]/p[1]', '<p id="x>a</p>')],
        ['</p> without <p>', insert('after', 'body[1]/section[2]/p[2]', '<p>a</p></p>')],
        // misplaced valid elements (1201 or the pre-check)
        ['title after p', insert('append', 'body[1]/section[2]', '<title><p>ПОЗДНО</p></title>')],
        [
          'epigraph after p',
          insert('after', 'body[1]/section[2]/p[3]', '<epigraph><p>Э.</p></epigraph>'),
        ],
        ['p directly under body', insert('append', 'body[1]', '<p>Абзац в теле.</p>')],
        [
          'section inside p',
          replace('body[1]/section[2]/p[4]', '<p><section><p>x</p></section></p>'),
        ],
        [
          'annotation after section content',
          insert('append', 'body[1]/section[3]', '<annotation><p>А.</p></annotation>'),
        ],
        ['v outside stanza', insert('after', 'body[1]/section[2]/p[5]', '<v>Строка.</v>')],
        ['th outside table', insert('after', 'body[1]/section[2]/p[6]', '<th>Ячейка</th>')],
      ],
      [
        // unknown elements (1201 → fragmentNotAllowed)
        ['chapter', insert('after', 'body[1]/section[3]/p[1]', '<chapter><p>x</p></chapter>')],
        ['b', replace('body[1]/section[3]/p[2]', '<p><b>жирный</b></p>')],
        ['br', insert('after', 'body[1]/section[4]/p[1]', '<p>x<br/>y</p>')],
        ['div', insert('after', 'body[1]/section[4]/p[2]', '<div>x</div>')],
        ['footnote', insert('append', 'body[1]/section[4]', '<footnote>x</footnote>')],
        [
          'binary',
          insert(
            'append',
            'body[1]/section[4]',
            '<binary id="b" content-type="image/jpeg">AAAA</binary>',
          ),
        ],
        // wrong attributes (the hook - the schema pass)
        [
          'duplicate id',
          insert('after', 'body[1]/section[4]', '<section id="ch1"><p>x</p></section>'),
        ],
        ['empty id', insert('after', 'body[1]/section[3]', '<section id=""><p>x</p></section>')],
        [
          'bad xml:lang',
          insert('after', 'body[1]/section[2]', '<section xml:lang="1 2"><p>x</p></section>'),
        ],
        [
          'section with foo="1"',
          insert('after', 'body[1]/section[1]', '<section foo="1"><p>x</p></section>'),
        ],
        ['duplicate id on p', replace('body[1]/section[4]/p[1]', '<p id="ch2">Дубль.</p>')],
      ],
      [
        // description (the hook; scenario 5)
        ['unknown genre', describe({ titleInfo: { genres: ['no_such_genre'] } })],
        ['required author removed', describe({ titleInfo: { authors: [] } })],
      ],
      [
        [
          'invalid date value',
          describe({ documentInfo: { date: { text: 'вчера', value: 'yesterday' } } }),
        ],
      ],
    ];

    let cases = 0;
    let applied = 0;
    const codes: string[] = [];
    for (const [g, group] of groups.entries()) {
      await standin.reset();
      await standin.scenarios([
        {
          toolCalls: group.map(([, call], i) => ({ ...call, id: `g${g}-${i}` })),
        },
        { text: 'Ничего не вышло.' },
      ]);
      const request = await sendAndWait(page, `Try group ${g + 1}`);
      expect(request.state, `group ${g + 1}`).toBe('answered');
      expect(request.changes).toBe(0);
      const tools = await lastToolMessages(standin);
      expect(tools).toHaveLength(group.length);
      group.forEach(([name], i) => {
        const message = tools[i]!;
        expect(message.tool_call_id, name).toBe(`g${g}-${i}`);
        const result = parse<Partial<Envelope>>(message);
        cases += 1;
        if (!result.error) {
          applied += 1;
          return;
        }
        expect(STRIKE_CODES.has(result.error.code), `${name}: ${result.error.code}`).toBe(true);
        expect(result.error.strike, name).toBeTruthy();
        expect(result.error.message, name).toBeTruthy();
        codes.push(result.error.code);
      });
      // Every refusal is a tool.error entry; nothing was accepted; the XML is byte-identical.
      const rows = await activityRows(page);
      expect(rows.filter((r) => r.kind === 'tool.error')).toHaveLength(group.length);
      expect(rows.filter((r) => r.kind === 'change.accepted')).toHaveLength(0);
      expect(await documentXml(page), `group ${g + 1}`).toBe(xmlBefore);
      expect(await isModified(page)).toBe(false);
    }
    expect(cases).toBeGreaterThanOrEqual(20);
    expect(applied).toBe(0);
    // The stages met: the parse (1001 / 1201), the pre-check and the hook.
    expect(codes).toContain('invalidXml');
    expect(codes).toContain('fragmentNotAllowed');
    expect(codes).toContain('notAllowed');
    expect(codes).toContain('rejected');
    expect(codes.filter((c) => c === 'rejected').length).toBeGreaterThanOrEqual(5);
  });

  test('5. a valid description change is applied and named by its fields; FR-055: no image data leaves the computer; the §9.1 refusals are answered while the request goes on', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin, SELECTION_BOOK);
    const xmlBefore = await documentXml(page);
    await turnOn(page);

    // The description: a bad genre rejected by the schema pass, a new title applied.
    await standin.scenarios([
      toolCall('d-bad', 'set_description', {
        description: { titleInfo: { genres: ['nonsense_genre'] } },
      }),
      toolCall('d-title', 'set_description', {
        description: { titleInfo: { bookTitle: 'Новое название книги' } },
      }),
      { text: 'Название изменено.' },
    ]);
    const described = await sendAndWait(page, 'Rename the book');
    expect(described.state).toBe('committed');
    expect(described.changes).toBe(1);
    let tools = await lastToolMessages(standin);
    const bad = parse<Envelope>(tools[0]!);
    expect(bad.error.code).toBe('rejected');
    expect(bad.error.issues!.map((i) => i.code)).toEqual(['genre.unknown']);
    expect(bad.error.strike).toEqual({ count: 1, of: 3 });
    const renamed = parse<{ description: { titleInfo: { bookTitle: string } }; fields: string[] }>(
      tools[1]!,
    );
    expect(renamed.description.titleInfo.bookTitle).toBe('Новое название книги');
    expect(renamed.fields).toEqual(['titleInfo.bookTitle']);
    let rows = await activityRows(page);
    expect(rows.filter((r) => r.kind === 'tool.call').map((r) => r.text)).toEqual([
      await pageText(page, 'ai.activity.summary.setDescription'),
      await pageText(page, 'ai.activity.summary.setDescriptionFields', {
        fields: 'titleInfo.bookTitle',
      }),
    ]);
    const xmlAfter = await documentXml(page);
    expect(xmlAfter).toContain('<book-title>Новое название книги</book-title>');
    expect(xmlAfter).toContain('<genre>prose_classic</genre>');
    expect(xmlAfter).not.toContain('nonsense_genre');
    await undoAll(page, xmlBefore);

    // FR-055: the fb2xml read of the whole body, the description and the outline carry no
    // base64, no <binary> and no byte of either binary; an image travels as <image l:href>.
    const fixture = readFileSync(SELECTION_BOOK, 'utf8');
    const binaries = [...fixture.matchAll(/<binary[^>]*>([^<]+)<\/binary>/g)].map((m) =>
      m[1]!.replace(/\s+/g, '').slice(0, 32),
    );
    expect(binaries).toHaveLength(2);
    await standin.reset();
    await core.resetAiRequests();
    await standin.scenarios([
      {
        toolCalls: [
          { id: 'f-body', name: 'read_part', arguments: { node: 'body[1]', format: 'fb2xml' } },
          { id: 'f-desc', name: 'get_description', arguments: {} },
          { id: 'f-outline', name: 'get_outline', arguments: {} },
        ],
      },
      { text: 'Прочитано.' },
    ]);
    const read = await sendAndWait(page, 'Read everything');
    expect(read.state).toBe('answered');
    const recorded = await standin.requests();
    expect(recorded).toHaveLength(2);
    for (const record of recorded) {
      const body = JSON.stringify(record.body);
      expect(body).not.toContain('base64');
      expect(body).not.toContain('<binary');
      for (const head of binaries) expect(body).not.toContain(head);
    }
    tools = await lastToolMessages(standin);
    const bodyXml = parse<{ xml: string }>(tools[0]!).xml;
    expect(bodyXml).toContain('<image l:href="#picture.jpg"');
    const description = parse<{ description: { titleInfo: { coverpage: { href: string }[] } } }>(
      tools[1]!,
    );
    expect(description.description.titleInfo.coverpage[0]!.href).toBe('#cover.jpg');

    // §9.1 refusals answered as results while the request goes on: remove_node of the first
    // body (notAllowed), set_text on a section (textOnly), replace_all with an invalid regex
    // (invalidArguments) - each one strike for its own key and a tool.error entry -, then a
    // read_part answered in parts that cannot hold one paragraph (tooLarge - a read, no
    // strike). The request ends answered; the XML is byte-identical.
    await standin.reset();
    await page.getByTestId('ai-clear').click();
    await expect(page.locator('[data-testid^="ai-message-"]')).toHaveCount(0);
    const paragraph = 'body[1]/section[2]/p[2]';
    await standin.scenarios([
      {
        toolCalls: [
          { id: 'r-body', name: 'remove_node', arguments: { node: 'body[1]' } },
          { id: 'r-text', name: 'set_text', arguments: { node: 'body[1]/section[2]', text: 'x' } },
          {
            id: 'r-regex',
            name: 'replace_all',
            arguments: { text: '(', regex: true, replacement: 'x' },
          },
          { id: 'r-read', name: 'read_part', arguments: { node: paragraph } },
        ],
      },
      { overflow: true },
      { text: 'Отказы получены.' },
    ]);
    const refused = await sendAndWait(page, 'Try the refused calls');
    expect(refused.state).toBe('answered');
    expect(refused.changes).toBe(0);
    const requests = await standin.requests();
    expect(requests).toHaveLength(3);
    const envelopes = (requests[2]!.body as unknown as ChatBody).messages
      .filter((m) => m.role === 'tool')
      .map((m) => parse<Partial<Envelope>>(m));
    expect(envelopes[0]!.error).toMatchObject({ code: 'notAllowed', strike: { count: 1, of: 3 } });
    expect(envelopes[0]!.error!.hint).toContain('content model');
    expect(envelopes[1]!.error).toMatchObject({ code: 'textOnly', strike: { count: 1, of: 3 } });
    expect(envelopes[2]!.error).toMatchObject({
      code: 'invalidArguments',
      strike: { count: 1, of: 3 },
    });
    // The read, resent as a part after the overflow: tooLarge, no strike member.
    expect(envelopes[3]!.error).toMatchObject({ code: 'tooLarge' });
    expect(envelopes[3]!.error!.strike).toBeUndefined();
    rows = await activityRows(page);
    expect(rows.filter((r) => r.kind === 'tool.error')).toHaveLength(3);
    expect(rows.filter((r) => r.kind === 'change.accepted')).toHaveLength(0);
    expect(rows.at(-1)!.kind).toBe('request.answered');
    expect(await documentXml(page)).toBe(xmlBefore);
  });
});
