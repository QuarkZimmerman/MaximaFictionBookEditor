/**
 * User Story 5 (feature 005) - instructions in the Source view (T068; quickstart §5;
 * ai-catalogue §8; data-model §4.2 Source column, §6.4 text path, §7.5; FR-030, FR-070 to
 * FR-072; SC-002's text-path cases, SC-003, SC-005). Needs the real core (`MFBE_CORE_BIN`);
 * skipped in core-less mode. The custom target is the loopback stand-in, nothing else is ever
 * contacted (`recordOutside`). Fixture: `tests/fixtures/books/ai-selection.fb2` (the verse
 * paragraph of chapter three, a stylesheet, two binaries).
 *
 * Scenarios:
 *  1. the structured path: the whole verse `<p>` selected from its `<` to its `>`, right-click →
 *     `source-context-menu-ai.ask` → the popup; the user message holds the XML as "1 whole
 *     block(s)"; the `<poem>` answer is parsed in the parent's context, validated and applied;
 *     the Source text re-rendered with the new block selected; Edit → Undo in the Source view
 *     restores the text byte for byte; the Body view's Mod+z reaches the same step; the
 *     panel's `ai-undo` too
 *  2. the text path: half an element → the answer spliced, the whole text validated, one
 *     `doc.fromXml` at the commit and none before; a queued `replace_node` after the splice →
 *     `unavailable`; the binaries' ids and sizes unchanged; the three invalid cases
 *     (`invalidXml` with line and column, `&nbsp;` with the U+00A0 hint, `<poem>` inside
 *     `<title>` rejected with a strike); the refused ranges before any request and the tool's
 *     `notAllowed`
 *  3. the panel with the Source view active: `replace_node` → the text shows the result with
 *     the caret on the changed line, one Undo
 *  4. FR-072: a `>` deleted elsewhere → Send refused without a selection (the message names
 *     Ask AI), allowed with one; `sourceWellFormed: false`, the six tools, a structured call
 *     `unavailable`, a replacement that keeps the text broken rejected with line and column,
 *     one that repairs it applied
 */

import type { Locator, Page } from '@playwright/test';

import type { JsonValue } from './fixtures/ai-standin.mjs';
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
  validations: { durationMs: number }[];
  fromXmlCalls: number;
  changes: number;
}

interface ChatMessage {
  role: string;
  content: string;
  tool_call_id?: string;
}

interface ChatBody {
  messages: ChatMessage[];
  tools?: { function: { name: string } }[];
  tool_choice?: string;
}

interface Envelope {
  error: {
    code: string;
    message: string;
    hint?: string;
    issues?: { code: string; line?: number; column?: number; message: string }[];
    strike?: { count: number; of: number };
    [extra: string]: unknown;
  };
}

interface Offsets {
  anchor: number;
  head: number;
}

interface BinaryMeta {
  id: string;
  size: number;
}

const BOOK = fixtureBook('ai-selection.fb2');
const SIX = [
  'get_context',
  'get_selection',
  'get_schema',
  'read_resource',
  'validate',
  'replace_selection',
];
const POEM =
  '<poem><stanza><v>Тихо в поле, тихо в роще,</v><v>ветер стих, и дремлет сад;</v><v>только месяц, бледный, тощий,</v><v>смотрит в окна невпопад.</v></stanza></poem>';

const documentXml = (page: Page) => page.evaluate<string>('window.__mfbeTest.scripts.toXml()');
const sourceText = (page: Page) =>
  page.evaluate<string | null>('window.__mfbeTest.sourceMapping.sourceText()');
const sourceSelection = (page: Page) =>
  page.evaluate<Offsets | null>('window.__mfbeTest.sourceMapping.sourceSelection()');
const lastRequest = (page: Page) =>
  page.evaluate<LastRequest | null>('window.__mfbeTest.ai.lastRequest()');
const binaries = (page: Page) =>
  page.evaluate<BinaryMeta[]>(
    'window.__mfbeTest.scripts.document().binaries.map((b) => ({ id: b.id, size: b.size }))',
  );
const isModified = (page: Page) =>
  page.title().then((title) => title.startsWith('*') || /\* - /.test(title));

/** The `<binary …>…N bytes…</binary>` placeholders of the hook text: ids and sizes. */
function binaryPlaceholders(xml: string): string[] {
  return xml.match(/<binary\b[^>]*>…\d+ bytes…<\/binary>/g) ?? [];
}

async function openBook(core: CoreHandle, page: Page, standin: StandinHandle): Promise<void> {
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
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

/**
 * The assistant on: the panel is restored as the session left it (FR-040 as amended, T100) -
 * live already at start, or shown through View → AI Assistant when hidden.
 */
async function turnOn(page: Page): Promise<void> {
  await ensureAssistantOn(page);
}

async function showSource(page: Page): Promise<string> {
  await page.getByTestId('view-source').click();
  await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
  const text = await sourceText(page);
  expect(text).not.toBeNull();
  return text!;
}

async function showBody(page: Page): Promise<void> {
  await page.getByTestId('view-body').click();
  await expect(page.getByTestId('body-editor')).toBeVisible();
}

/** Puts the Source selection at `anchor`..`head` through the editor. */
async function select(page: Page, anchor: number, head: number): Promise<void> {
  const placed = await page.evaluate<boolean>(
    `window.__mfbeTest.sourceMapping.select(${anchor}, ${head})`,
  );
  expect(placed).toBe(true);
  await expect.poll(() => sourceSelection(page)).toEqual({ anchor, head });
}

/**
 * The Source editor's context menu → Ask AI... → the popup. The menu is opened by the
 * `contextmenu` event on the editor's content (a right-click inside the selection keeps it).
 */
async function openPopupFromMenu(page: Page): Promise<Locator> {
  const content = page.locator('.mfbe-source-editor .cm-content');
  // The editor scrolls the fresh selection into view in its next frame; the menu closes on
  // any scroll, so let that settle first.
  await page.evaluate(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150))))',
  );
  const box = (await content.boundingBox())!;
  await page.evaluate(
    `(() => document.querySelector('.mfbe-source-editor .cm-content').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2,
        clientX: ${Math.round(box.x + 40)}, clientY: ${Math.round(box.y + 40)} })))()`,
  );
  await expect(page.getByTestId('source-context-menu')).toBeVisible();
  await page.getByTestId('source-context-menu-ai.ask').click();
  const popup = page.getByTestId('dialog-ai-ask');
  await expect(popup).toBeVisible();
  return popup;
}

const status = (page: Page) => page.getByTestId('dialog-ai-ask-status');

async function send(page: Page, instruction: string): Promise<void> {
  const input = page.getByTestId('dialog-ai-ask-input');
  await input.fill(instruction);
  await input.press('Enter');
}

async function closePopup(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dialog-ai-ask')).toHaveCount(0);
}

/** `[from, to)` of the first match of `needle` in `haystack` (a test failure when absent). */
function indexOfOrFail(haystack: string, needle: string, from = 0): number {
  const at = haystack.indexOf(needle, from);
  expect(at, `"${needle.slice(0, 40)}" present`).toBeGreaterThanOrEqual(0);
  return at;
}

/** The verse paragraph of chapter three: the offsets of its `<p>` and after its `</p>`. */
function verseRange(text: string): { from: number; to: number } {
  const from = indexOfOrFail(text, '<p>Тихо в поле');
  const to = indexOfOrFail(text, '</p>', from) + '</p>'.length;
  return { from, to };
}

/** The `tool` messages of the last recorded exchange. */
async function lastToolMessages(standin: StandinHandle): Promise<ChatMessage[]> {
  const requests = await standin.requests();
  const body = requests.at(-1)!.body as unknown as ChatBody;
  return body.messages.filter((m) => m.role === 'tool');
}

const parse = <T>(message: ChatMessage): T => JSON.parse(message.content) as T;

type Args = { [member: string]: JsonValue | undefined };
const toolCall = (id: string, name: string, args: Args) => ({
  toolCalls: [{ id, name, arguments: args }],
});

const panelInput = (page: Page) => page.getByTestId('ai-input');

async function sendFromPanel(page: Page, instruction: string, timeout = 30_000) {
  const before = (await lastRequest(page))?.id ?? null;
  await panelInput(page).fill(instruction);
  await panelInput(page).press('Enter');
  await expect
    .poll(() => lastRequest(page).then((r) => r?.id ?? null), { timeout })
    .not.toBe(before);
  await expect(page.getByTestId('ai-send')).toBeVisible({ timeout });
  await expect(page.getByTestId('script-run-banner')).toHaveCount(0, { timeout });
  return (await lastRequest(page))!;
}

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('US5 (005) - Ask AI... in the Source view', () => {
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

  test('1. the structured path: a whole <p> selected as XML, the <poem> answer applied, the new block selected, one Undo in both views', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    const text = await showSource(page);
    const xmlBefore = await documentXml(page);
    const { from, to } = verseRange(text);
    await select(page, from, to);

    const popup = await openPopupFromMenu(page);
    await expect(page.getByTestId('dialog-ai-ask-input')).toBeFocused();
    await expect(page.getByTestId('dialog-ai-ask-selection')).toHaveText(
      await pageText(page, 'ai.popup.selectionSource', { characters: to - from }),
    );
    await expect(status(page)).toHaveAttribute('data-state', 'idle');
    // Anchored at the selection and inside the viewport.
    const box = (await popup.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);

    await standin.scenario({ text: POEM });
    await send(page, 'Turn the verse lines into a proper poem');
    await expect(status(page)).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
    await expect(page.getByTestId('dialog-ai-ask-undo')).toBeEnabled();

    // The record: the selected XML as "1 whole block(s)" in the user message, the tools offered.
    const requests = await standin.requests();
    expect(requests).toHaveLength(1);
    const body = requests[0]!.body as unknown as ChatBody;
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(body.tool_choice).toBe('auto');
    expect(body.tools!.length).toBeGreaterThan(SIX.length);
    const system = body.messages[0]!.content;
    expect(system).toContain('"activeView": "source"');
    expect(system).toContain('"sourceWellFormed": true');
    expect(system).toContain('"scriptsAvailable": false');
    expect(system).toContain('8. Source view:');
    expect(system).not.toContain('9. The document text is currently NOT well-formed');
    const user = body.messages[1]!.content;
    expect(user).toContain('Selected content (1 whole block(s);');
    expect(user).toContain('<p>Тихо в поле, тихо в роще,');
    expect(user).toContain('смотрит в окна невпопад.</p>');
    expect(user).toContain('Reply with the replacement only — as FB2 block elements');

    // Applied: the model holds the poem, the Source text is re-rendered from it with the new
    // block selected, the text is clean and validates.
    const xmlAfter = await documentXml(page);
    expect(xmlAfter).toContain('<poem>');
    expect(xmlAfter).toContain('<v>ветер стих, и дремлет сад;</v>');
    expect(xmlAfter).not.toContain('<p>Тихо в поле');
    expect(xmlAfter).not.toBe(xmlBefore);
    expect(await isModified(page)).toBe(true);
    const textAfter = (await sourceText(page))!;
    expect(textAfter).toBe(xmlAfter);
    const selected = (await sourceSelection(page))!;
    const [lo, hi] = [
      Math.min(selected.anchor, selected.head),
      Math.max(selected.anchor, selected.head),
    ];
    const block = textAfter.slice(lo, hi);
    expect(block.startsWith('<poem>')).toBe(true);
    expect(block.endsWith('</poem>')).toBe(true);
    expect(block).toContain('<v>смотрит в окна невпопад.</v>');
    const report = (await core.rpc('doc.validate', {
      docId: await page.evaluate<string>('window.__mfbeTest.scripts.document().docId'),
      text: textAfter,
    })) as { errorCount: number };
    expect(report.errorCount).toBe(0);
    const info = (await lastRequest(page))!;
    expect(info.state).toBe('committed');
    expect(info.exchanges).toBe(1);
    expect(info.changes).toBe(1);
    expect(info.fromXmlCalls).toBe(1); // the one fragment parse of the answer
    expect(binaryPlaceholders(xmlAfter)).toEqual(binaryPlaceholders(xmlBefore));

    // Edit → Undo in the Source view restores the text byte for byte and stays in the view.
    await closePopup(page);
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-undo').click();
    await expect.poll(() => sourceText(page)).toBe(text);
    await expect(page.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');
    expect(await documentXml(page)).toBe(xmlBefore);
    await expect.poll(() => sourceSelection(page)).toEqual({ anchor: from, head: to });

    // Redo, then the Body view's Mod+z reaches the same step (the Source view, which owns
    // it, is activated and shows the restored text).
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-redo').click();
    await expect.poll(() => sourceText(page)).toBe(textAfter);
    await showBody(page);
    expect(await documentXml(page)).toBe(xmlAfter);
    await page.getByTestId('body-editor').click();
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => documentXml(page)).toBe(xmlBefore);
    await expect(page.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => sourceText(page)).toBe(text);

    // The panel's Undo button reaches the step of a new request too.
    await select(page, from, to);
    await openPopupFromMenu(page);
    await standin.scenario({ text: POEM });
    await send(page, 'Turn the verse lines into a proper poem');
    await expect(status(page)).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
    await closePopup(page);
    expect(await documentXml(page)).toBe(xmlAfter);
    await expect(page.getByTestId('ai-undo')).toBeEnabled();
    await page.getByTestId('ai-undo').click();
    await expect.poll(() => sourceText(page)).toBe(text);
    expect(await documentXml(page)).toBe(xmlBefore);
  });

  test('2. the text path: a half element spliced and validated whole, one doc.fromXml at the commit, structured tools unavailable afterwards, the binaries untouched; the invalid cases; the refused ranges', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    const text = await showSource(page);
    const xmlBefore = await documentXml(page);
    const binariesBefore = await binaries(page);
    const { to: pTo } = verseRange(text);

    // Half an element: from inside the verse text to the end of its </p> (a `source` selection).
    const from = indexOfOrFail(text, 'ветер стих');
    await select(page, from, pTo);
    await openPopupFromMenu(page);
    await expect(page.getByTestId('dialog-ai-ask-selection')).toHaveText(
      await pageText(page, 'ai.popup.selectionSource', { characters: pTo - from }),
    );
    const replacement =
      'ветер стих, и дремлет сад;\nтолько месяц, бледный, тощий,\nсмотрит в окна наугад.</p>';
    await standin.scenarios([
      // The text splice as a tool call, then a structured change after it: unavailable.
      toolCall('c-splice', 'replace_selection', { content: { xml: replacement } }),
      toolCall('c-node', 'replace_node', {
        node: 'body[1]/section[4]/p[1]',
        content: { xml: '<p>Утро.</p>' },
      }),
      { text: 'Последняя строка изменена.' },
    ]);
    await send(page, 'Change the last word');
    await expect(status(page)).toHaveAttribute('data-state', 'done', { timeout: 20_000 });

    const requests = await standin.requests();
    expect(requests).toHaveLength(3);
    const first = requests[0]!.body as unknown as ChatBody;
    expect(first.messages[1]!.content).toContain('Selected content (XML text of the Source view;');
    expect(first.messages[1]!.content).toContain('ветер стих, и дремлет сад;');
    expect(first.messages[1]!.content).toContain('as XML text that fits exactly in the place');
    const tools = await lastToolMessages(standin);
    expect(tools.map((m) => m.tool_call_id)).toEqual(['c-splice', 'c-node']);
    const spliced = parse<{ replaced: { characters: number }; selection: { kind: string } }>(
      tools[0]!,
    );
    expect(spliced.replaced.characters).toBe(pTo - from);
    expect(spliced.selection.kind).toBe('source');
    const gated = parse<Envelope>(tools[1]!);
    expect(gated.error.code).toBe('unavailable');
    expect(gated.error.hint).toBe(
      'the document text was changed as text in this request; continue with text replacements of the selection or finish',
    );
    expect(gated.error).not.toHaveProperty('strike');

    // The text: the splice applied, the rest byte-identical, the replacement selected.
    const textAfter = (await sourceText(page))!;
    expect(textAfter).toBe(text.slice(0, from) + replacement + text.slice(pTo));
    expect(textAfter).not.toContain('Утро.</p>');
    await expect
      .poll(() => sourceSelection(page))
      .toEqual({
        anchor: from,
        head: from + replacement.length,
      });
    const info = (await lastRequest(page))!;
    expect(info.state).toBe('committed');
    expect(info.changes).toBe(1);
    expect(info.fromXmlCalls).toBe(1); // the one doc.fromXml of the commit, none before
    // The model is current, the binary store unchanged.
    const xmlAfter = await documentXml(page);
    expect(xmlAfter).toContain('смотрит в окна наугад.</p>');
    expect(binaryPlaceholders(xmlAfter)).toEqual(binaryPlaceholders(xmlBefore));
    expect(await binaries(page)).toEqual(binariesBefore);
    expect(await isModified(page)).toBe(true);
    // One Undo restores the text byte for byte (the text path's step is one snapshot too).
    await closePopup(page);
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-undo').click();
    await expect.poll(() => sourceText(page)).toBe(text);
    expect(await documentXml(page)).toBe(xmlBefore);

    // The three invalid cases of the text path, as tool calls on the whole <p> (a `source`
    // selection: the paragraph's text and tags from inside the text).
    await standin.reset();
    await select(page, from, pTo);
    await openPopupFromMenu(page);
    await standin.scenarios([
      toolCall('c-broken', 'replace_selection', {
        content: { xml: 'ветер.</p><poem><stanza><v>a</v></poem>' },
      }),
      toolCall('c-nbsp', 'replace_selection', { content: { xml: 'ветер&nbsp;стих.</p>' } }),
      { text: 'NO CHANGE\nThe replacements were refused.' },
    ]);
    await send(page, 'Change it');
    await expect(status(page)).toHaveAttribute('data-state', 'answered', { timeout: 20_000 });
    const invalid = await lastToolMessages(standin);
    expect(invalid.map((m) => m.tool_call_id)).toEqual(['c-broken', 'c-nbsp']);
    const broken = parse<Envelope>(invalid[0]!);
    expect(broken.error.code).toBe('invalidXml');
    expect(broken.error.strike).toEqual({ count: 1, of: 3 });
    expect(broken.error.issues).toHaveLength(1);
    expect(broken.error.issues![0]!.code).toBe('xml.notWellFormed');
    expect(broken.error.issues![0]!.line).toBeGreaterThan(0);
    expect(broken.error.issues![0]!.column).toBeGreaterThan(0);
    expect(broken.error.message).toMatch(/line \d+, column \d+/);
    const nbsp = parse<Envelope>(invalid[1]!);
    expect(nbsp.error.code).toBe('invalidXml');
    expect(nbsp.error.strike).toEqual({ count: 2, of: 3 });
    expect(nbsp.error.hint).toContain('U+00A0');
    expect(nbsp.error.hint).toContain('never &nbsp;');
    expect(await sourceText(page)).toBe(text);
    expect(await documentXml(page)).toBe(xmlBefore);
    expect((await lastRequest(page))!.fromXmlCalls).toBe(0);
    expect((await lastRequest(page))!.changes).toBe(0);
    await closePopup(page);

    // A well-formed replacement that adds a schema error - a <poem> inside the <title> of
    // chapter three - is rejected by the whole-text check (a strike), the text unchanged.
    await standin.reset();
    const titleP = indexOfOrFail(text, '<p>ГЛАВА ТРЕТЬЯ. ПЕСНЯ</p>');
    const titleFrom = indexOfOrFail(text, 'ПЕСНЯ</p>', titleP);
    const titleTo = titleFrom + 'ПЕСНЯ</p>'.length;
    await select(page, titleFrom, titleTo);
    await openPopupFromMenu(page);
    await standin.scenarios([
      toolCall('c-title', 'replace_selection', {
        content: { xml: 'ПЕСНЯ</p><poem><stanza><v>x</v></stanza></poem>' },
      }),
      { text: 'NO CHANGE\nRefused.' },
    ]);
    await send(page, 'Add a poem');
    await expect(status(page)).toHaveAttribute('data-state', 'answered', { timeout: 20_000 });
    const rejected = parse<Envelope>((await lastToolMessages(standin))[0]!);
    expect(rejected.error.code).toBe('rejected');
    expect(rejected.error.strike).toEqual({ count: 1, of: 3 });
    expect(rejected.error.issues!.length).toBeGreaterThan(0);
    expect(rejected.error.issues![0]!.code).toBe('schema.invalid');
    expect(await sourceText(page)).toBe(text);
    expect(await documentXml(page)).toBe(xmlBefore);
    await closePopup(page);

    // Refused ranges: a selection intersecting a binary, the stylesheet, the XML declaration
    // or the root start tag is refused in the popup before any request (no record).
    await standin.reset();
    const coreRequestsBefore = (await core.aiRequests()).length;
    const refusedRanges: [string, number, number][] = [
      [
        'binary',
        indexOfOrFail(text, '<binary id="cover.jpg"') + 3,
        indexOfOrFail(text, '<binary id="cover.jpg"') + 30,
      ],
      ['stylesheet', indexOfOrFail(text, 'text-indent'), indexOfOrFail(text, 'text-indent') + 11],
      ['declaration', 2, 10],
      ['root', indexOfOrFail(text, '<FictionBook') + 1, indexOfOrFail(text, '<FictionBook') + 12],
    ];
    for (const [what, a, b] of refusedRanges) {
      await select(page, a, b);
      await openPopupFromMenu(page);
      await expect(status(page), what).toHaveAttribute('data-state', 'refused');
      await expect(status(page), what).toHaveText(await pageText(page, 'ai.popup.refusedRange'));
      await page.getByTestId('dialog-ai-ask-input').fill('Change this');
      await expect(page.getByTestId('dialog-ai-ask-button-send'), what).toBeDisabled();
      await closePopup(page);
    }
    expect(await standin.requests()).toEqual([]);
    expect((await core.aiRequests()).length).toBe(coreRequestsBefore);

    // The panel's request on a range over a binary: `replace_selection` answers notAllowed,
    // nothing is spliced; `get_selection` reports the placeholder text (no image data).
    const binaryAt = indexOfOrFail(text, '<binary id="picture.jpg"');
    await select(page, binaryAt + 3, binaryAt + 30);
    await standin.scenarios([
      toolCall('c-get', 'get_selection', {}),
      toolCall('c-bin', 'replace_selection', { content: { xml: 'x' } }),
      { text: 'Нельзя.' },
    ]);
    const panelRequest = await sendFromPanel(page, 'Replace the selected text with x');
    expect(panelRequest.state).toBe('answered');
    expect(panelRequest.changes).toBe(0);
    const panelTools = await lastToolMessages(standin);
    const got = parse<{ kind: string; xml: string }>(panelTools[0]!);
    expect(got.kind).toBe('source');
    expect(got.xml).toBe(text.slice(binaryAt + 3, binaryAt + 30));
    expect(got.xml).not.toContain('/9j/');
    const refused = parse<Envelope>(panelTools[1]!);
    expect(refused.error.code).toBe('notAllowed');
    expect(refused.error.message).toBe(
      'binary data, the stylesheet, the XML declaration and the root element are never changed as text',
    );
    expect(await sourceText(page)).toBe(text);
    expect(await documentXml(page)).toBe(xmlBefore);
    expect(await binaries(page)).toEqual(binariesBefore);
    const all = await standin.requests();
    for (const request of all) {
      expect(JSON.stringify(request.body)).not.toContain('/9j/4AAQ');
    }
  });

  test('3. the panel with the Source view active: a replace_node change re-renders the text with the caret on the changed line; one Undo', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    const text = await showSource(page);
    const xmlBefore = await documentXml(page);
    // The caret somewhere unrelated (the first chapter).
    const caretAt = indexOfOrFail(text, 'Поезд пришёл');
    await select(page, caretAt, caretAt);
    await standin.scenarios([
      // US6 (review C8): scripts run in the Body view only - `run_script` answers
      // `unavailable` without a view change, `list_scripts` marks every script `sourceView`.
      toolCall('c-script', 'run_script', { id: '18/remove-spaces' }),
      toolCall('c-list', 'list_scripts', {}),
      toolCall('c-replace', 'replace_node', {
        node: 'body[1]/section[4]/p[1]',
        content: { xml: '<p>К утру туман над рекой разошёлся.</p>' },
      }),
      { text: 'Абзац сокращён.' },
    ]);
    const request = await sendFromPanel(page, 'Shorten the first paragraph of chapter four');
    expect(request.state).toBe('committed');
    expect(request.changes).toBe(1);
    const tools = await lastToolMessages(standin);
    const script = parse<{ error: { code: string; hint?: string } }>(tools[0]!);
    expect(script.error.code).toBe('unavailable');
    expect(script.error.hint).toBe('scripts run in the Body view; ask the user to switch');
    const listed = parse<{ scripts: { available: boolean; reason?: string }[] }>(tools[1]!);
    expect(listed.scripts.length).toBeGreaterThan(0);
    expect(listed.scripts.every((s) => s.available === false && s.reason === 'sourceView')).toBe(
      true,
    );
    // The view did not change for the run (FR-051).
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    const replaced = parse<{ node: { path: string } }>(tools[2]!);
    expect(replaced.node.path).toBe('body[1]/section[4]/p[1]');
    // The Source text is re-rendered from the committed model, the caret on the changed line.
    const textAfter = (await sourceText(page))!;
    expect(textAfter).toBe(await documentXml(page));
    expect(textAfter).toContain('<p>К утру туман над рекой разошёлся.</p>');
    expect(textAfter).not.toContain('мельничное колесо остановилось');
    const caret = (await sourceSelection(page))!;
    expect(caret.anchor).toBe(caret.head);
    const lineStart = textAfter.lastIndexOf('\n', caret.head - 1) + 1;
    const lineEnd = textAfter.indexOf('\n', caret.head);
    expect(textAfter.slice(lineStart, lineEnd)).toContain(
      '<p>К утру туман над рекой разошёлся.</p>',
    );
    expect(await isModified(page)).toBe(true);
    // The system message said the Source view was active and well-formed; scripts unavailable.
    const first = (await standin.requests())[0]!.body as unknown as ChatBody;
    expect(first.messages[0]!.content).toContain('"activeView": "source"');
    expect(first.messages[0]!.content).toContain('"scriptsAvailable": false');
    // One Undo from the panel restores the text and the model.
    await expect(page.getByTestId('ai-undo')).toBeEnabled();
    await page.getByTestId('ai-undo').click();
    await expect.poll(() => sourceText(page)).toBe(text);
    expect(await documentXml(page)).toBe(xmlBefore);
  });

  test('4. FR-072 - a text that is not well-formed: Send refused without a selection, the six tools, a structured call unavailable, a broken replacement rejected with line and column, a repairing one applied', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    const text = await showSource(page);
    const xmlBefore = await documentXml(page);
    // Delete the `>` of chapter one's closing </section>: the text is no longer well-formed.
    const gt = indexOfOrFail(text, '</section>') + '</section'.length;
    await select(page, gt, gt + 1);
    await page.locator('.mfbe-source-editor .cm-content').press('Delete');
    const broken = (await sourceText(page))!;
    expect(broken).toBe(text.slice(0, gt) + text.slice(gt + 1));
    expect(await isModified(page)).toBe(true);

    // The panel's Send without a selection is refused; the message names Ask AI.
    await select(page, gt, gt);
    const before = await standin.requests();
    await panelInput(page).fill('Fix the book');
    await panelInput(page).press('Enter');
    await expect(page.getByTestId('ai-status')).toHaveAttribute('data-state', 'failed');
    await expect(page.getByTestId('ai-status')).toHaveText(
      await pageText(page, 'ai.failure.sourceNotWellFormed'),
    );
    expect(await standin.requests()).toEqual(before);
    await expect(panelInput(page)).toHaveValue('Fix the book');
    expect(await sourceText(page)).toBe(broken);

    // With a selection over the broken place the request runs in text mode: the context says
    // so, the tools array holds the six, a structured call answers unavailable, a replacement
    // that keeps the text broken is rejected with the parser's line and column, one that
    // repairs it is applied after the whole-text check against the last well-formed baseline.
    const from = indexOfOrFail(broken, '<p>Дежурный подошёл');
    const to = indexOfOrFail(broken, '</section', from) + '</section'.length;
    await select(page, from, to);
    await openPopupFromMenu(page);
    const stillBroken = broken.slice(from, to).replace('куда ей.', 'куда ей идти.');
    const repaired = `${stillBroken}>`;
    await standin.scenarios([
      toolCall('c-node', 'replace_node', {
        node: 'body[1]/section[4]/p[1]',
        content: { xml: '<p>Утро.</p>' },
      }),
      { text: stillBroken },
      { text: repaired },
    ]);
    await send(page, 'Repair the XML and say where she should go');
    await expect(status(page)).toHaveAttribute('data-state', 'done', { timeout: 30_000 });

    const requests = await standin.requests();
    expect(requests).toHaveLength(3);
    const first = requests[0]!.body as unknown as ChatBody;
    expect(first.messages[0]!.content).toContain('"sourceWellFormed": false');
    expect(first.messages[0]!.content).toContain('"scriptsAvailable": false');
    expect(first.messages[0]!.content).toContain(
      '9. The document text is currently NOT well-formed XML.',
    );
    const offered = first.tools!.map((t) => t.function.name);
    expect(offered.every((name) => SIX.includes(name))).toBe(true);
    for (const name of [
      'get_context',
      'get_selection',
      'get_schema',
      'validate',
      'replace_selection',
    ]) {
      expect(offered).toContain(name);
    }
    const gated = parse<Envelope>((await lastToolMessages(standin))[0]!);
    expect(gated.error.code).toBe('unavailable');
    expect(gated.error.hint).toBe(
      'the document text is not well-formed; change the selected text so that it becomes well-formed',
    );
    // The second answer kept the text broken: the rejection went back to the model.
    const third = requests[2]!.body as unknown as ChatBody;
    const rejection = third.messages.filter((m) => m.role === 'user').at(-1)!.content;
    expect(rejection).toContain('The replacement was rejected by the FB2 2.1 schema check');
    expect(rejection).toMatch(/xml\.notWellFormed:.*\(line \d+\)/);
    // The third answer repaired the text: applied, one doc.fromXml, the model current.
    const info = (await lastRequest(page))!;
    expect(info.state).toBe('committed');
    expect(info.exchanges).toBe(3);
    expect(info.changes).toBe(1);
    expect(info.fromXmlCalls).toBe(1);
    const textAfter = (await sourceText(page))!;
    expect(textAfter).toBe(broken.slice(0, from) + repaired + broken.slice(to));
    expect(textAfter).toContain('куда ей идти.</p>');
    expect(textAfter).toContain('</section>');
    await expect(page.getByTestId('source-parse-error')).toHaveCount(0);
    const xmlAfter = await documentXml(page);
    expect(xmlAfter).toContain('куда ей идти.</p>');
    expect(binaryPlaceholders(xmlAfter)).toEqual(binaryPlaceholders(xmlBefore));
    // The text is clean again: the Body view opens without a parse error.
    await closePopup(page);
    await showBody(page);
    await expect(page.getByTestId('dialog-bad-xml')).toHaveCount(0);
    expect(await documentXml(page)).toBe(xmlAfter);
  });
});
