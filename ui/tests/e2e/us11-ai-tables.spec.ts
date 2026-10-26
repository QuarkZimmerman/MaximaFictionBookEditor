/**
 * User Story 11 (feature 006) - the AI assistant edits tables reliably (T167-T169; quickstart
 * §11; contracts/ai-catalogue.md §3.9, Δ§3.7, Δ§6.12, Δ§9.1 and "SC-010: the data-size check";
 * data-model §15; FR-049 to FR-053, FR-062, FR-063; SC-007, SC-009, SC-010). Needs the real
 * core (`MFBE_CORE_BIN`); skipped in core-less mode. The custom target is the loopback stand-in
 * (`fixtures/ai-standin.mjs`), nothing else is ever contacted (`recordOutside`). Fixture:
 * `tests/fixtures/books/ai-tables.fb2` (T017) - table 1 (4 × 3: a header cell over two
 * columns, a cell over two rows, an inline image, a cell with `xml:lang`, a cell whose id a
 * paragraph links to, a block of plain cells), table 2 (300 × 10, a header row), table 3 (a
 * short row) and table 4 (in the book's annotation). In the document's XML the tables stand in
 * the order 4, 1, 2, 3 (the description comes first).
 *
 * Scenarios:
 *  sc.1  `read_table` of table 1 as a grid - every position named, every cell with its kind,
 *        row, column, spans, attributes and text (U+FFFC for the picture), then as fb2xml
 *        (`<image l:href=…/>`); reading changes nothing; a window that starts inside the merged
 *        band lists the band's cell in `above`; a window past the end is `invalidArguments`
 *  parts a whole read of table 2 after one `context_length_exceeded` is sent again as its first
 *        part of whole rows with `more.cursor` `after:<tr id>` (Δ§6.12)
 *  sc.2  `insertColumns` after column 2 of table 2: one call, a compact result (no XML), one Undo
 *        and one Redo; *Insert column to the right* from the menu gives the same table
 *  SC-010 three changes on table 2 (a column, the first two header cells merged, a row made
 *        header cells), each its own request: the growth of the request body at most 5% of
 *        the table's XML, the system message and the tools byte-identical, no `<tr` sent
 *  sc.3  a merge whose second cell is the linked cell answers `confirmationRequired` (links 1,
 *        no strike) three times without ending the request, the XML byte-identical; a colspan
 *        growth over the linked cell answers it too (FR-052)
 *  sc.4  a ragged `replace_node` of table 1 is accepted with `tableWarning`; `repair` makes the
 *        table regular without a warning and without the mark (FR-053, FR-057)
 *  U3    a text-path replacement in the Source view and a nested `run_script` that leave a table
 *        ragged return `tableWarning` (the text form with `line`, the document form)
 *  FR-062 `validate` lists `irregularTables`: table 3, then table 3 and the ragged table 1
 *  C68   strikes per `edit_table:<op>@<table>`: three refused merges end the request
 *        `rejected` with nothing applied; a refused split counts under its own key
 *  sc.6  a block of rows 2-3 × columns 1-2 dragged in table 1: the context's selection is kind
 *        `cells` (no from, to, open ends or source), the caret the head cell, the request
 *        general and the user message the instruction alone; the merge commits as one undo
 *        step; from the popup the block is a general request whose text answer changes nothing
 *  independent test: deleteColumns, merge then split, setKind, setAttributes on a block and
 *        repair of table 3, each its own request, one Undo and one Redo, the table regular
 *  Source view: a structured edit_table leaves the caret in the focus cell; after a text-path
 *        change edit_table answers `unavailable`; text mode offers neither table tool
 *  Description view: edit_table on table 4; the end line names the Description view
 *  FR-063 a block in the book annotation's field carries `source` (needs user story 10's field
 *        table plugin and targets, T160 and T161: `test.fixme` until they exist)
 *  C7    two table requests and two script runs: every node id of the book unique
 *  activity: the summaries name the table, the rows and the operations, never a cell text or
 *        an attribute value; a ragged replacement notes the table left irregular
 *  U15   while a request waits, Insert row above is unavailable with the assistant's reason
 */

import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

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

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

const BOOK = fixtureBook('ai-tables.fb2');

/** The script group of T019: `tables.toggleRegular` toggles a short last row (FR-049). */
const TABLE_SCRIPTS = fileURLToPath(
  new URL('../../../tests/scripts/fixtures/07_Tables', import.meta.url),
);

/** The one-table message of `tableWarning` (ai-catalogue §3.9), verbatim. */
const ONE_TABLE_WARNING =
  'This change made 1 table irregular: valid FB2, but readers lay out irregular tables unpredictably. If that was not intended, make it regular with edit_table, op "repair".';

/** Table 1 replaced by a table whose second row is short (US11 sc.4). */
const RAGGED_XML =
  '<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td><td>e</td></tr></table>';

const T1 = 'body[1]/section[1]/table[1]';
const T2 = 'body[1]/section[2]/table[1]';
const T3 = 'body[1]/section[3]/table[1]';
const T4 = 'title-info/annotation[1]/table[1]';

/** The place of each table among the `<table>` elements of the document's XML. */
const XML_INDEX: Record<string, number> = { [T4]: 1, [T1]: 2, [T2]: 3, [T3]: 4 };

interface LastRequest {
  id: string;
  state: string;
  exchanges: number;
  changes: number;
}

interface ChatMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
}

interface ChatBody {
  messages: ChatMessage[];
  tools?: unknown[];
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

/** A cell of a `read_table` answer (ai-catalogue §3.9). */
interface GridCell {
  id: string;
  kind: 'th' | 'td';
  row: number;
  column: number;
  colspan?: number;
  rowspan?: number;
  attrs?: Record<string, string>;
  overlaps?: true;
  pastEnd?: true;
  text?: string;
  xml?: string;
}

interface GridRow {
  row: number;
  id: string;
  attrs?: { align?: string };
  grid: (string | null)[];
  cells: GridCell[];
}

interface ReadTableResult {
  table: { id: string; path: string; type: string };
  rowCount: number;
  columnCount: number;
  regular: boolean;
  problems?: string;
  format: string;
  fromRow: number;
  toRow: number;
  rows: GridRow[];
  above?: GridCell[];
  more?: { cursor: string; remaining: { rows: number; characters: number }; hint: string };
}

interface EditTableResult {
  table: { id: string; path: string; type: string };
  op: string;
  rowCount: number;
  columnCount: number;
  regular: boolean;
  problems?: string;
  focus: { row: number; column: number; id: string };
  newCells?: { row: number; column: number; id: string }[];
  newCellCount?: number;
  removedCells?: number;
  changed?: false;
  tableWarning?: {
    message: string;
    tables: {
      table: { id?: string; path: string; type: string };
      line?: number;
      problems: string;
    }[];
  };
}

/** A model cell, row and table as the test hook's document holds them. */
interface ModelCell {
  id: string;
  type: string;
  text: string;
}

interface ModelTable {
  id: string;
  rows: { id: string; cells: ModelCell[] }[];
}

/** The page's test hooks, as the functions passed to `page.evaluate` read them. */
interface PageHooks {
  __mfbeTest: {
    tables: { grid(id: string): Record<string, unknown> | null };
    scripts: { select(id: string, from: number, to: number): boolean; document(): unknown };
  };
}

const documentXml = (page: Page) => page.evaluate<string>('window.__mfbeTest.scripts.toXml()');
const lastRequest = (page: Page) =>
  page.evaluate<LastRequest | null>('window.__mfbeTest.ai.lastRequest()');
const lastRequestId = async (page: Page) => (await lastRequest(page))?.id ?? null;

const input = (page: Page) => page.getByTestId('ai-input');
const banner = (page: Page) => page.getByTestId('script-run-banner');

/** Opens `ai-tables.fb2` with the stand-in as the custom service; the test hooks ready. */
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
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (globalThis as unknown as Partial<PageHooks>).__mfbeTest?.scripts?.document ===
            'function' &&
          typeof (globalThis as unknown as Partial<PageHooks>).__mfbeTest?.tables?.grid ===
            'function',
      ),
    )
    .toBe(true);
}

/** The assistant on, its panel visible (feature 005, FR-040 as amended). */
async function turnOn(page: Page): Promise<void> {
  await ensureAssistantOn(page);
}

/** Types the instruction into the panel and waits for the request's end. */
async function sendAndWait(page: Page, instruction: string, timeout = 30_000) {
  const before = await lastRequestId(page);
  await input(page).fill(instruction);
  await input(page).press('Enter');
  await expect.poll(() => lastRequestId(page), { timeout }).not.toBe(before);
  await expect(page.getByTestId('ai-send')).toBeVisible({ timeout });
  await expect(banner(page)).toHaveCount(0, { timeout });
  return (await lastRequest(page))!;
}

/** The record cleared and the answers of the next request queued. */
async function queue(standin: StandinHandle, items: unknown[]): Promise<void> {
  await standin.reset();
  await standin.scenarios(items as never);
}

/** The `tool` messages of the last recorded exchange, in order. */
async function lastToolMessages(standin: StandinHandle): Promise<ChatMessage[]> {
  const requests = await standin.requests();
  const body = requests.at(-1)!.body as unknown as ChatBody;
  return body.messages.filter((m) => m.role === 'tool');
}

/** The `/chat/completions` records of the request, in order. */
async function exchanges(standin: StandinHandle) {
  return (await standin.requests()).filter((record) => record.path.endsWith('/chat/completions'));
}

const parse = <T>(message: ChatMessage): T => JSON.parse(message.content ?? 'null') as T;

/** The arguments of a stand-in tool call. */
type Args = { [member: string]: JsonValue | undefined };

/** One answer item with one tool call. */
const toolCall = (id: string, name: string, args: Args) => ({
  toolCalls: [{ id, name, arguments: args }],
});

/** The n-th `<table …>…</table>` of a document's XML (tables never nest). */
function tableXml(xml: string, n: number): string {
  const tables = xml.match(/<table\b[^>]*>[\s\S]*?<\/table>/g) ?? [];
  expect(tables.length, 'the tables of the XML').toBeGreaterThanOrEqual(n);
  return tables[n - 1]!;
}

/** The table at a structural path of the test hook's document, as JSON. */
function tableJson(page: Page, path: string): Promise<Record<string, unknown>> {
  return page.evaluate((at) => {
    type Loose = { type: string; attrs?: Record<string, unknown>; content?: Loose[] };
    const doc = (globalThis as unknown as PageHooks).__mfbeTest.scripts.document() as {
      bodies: Loose[];
      description: { titleInfo: { annotation?: Loose } };
    };
    const segments = at.split('/');
    let node: Loose | undefined;
    let rest: string[];
    if (segments[0]!.startsWith('body[')) {
      node = doc.bodies[Number(/\d+/.exec(segments[0]!)![0]) - 1];
      rest = segments.slice(1);
    } else {
      node = doc.description.titleInfo.annotation;
      rest = segments.slice(2);
    }
    for (const segment of rest) {
      const match = /^([a-z-]+)\[(\d+)\]$/.exec(segment)!;
      node = (node?.content ?? []).filter((child) => child.type === match[1])[Number(match[2]) - 1];
    }
    return JSON.parse(JSON.stringify(node ?? null)) as Record<string, unknown>;
  }, path);
}

type LooseJson = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: LooseJson[];
};

/** The table at a path: its node id, its rows' ids and its cells' ids, kinds and texts. */
async function tableModel(page: Page, path: string): Promise<ModelTable> {
  const json = (await tableJson(page, path)) as LooseJson;
  const text = (cell: LooseJson) =>
    (cell.content ?? []).map((child) => (child.type === 'text' ? child.text : '\uFFFC')).join('');
  return {
    id: String(json.attrs!.nodeId),
    rows: (json.content ?? [])
      .filter((row) => row.type === 'tr')
      .map((row) => ({
        id: String(row.attrs!.nodeId),
        cells: (row.content ?? [])
          .filter((cell) => cell.type === 'td' || cell.type === 'th')
          .map((cell) => ({ id: String(cell.attrs!.nodeId), type: cell.type!, text: text(cell) })),
      })),
  };
}

/** The node id of the cell of `table` whose text is `text`. */
function cellId(table: ModelTable, text: string): string {
  for (const row of table.rows) {
    const found = row.cells.find((cell) => cell.text === text);
    if (found) return found.id;
  }
  throw new Error(`no cell "${text}" in table ${table.id}`);
}

/** Every node id of a JSON tree. */
function nodeIds(json: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(json)) for (const item of json) nodeIds(item, into);
  else if (json && typeof json === 'object') {
    const value = json as { attrs?: { nodeId?: unknown }; content?: unknown };
    if (typeof value.attrs?.nodeId === 'string') into.add(value.attrs.nodeId);
    if (value.content) nodeIds(value.content, into);
  }
  return into;
}

/** The JSON with every node id that `known` lacks replaced by `new` (U36: new ids differ). */
function withoutNewIds(json: unknown, known: ReadonlySet<string>): unknown {
  if (Array.isArray(json)) return json.map((item) => withoutNewIds(item, known));
  if (json && typeof json === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
      if (key === 'nodeId' && typeof value === 'string' && !known.has(value)) out[key] = 'new';
      else out[key] = withoutNewIds(value, known);
    }
    return out;
  }
  return json;
}

/** The grid summary of the table with the node id `nodeId` (T041). */
function summary(page: Page, nodeId: string) {
  return page.evaluate(
    (id) => (globalThis as unknown as PageHooks).__mfbeTest.tables.grid(id),
    nodeId,
  );
}

/** The table is regular: no short row, no overlap, no span past the end. */
async function expectRegular(page: Page, nodeId: string): Promise<void> {
  expect(await summary(page, nodeId), `the grid of ${nodeId}`).toMatchObject({
    shortRows: 0,
    overlaps: 0,
    pastEnd: 0,
  });
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/**
 * One Edit → Undo gives back `before` byte for byte, one Edit → Redo `after` (SC-007, U22):
 * every request of the file that changes the book runs it.
 */
async function undoRedo(page: Page, before: string, after: string): Promise<void> {
  await menu(page, 'edit', 'undo');
  await expect.poll(() => documentXml(page), { message: 'one Undo restores the XML' }).toBe(before);
  await menu(page, 'edit', 'redo');
  await expect.poll(() => documentXml(page), { message: 'one Redo reapplies it' }).toBe(after);
}

/** The caret at `offset` of the text block with the node id `nodeId`. */
async function caretIn(page: Page, nodeId: string, offset = 1): Promise<void> {
  const placed = await page.evaluate(
    ([id, at]) => (globalThis as unknown as PageHooks).__mfbeTest.scripts.select(id, at, at),
    [nodeId, offset] as const,
  );
  expect(placed, `the caret in ${nodeId}`).toBe(true);
}

/** Runs a table command from *Add → Table structure* (`menu-add-tableStructure-<name>`). */
async function structure(page: Page, name: string): Promise<void> {
  await page.getByTestId('menu-add').click();
  await page.getByTestId('menu-add-tableStructure').click();
  const entry = page.getByTestId(`menu-add-tableStructure-${name}`);
  await expect(entry).not.toHaveAttribute('aria-disabled');
  await entry.click();
}

/** Closes every open menu level (Escape closes one level: an open submenu first). */
async function closeMenus(page: Page): Promise<void> {
  const popups = page.locator('.mfbe-menu-popup');
  for (let level = 0; level < 3 && (await popups.count()) > 0; level += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
  }
  await expect(popups).toHaveCount(0);
}

/** A cell of the Body view's tables by its node id. */
function cellLocator(page: Page, nodeId: string) {
  return page.locator(`:is(td.fb-td, th.fb-th)[data-node-id="${nodeId}"]`);
}

/** A mouse drag over the cells with these node ids, in order (a block, FR-010). */
async function drag(page: Page, ids: string[]): Promise<void> {
  await cellLocator(page, ids[0]!).scrollIntoViewIfNeeded();
  const centres: { x: number; y: number }[] = [];
  for (const nodeId of ids) {
    const box = (await cellLocator(page, nodeId).boundingBox())!;
    centres.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  const [first, ...rest] = centres;
  await page.mouse.move(first!.x, first!.y);
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 6 });
  await page.mouse.up();
}

/** The working context the system message of an exchange carries (ai-catalogue §2.1). */
function workingContext(body: ChatBody): {
  selection: Record<string, unknown>;
  caret: Record<string, unknown> | null;
  request: Record<string, unknown>;
} {
  const system = body.messages[0]!.content ?? '';
  const start = system.indexOf('{', system.indexOf('Working context (the open book right now):'));
  const end = system.indexOf("\n\nThe book's text");
  return JSON.parse(system.slice(start, end)) as ReturnType<typeof workingContext>;
}

interface ActivityRow {
  kind: string;
  request: string;
  text: string;
}

/** The activity rows of the latest request alone, in order. */
async function activityRows(page: Page): Promise<ActivityRow[]> {
  const rows = await page.evaluate<ActivityRow[]>(`Array.from(
    document.querySelectorAll('[data-testid^="ai-activity-"]'),
    (li) => ({
      kind: li.getAttribute('data-kind'),
      request: li.getAttribute('data-request'),
      text: li.querySelector('.mfbe-ai-activity-text').textContent,
    }),
  )`);
  const last = rows.at(-1)?.request;
  return rows.filter((row) => row.request === last);
}
/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('US11 (006) - the AI assistant edits tables reliably', () => {
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

  test('sc.1 read_table gives table 1 as a grid: every position named, every cell with kind, place, spans, attributes and text; a window inside the merged band lists the band in above', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    const t1 = await tableModel(page, T1);
    const id = (text: string) => cellId(t1, text);
    const picture = t1.rows[3]!.cells[0]!.id;
    const xmlBefore = await documentXml(page);

    await queue(standin, [
      toolCall('r1', 'read_table', { table: T1 }),
      toolCall('r2', 'read_table', { table: T1, format: 'fb2xml' }),
      { text: 'Read.' },
    ]);
    const done = await sendAndWait(page, 'Show me table 1');
    expect(done.changes).toBe(0);
    expect(done.state).not.toBe('committed');
    const [first, second] = await lastToolMessages(standin);
    const grid = parse<ReadTableResult>(first!);
    expect(grid).toMatchObject({
      table: { id: t1.id, path: T1, type: 'table' },
      rowCount: 4,
      columnCount: 3,
      regular: true,
      format: 'text',
      fromRow: 1,
      toRow: 4,
    });
    expect(grid.problems).toBeUndefined();
    expect(grid.above).toBeUndefined();
    expect(grid.more).toBeUndefined();
    // A merged cell's id repeats over every position it covers.
    expect(grid.rows.map((row) => row.grid)).toEqual([
      [id('h1'), id('h1'), id('h3')],
      [id('r2c1'), id('r2c2'), id('m')],
      [id('r3c1'), id('r3c2'), id('m')],
      [picture, id('r4c2'), id('r4c3')],
    ]);
    expect(grid.rows.map((row) => row.id)).toEqual(t1.rows.map((row) => row.id));
    // Each row lists the cells whose top-left position lies in it, with row and column (C63).
    expect(grid.rows.map((row) => row.cells)).toEqual([
      [
        { id: id('h1'), kind: 'th', row: 1, column: 1, colspan: 2, text: 'h1' },
        { id: id('h3'), kind: 'th', row: 1, column: 3, text: 'h3' },
      ],
      [
        { id: id('r2c1'), kind: 'td', row: 2, column: 1, text: 'r2c1' },
        { id: id('r2c2'), kind: 'td', row: 2, column: 2, text: 'r2c2' },
        { id: id('m'), kind: 'td', row: 2, column: 3, rowspan: 2, text: 'm' },
      ],
      [
        { id: id('r3c1'), kind: 'td', row: 3, column: 1, text: 'r3c1' },
        { id: id('r3c2'), kind: 'td', row: 3, column: 2, text: 'r3c2' },
      ],
      [
        { id: picture, kind: 'td', row: 4, column: 1, text: '\uFFFC' },
        { id: id('r4c2'), kind: 'td', row: 4, column: 2, attrs: { lang: 'de' }, text: 'r4c2' },
        { id: id('r4c3'), kind: 'td', row: 4, column: 3, attrs: { id: 'ai-linked' }, text: 'r4c3' },
      ],
    ]);
    // fb2xml: every cell carries xml instead, the picture as <image l:href="#…"/>.
    const xml = parse<ReadTableResult>(second!);
    expect(xml.format).toBe('fb2xml');
    const cells = xml.rows.flatMap((row) => row.cells);
    expect(cells).toHaveLength(10);
    for (const cell of cells) {
      expect(cell.text, cell.id).toBeUndefined();
      expect(typeof cell.xml, cell.id).toBe('string');
    }
    expect(cells.find((cell) => cell.id === picture)!.xml).toMatch(/^<image l:href="#[^"]+"\/>$/);
    expect(cells.find((cell) => cell.id === id('h1'))!.xml).toBe('h1');
    // Reading changed nothing.
    expect(await documentXml(page)).toBe(xmlBefore);

    // A window that starts inside the merged band; a window past the end.
    await queue(standin, [
      toolCall('w1', 'read_table', { table: T1, fromRow: 3 }),
      toolCall('w2', 'read_table', { table: T1, fromRow: 5 }),
      { text: 'Windows.' },
    ]);
    await sendAndWait(page, 'Show me the last rows of table 1');
    const [windowed, past] = await lastToolMessages(standin);
    const part = parse<ReadTableResult>(windowed!);
    expect(part).toMatchObject({ fromRow: 3, toRow: 4, rowCount: 4, columnCount: 3 });
    expect(part.rows.map((row) => row.row)).toEqual([3, 4]);
    expect(part.above).toEqual([
      { id: id('m'), kind: 'td', row: 2, column: 3, rowspan: 2, text: 'm' },
    ]);
    const refused = parse<Envelope>(past!);
    expect(refused.error).toMatchObject({
      code: 'invalidArguments',
      expected: { rowCount: 4, columnCount: 3 },
    });
    expect(refused.error.strike).toBeUndefined();
    expect(await documentXml(page)).toBe(xmlBefore);
  });

  test('parts: a whole read of the 300-row table, after one context_length_exceeded, is sent again as its first part of whole rows (Δ§6.12)', async ({
    core,
    page,
    standin,
  }) => {
    test.setTimeout(240_000);
    await openBook(core, page, standin);
    await turnOn(page);
    const t2 = await tableModel(page, T2);
    await queue(standin, [
      toolCall('p1', 'read_table', { table: T2 }),
      { overflow: true },
      { text: 'Read.' },
    ]);
    await sendAndWait(page, 'Read table 2', 120_000);
    const [message] = await lastToolMessages(standin);
    const part = parse<ReadTableResult>(message!);
    expect(part).toMatchObject({ rowCount: 300, columnCount: 10, regular: true, fromRow: 1 });
    expect(part.rows.length).toBeGreaterThan(0);
    expect(part.rows.length).toBeLessThan(300);
    // Whole rows only: each with a 10-entry grid and its ten cells.
    part.rows.forEach((row, index) => {
      expect(row.row).toBe(index + 1);
      expect(row.id).toBe(t2.rows[index]!.id);
      expect(row.grid).toHaveLength(10);
      expect(row.cells).toHaveLength(10);
    });
    expect(part.toRow).toBe(part.rows.length);
    expect(part.more!.cursor).toBe(`after:${t2.rows[part.rows.length - 1]!.id}`);
    expect(part.more!.remaining.rows).toBe(300 - part.rows.length);
    expect(part.more!.remaining.rows).toBeGreaterThan(0);
  });

  test('sc.2 one insertColumns after column 2 of the 300-row table: a compact result, one Undo and one Redo; Insert column to the right gives the same table', async ({
    core,
    page,
    standin,
  }) => {
    test.setTimeout(240_000);
    await openBook(core, page, standin);
    await turnOn(page);
    const t2 = await tableModel(page, T2);
    const known = nodeIds(await tableJson(page, T2));
    const before = await documentXml(page);

    await queue(standin, [
      toolCall('a1', 'read_table', { table: T2, fromRow: 1, toRow: 1 }),
      toolCall('a2', 'edit_table', { table: T2, op: 'insertColumns', column: 2, where: 'after' }),
      { text: 'Added.' },
    ]);
    const done = await sendAndWait(page, 'add a column Year after the second column', 120_000);
    expect(done.state).toBe('committed');
    expect(done.changes).toBe(1);
    const [, edit] = await lastToolMessages(standin);
    expect(edit!.content).not.toContain('<');
    const result = parse<EditTableResult>(edit!);
    expect(result).toMatchObject({
      table: { id: t2.id, path: T2, type: 'table' },
      op: 'insertColumns',
      rowCount: 300,
      columnCount: 11,
      regular: true,
      newCellCount: 300,
    });
    expect(result.tableWarning).toBeUndefined();
    expect(result.focus).toMatchObject({ row: 1, column: 3 });
    expect(result.newCells).toHaveLength(20);
    result.newCells!.forEach((cell, index) => {
      expect(cell).toMatchObject({ row: index + 1, column: 3 });
      expect(cell.id).toMatch(/^sc_\d+$/);
    });
    expect(result.focus.id).toBe(result.newCells![0]!.id);
    // Table 2 shows 11 columns with an empty third one: a th in row 1, tds below (FR-008).
    const added = await tableModel(page, T2);
    expect(added.rows).toHaveLength(300);
    for (const [index, row] of added.rows.entries()) {
      expect(row.cells).toHaveLength(11);
      expect(row.cells[2]).toMatchObject({ type: index === 0 ? 'th' : 'td', text: '' });
    }
    const after = await documentXml(page);
    const assistantJson = await tableJson(page, T2);
    await expectRegular(page, t2.id);
    await undoRedo(page, before, after);

    // Undo, then the user's command on a plain cell of column 2: the same table.
    await menu(page, 'edit', 'undo');
    await expect.poll(() => documentXml(page)).toBe(before);
    await caretIn(page, cellId(t2, 'r5c2'));
    await structure(page, 'insertColumnRight');
    await expect.poll(() => documentXml(page), { timeout: 60_000 }).toBe(after);
    // The model JSON too, new nodes' ids aside (sc_ from the assistant, ui_ from the Body view).
    expect(withoutNewIds(await tableJson(page, T2), known)).toEqual(
      withoutNewIds(assistantJson, known),
    );
  });

  test('SC-010: a column, a header merge and a header row on the 300-row table each add at most 5% of the table XML to the requests, and no request carries its XML', async ({
    core,
    page,
    standin,
  }) => {
    test.setTimeout(240_000);
    await openBook(core, page, standin);
    await turnOn(page);
    const changes: { name: string; args: Args }[] = [
      { name: 'insertColumns', args: { op: 'insertColumns', column: 2, where: 'after' } },
      { name: 'merge', args: { op: 'merge', row: 1, column: 1, columns: 2 } },
      { name: 'setKind', args: { op: 'setKind', kind: 'th', row: 2 } },
    ];
    for (const change of changes) {
      const before = await documentXml(page);
      const size = Buffer.byteLength(tableXml(before, XML_INDEX[T2]!), 'utf8');
      await queue(standin, [
        toolCall('q1', 'read_table', { table: T2, fromRow: 1, toRow: 1 }),
        toolCall('q2', 'edit_table', { table: T2, ...change.args }),
        { text: 'Done.' },
      ]);
      const done = await sendAndWait(page, `table 2: ${change.name}`, 120_000);
      expect(done.state, change.name).toBe('committed');
      const records = await exchanges(standin);
      expect(records, change.name).toHaveLength(3);
      const growth = records[2]!.bodyBytes - records[0]!.bodyBytes;
      const percent = (growth / size) * 100;
      test.info().annotations.push({
        type: 'SC-010',
        description: `${change.name}: ${growth} bytes of ${size} (${percent.toFixed(2)}%)`,
      });
      expect(growth, change.name).toBeLessThanOrEqual(0.05 * size);
      const bodies = records.map((record) => record.body as unknown as ChatBody);
      const system = JSON.stringify(bodies[0]!.messages[0]);
      const tools = JSON.stringify(bodies[0]!.tools);
      for (const body of bodies) {
        expect(JSON.stringify(body.messages[0]), change.name).toBe(system);
        expect(JSON.stringify(body.tools), change.name).toBe(tools);
        expect(JSON.stringify(body), change.name).not.toContain('<tr');
      }
      const after = await documentXml(page);
      expect(after).not.toBe(before);
      await undoRedo(page, before, after);
    }
    await expectRegular(page, (await tableModel(page, T2)).id);
  });

  test('sc.3 a merge or a colspan growth over the linked cell answers confirmationRequired without a strike; three attempts do not end the request; nothing changes', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    const before = await documentXml(page);
    const merge = { table: T1, op: 'merge', row: 4, column: 2, columns: 2 };
    await queue(standin, [
      toolCall('m1', 'edit_table', merge),
      toolCall('m2', 'edit_table', merge),
      toolCall('m3', 'edit_table', merge),
      toolCall('s1', 'edit_table', {
        table: T1,
        op: 'setAttributes',
        row: 4,
        column: 2,
        attrs: { colspan: 2 },
      }),
      { text: 'The editor asks before such a merge; please merge the cells there.' },
    ]);
    const done = await sendAndWait(page, 'merge these two cells');
    expect(done.state).not.toBe('rejected');
    expect(done.changes).toBe(0);
    const messages = await lastToolMessages(standin);
    expect(messages).toHaveLength(4);
    for (const message of messages) {
      const envelope = parse<Envelope>(message);
      expect(envelope.error).toMatchObject({
        code: 'confirmationRequired',
        links: 1,
        ids: ['ai-linked'],
      });
      expect(typeof envelope.error.message).toBe('string');
      expect(typeof envelope.error.hint).toBe('string');
      expect(envelope.error.strike).toBeUndefined();
    }
    // The scripted text is shown as the assistant's message; the book is as before.
    await expect(page.getByTestId('ai-panel')).toContainText('please merge the cells there');
    expect(await documentXml(page)).toBe(before);
  });

  test('sc.4 a ragged replace_node is accepted with tableWarning; repair makes table 1 regular, without a warning and without the mark; one Undo and one Redo', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    const t1 = await tableModel(page, T1);
    const before = await documentXml(page);
    await queue(standin, [
      toolCall('n1', 'replace_node', { node: T1, content: { xml: RAGGED_XML } }),
      toolCall('n2', 'edit_table', { table: T1, op: 'repair' }),
      { text: 'Repaired.' },
    ]);
    const done = await sendAndWait(page, 'replace table 1, then repair it');
    expect(done.state).toBe('committed');
    expect(done.changes).toBe(2);
    const [replaced, repaired] = await lastToolMessages(standin);
    const warning = parse<EditTableResult>(replaced!).tableWarning!;
    expect(warning.message).toBe(ONE_TABLE_WARNING);
    expect(warning.tables).toHaveLength(1);
    expect(warning.tables[0]!.table).toMatchObject({ id: t1.id, path: T1, type: 'table' });
    expect(warning.tables[0]!.problems).toBe('row 2 covers 2 of 3 columns');
    expect(warning.tables[0]!.line).toBeUndefined();
    const repair = parse<EditTableResult>(repaired!);
    expect(repair).toMatchObject({
      op: 'repair',
      regular: true,
      rowCount: 2,
      columnCount: 3,
      newCellCount: 1,
    });
    expect(repair.newCells).toEqual([{ row: 2, column: 3, id: expect.stringMatching(/^sc_\d+$/) }]);
    expect(repair.tableWarning).toBeUndefined();
    // After the commit table 1 is regular and carries no mark (T130).
    await expectRegular(page, t1.id);
    const table = page.locator(`[data-testid="body-table"][data-node-id="${t1.id}"]`);
    await expect(table).not.toHaveAttribute('data-irregular', 'true');
    await expect(table.getByTestId('body-table-mark')).toHaveCount(0);
    await undoRedo(page, before, await documentXml(page));
  });

  test('U3 a text-path replacement in the Source view returns tableWarning in the text form, with the line of the table', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    const sourceText = () =>
      page.evaluate<string | null>('window.__mfbeTest.sourceMapping.sourceText()');
    const text = (await sourceText())!;
    // Table 4 (the annotation's) stands first; its second row's first cell from inside its text
    // through the end of the row's second </td> - half an element: the text path.
    const tableAt = text.indexOf('<table');
    const from = text.indexOf('r2c1', tableAt) + 2;
    const secondEnd = text.indexOf('</td>', text.indexOf('r2c2', tableAt)) + '</td>'.length;
    const selected = text.slice(from, secondEnd);
    const kept = selected.slice(0, selected.indexOf('</td>') + '</td>'.length);
    const placed = await page.evaluate<boolean>(
      `window.__mfbeTest.sourceMapping.select(${from}, ${secondEnd})`,
    );
    expect(placed).toBe(true);
    await queue(standin, [
      toolCall('x1', 'replace_selection', { content: { xml: kept } }),
      { text: 'Replaced.' },
    ]);
    await page.evaluate(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150))))',
    );
    const content = page.locator('.mfbe-source-editor .cm-content');
    const box = (await content.boundingBox())!;
    await page.evaluate(
      `(() => document.querySelector('.mfbe-source-editor .cm-content').dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2,
          clientX: ${Math.round(box.x + 40)}, clientY: ${Math.round(box.y + 40)} })))()`,
    );
    await page.getByTestId('source-context-menu-ai.ask').click();
    await expect(page.getByTestId('dialog-ai-ask')).toBeVisible();
    const before = await lastRequestId(page);
    await page.getByTestId('dialog-ai-ask-input').fill('remove the second cell');
    await page.getByTestId('dialog-ai-ask-input').press('Enter');
    await expect.poll(() => lastRequestId(page)).not.toBe(before);
    await expect(banner(page)).toHaveCount(0);
    expect((await lastRequest(page))!.state).toBe('committed');
    const [message] = await lastToolMessages(standin);
    const result = parse<EditTableResult>(message!);
    const line = text.slice(0, tableAt).split('\n').length;
    expect(result.tableWarning!.message).toBe(ONE_TABLE_WARNING);
    expect(result.tableWarning!.tables).toEqual([
      { table: { path: T4, type: 'table' }, line, problems: 'row 2 covers 1 of 2 columns' },
    ]);
    await page.keyboard.press('Escape');
    await menu(page, 'edit', 'undo');
    await expect.poll(sourceText).toBe(text);
  });

  test('U3 a nested run_script that leaves table 2 ragged returns tableWarning; one Undo', async ({
    core,
    page,
    standin,
  }) => {
    test.setTimeout(240_000);
    const target = path.join(core.dataDir!, 'scripts', '07_Tables');
    if (!existsSync(target)) cpSync(TABLE_SCRIPTS, target, { recursive: true });
    await core.rpc('scripts.reload');
    await openBook(core, page, standin);
    await turnOn(page);
    const t2 = await tableModel(page, T2);
    const before = await documentXml(page);
    await caretIn(page, cellId(t2, 'r1c1'));
    await queue(standin, [
      toolCall('s1', 'run_script', { id: 'tables.toggleRegular' }),
      { text: 'Ran.' },
    ]);
    const done = await sendAndWait(page, 'run the table script', 120_000);
    expect(done.state).toBe('committed');
    const [message] = await lastToolMessages(standin);
    const result = parse<{
      status: string;
      changed: boolean;
      tableWarning?: EditTableResult['tableWarning'];
    }>(message!);
    expect(result).toMatchObject({ status: 'done', changed: true });
    expect(result.tableWarning!.tables[0]!.table).toMatchObject({ path: T2, type: 'table' });
    expect(result.tableWarning!.tables[0]!.problems).toBe('row 300 covers 9 of 10 columns');
    await menu(page, 'edit', 'undo');
    await expect.poll(() => documentXml(page), { timeout: 60_000 }).toBe(before);
  });

  test('FR-062 validate lists irregularTables: table 3, then table 3 and the ragged table 1; never a regular table', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    await queue(standin, [
      toolCall('v1', 'validate', {}),
      toolCall('v2', 'replace_node', { node: T1, content: { xml: RAGGED_XML } }),
      toolCall('v3', 'validate', {}),
      { text: 'Validated.' },
    ]);
    await sendAndWait(page, 'validate, replace table 1, validate');
    type Validation = {
      warnings: number;
      irregularTables: { table: { path: string; type: string }; line?: number; problems: string }[];
    };
    const [first, , second] = await lastToolMessages(standin);
    const early = parse<Validation>(first!);
    expect(early.irregularTables).toHaveLength(1);
    expect(early.irregularTables[0]!.table).toMatchObject({ path: T3, type: 'table' });
    expect(early.irregularTables[0]!.problems).toBe('row 2 covers 2 of 3 columns');
    expect(early.irregularTables[0]!.line).toBeUndefined();
    expect(early.warnings).toBeGreaterThanOrEqual(1);
    const late = parse<Validation>(second!);
    expect(late.irregularTables.map((entry) => entry.table.path).sort()).toEqual([T1, T3].sort());
    for (const entry of late.irregularTables) {
      expect(entry.line).toBeUndefined();
      expect(entry.problems).toBe('row 2 covers 2 of 3 columns');
    }
    expect(late.warnings).toBeGreaterThanOrEqual(2);
  });

  test('C68 strikes: three refused merges of one table end the request rejected with nothing applied; a refused split counts under its own key', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    const t1 = await tableModel(page, T1);
    const before = await documentXml(page);
    const merge = { table: T1, op: 'merge', row: 2, column: 1 };
    await queue(standin, [
      toolCall('k1', 'edit_table', { table: T1, op: 'setKind', kind: 'th', row: 2 }),
      toolCall('k2', 'edit_table', merge),
      toolCall('k3', 'edit_table', { table: T1, op: 'split', row: 2, column: 1 }),
      toolCall('k4', 'edit_table', merge),
      toolCall('k5', 'edit_table', merge),
      { text: 'Never reached.' },
    ]);
    const done = await sendAndWait(page, 'merge the first cell of row 2');
    expect(done.state).toBe('rejected');
    const messages = await lastToolMessages(standin);
    // The last exchange carries the first four results; the fifth ended the request.
    expect(messages).toHaveLength(4);
    expect(parse<EditTableResult>(messages[0]!)).toMatchObject({ op: 'setKind', regular: true });
    expect(parse<Envelope>(messages[1]!).error).toMatchObject({
      code: 'notAllowed',
      reason: 'needs-block',
      strike: { count: 1, of: 3 },
    });
    expect(parse<Envelope>(messages[2]!).error).toMatchObject({
      code: 'notAllowed',
      reason: 'not-merged',
      strike: { count: 1, of: 3 },
    });
    expect(parse<Envelope>(messages[3]!).error).toMatchObject({
      code: 'notAllowed',
      reason: 'needs-block',
      strike: { count: 2, of: 3 },
    });
    // The third strike of edit_table:merge@<table 1> ended the request: nothing applied.
    expect(await documentXml(page)).toBe(before);
    expect(t1.id).toBeTruthy();
  });

  test('sc.6 a block of rows 2-3 × columns 1-2 reaches the request as kind cells, the instruction alone; the merge is one undo step; from the popup a text answer changes nothing', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    const t1 = await tableModel(page, T1);
    const id = (text: string) => cellId(t1, text);
    const before = await documentXml(page);
    await drag(page, [id('r2c1'), id('r3c2')]);
    await expect(page.locator('.mfbe-cell-selected')).toHaveCount(4);
    await queue(standin, [
      toolCall('c1', 'edit_table', {
        table: T1,
        op: 'merge',
        row: 2,
        column: 1,
        rows: 2,
        columns: 2,
      }),
      { text: 'Merged.' },
    ]);
    const done = await sendAndWait(page, 'merge these cells');
    expect(done.state).toBe('committed');
    const [q1] = await exchanges(standin);
    const body = q1!.body as unknown as ChatBody;
    const context = workingContext(body);
    expect(context.selection).toMatchObject({
      kind: 'cells',
      characters: 16,
      paragraphs: 4,
      hasInlineElements: false,
      table: { id: t1.id, path: T1, type: 'table' },
      row: 2,
      column: 1,
      rows: 2,
      columns: 2,
    });
    for (const member of ['from', 'to', 'openStart', 'openEnd', 'source']) {
      expect(context.selection, member).not.toHaveProperty(member);
    }
    expect(context.caret).toMatchObject({ id: id('r3c2') });
    expect(context.request).toMatchObject({ kind: 'general' });
    expect(body.messages.find((m) => m.role === 'user')!.content).toBe('merge these cells');
    const merged = (await tableJson(page, T1)) as LooseJson;
    const keeper = merged.content![1]!.content![0]!;
    // Row 3 is left without a cell of its own: compacted away (decision 1, FR-007), so the merged
    // cell spans one row - as the user's Merge cells gives it.
    expect(keeper.attrs).toMatchObject({ nodeId: id('r2c1'), colspan: 2 });
    expect(keeper.attrs).not.toHaveProperty('rowspan');
    expect(keeper.content!.map((n) => n.text).join('')).toBe('r2c1 r2c2 r3c1 r3c2');
    const after = await documentXml(page);
    await undoRedo(page, before, after);
    await menu(page, 'edit', 'undo');
    await expect.poll(() => documentXml(page)).toBe(before);

    // From the popup: the same block, a right-click inside it keeps it (T045).
    await drag(page, [id('r2c1'), id('r3c2')]);
    await expect(page.locator('.mfbe-cell-selected')).toHaveCount(4);
    await cellLocator(page, id('r3c1')).click({ button: 'right' });
    await page.getByTestId('context-menu-ai.ask').click();
    await expect(page.getByTestId('dialog-ai-ask')).toBeVisible();
    await expect(page.getByTestId('dialog-ai-ask-selection')).toHaveText(
      await pageText(page, 'ai.popup.selectionSize', { count: 4, characters: 16 }),
    );
    await queue(standin, [{ text: 'These are four cells of table 1.' }]);
    const previous = await lastRequestId(page);
    await page.getByTestId('dialog-ai-ask-input').fill('what is this?');
    await page.getByTestId('dialog-ai-ask-input').press('Enter');
    await expect.poll(() => lastRequestId(page)).not.toBe(previous);
    await expect(page.getByTestId('dialog-ai-ask-status')).toHaveText(
      await pageText(page, 'ai.popup.answered'),
    );
    const [popupQ1] = await exchanges(standin);
    const popupBody = popupQ1!.body as unknown as ChatBody;
    expect(popupBody.messages.filter((m) => m.role === 'user').at(-1)!.content).toBe(
      'what is this?',
    );
    await page.keyboard.press('Escape');
    expect(await documentXml(page)).toBe(before);
  });

  test('the independent test: deleteColumns, merge then split, setKind, setAttributes on a block and repair - each request one Undo and one Redo, the table regular after each', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    const t1 = (await tableModel(page, T1)).id;
    const t3 = (await tableModel(page, T3)).id;
    const requests: { calls: Args[]; table: string }[] = [
      { calls: [{ table: T1, op: 'deleteColumns', column: 1 }], table: t1 },
      {
        calls: [
          { table: T1, op: 'merge', row: 2, column: 1, columns: 2 },
          { table: T1, op: 'split', row: 2, column: 1 },
        ],
        table: t1,
      },
      { calls: [{ table: T1, op: 'setKind', kind: 'th', row: 3 }], table: t1 },
      {
        calls: [
          {
            table: T1,
            op: 'setAttributes',
            row: 2,
            column: 1,
            rows: 2,
            columns: 2,
            attrs: { align: 'center' },
          },
        ],
        table: t1,
      },
      { calls: [{ table: T3, op: 'repair' }], table: t3 },
    ];
    for (const [index, request] of requests.entries()) {
      const before = await documentXml(page);
      await queue(standin, [
        ...request.calls.map((args, n) => toolCall(`i${index}-${n}`, 'edit_table', args)),
        { text: 'Done.' },
      ]);
      const done = await sendAndWait(page, `table change ${index + 1}`);
      expect(done.state, `request ${index + 1}`).toBe('committed');
      expect(done.changes).toBe(request.calls.length);
      for (const message of await lastToolMessages(standin)) {
        expect(parse<EditTableResult>(message).regular).toBe(true);
      }
      await expectRegular(page, request.table);
      await undoRedo(page, before, await documentXml(page));
    }
    // The header cell over two columns shrank to one; the block of four is centred.
    const xml = tableXml(await documentXml(page), XML_INDEX[T1]!);
    expect(xml).not.toContain('colspan');
    expect(xml.match(/align="center"/g)).toHaveLength(4);
    const repaired = tableXml(await documentXml(page), XML_INDEX[T3]!);
    expect(repaired.match(/<td/g)).toHaveLength(9);
  });

  test('the Source view: a structured edit_table leaves the caret on the new row; after a text-path change edit_table is unavailable; text mode offers neither table tool', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    const sourceText = () =>
      page.evaluate<string | null>('window.__mfbeTest.sourceMapping.sourceText()');
    const selection = () =>
      page.evaluate<{ anchor: number; head: number } | null>(
        'window.__mfbeTest.sourceMapping.sourceSelection()',
      );
    const select = async (anchor: number, head: number) => {
      const placed = await page.evaluate<boolean>(
        `window.__mfbeTest.sourceMapping.select(${anchor}, ${head})`,
      );
      expect(placed).toBe(true);
      await expect.poll(selection).toEqual({ anchor, head });
    };
    const text = (await sourceText())!;
    await select(0, 0);

    // A structured change: committed, the text re-rendered, the caret in the focus cell.
    await queue(standin, [
      toolCall('s1', 'edit_table', { table: T1, op: 'insertRows', row: 2, where: 'after' }),
      { text: 'Inserted.' },
    ]);
    expect((await sendAndWait(page, 'add a row after row 2 of table 1')).state).toBe('committed');
    const changed = (await sourceText())!;
    expect(changed).not.toBe(text);
    const table1At = changed.indexOf('<table', changed.indexOf('<table') + 1);
    let rowAt = table1At;
    for (let n = 0; n < 3; n += 1) rowAt = changed.indexOf('<tr', rowAt + 1);
    const cellAt = changed.indexOf('<td', rowAt);
    const lineOf = (offset: number) => changed.slice(0, offset).split('\n').length;
    await expect.poll(async () => lineOf((await selection())!.head)).toBe(lineOf(cellAt));

    // A text-path change of half an element, then edit_table: unavailable, no strike.
    const now = (await sourceText())!;
    const t3At = now.lastIndexOf('<table');
    const from = now.indexOf('>a<', t3At) + 1;
    const to = now.indexOf('</td>', from) + '</td>'.length;
    await select(from, to);
    await queue(standin, [
      toolCall('s2', 'replace_selection', { content: { xml: 'A</td>' } }),
      toolCall('s3', 'edit_table', { table: T3, op: 'repair' }),
      { text: 'Done.' },
    ]);
    await sendAndWait(page, 'capitalise the a');
    const [, gated] = await lastToolMessages(standin);
    const envelope = parse<Envelope>(gated!);
    expect(envelope.error).toMatchObject({
      code: 'unavailable',
      hint: 'the document text was changed as text in this request; continue with text replacements of the selection or finish',
    });
    expect(envelope.error.strike).toBeUndefined();

    // Text mode: a `>` deleted elsewhere - the six tools only, the passage still in the prompt.
    const broken = (await sourceText())!;
    const at = broken.indexOf('<p>This paragraph links') + '<p'.length;
    await select(at, at + 1);
    await page.keyboard.press('Delete');
    await expect.poll(sourceText).not.toBe(broken);
    const word = (await sourceText())!.indexOf('This paragraph');
    await select(word, word + 4);
    await queue(standin, [{ text: 'Text mode.' }]);
    await sendAndWait(page, 'what is selected?');
    const [q1] = await exchanges(standin);
    const body = q1!.body as unknown as ChatBody;
    const offered = (body.tools ?? []) as { function: { name: string } }[];
    expect(offered.map((tool) => tool.function.name).sort()).toEqual(
      [
        'get_context',
        'get_selection',
        'get_schema',
        'read_resource',
        'validate',
        'replace_selection',
      ].sort(),
    );
    expect(body.messages[0]!.content).toContain('Tables: a table cell');
  });

  test('the Description view: edit_table on table 4 of the book annotation; the end line names the Description view; one Undo and one Redo', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    await page.getByTestId('view-description').click();
    const field = page.getByTestId('description-annotation');
    await expect(field.locator('tr')).toHaveCount(2);
    const before = await documentXml(page);
    await queue(standin, [
      toolCall('d1', 'edit_table', { table: T4, op: 'insertRows', row: 2, where: 'after' }),
      { text: 'Added a row.' },
    ]);
    expect((await sendAndWait(page, 'add a row to the annotation table')).state).toBe('committed');
    await expect(field.locator('tr')).toHaveCount(3);
    const end = page.locator('[data-testid^="ai-activity-"][data-kind="request.done"]').last();
    await expect(end).toContainText(
      await pageText(page, 'ai.activity.changesDescription', { count: 1 }),
    );
    await undoRedo(page, before, await documentXml(page));
  });

  test('FR-063 a block of two cells of table 4 in the book annotation field reaches the request as kind cells with source annotation; the merge is one undo step', async ({
    core,
    page,
    standin,
  }) => {
    // The field's table plugin and its table target are user story 10's (T160, T161); the
    // request reads a field's block through `activeTableTarget` once they exist.
    test.fixme(
      true,
      'needs the field table plugin and field targets of user story 10 (T160, T161)',
    );
    await openBook(core, page, standin);
    await turnOn(page);
    const t4 = await tableModel(page, T4);
    await page.getByTestId('view-description').click();
    const field = page.getByTestId('description-annotation');
    await field.locator(`[data-node-id="${cellId(t4, 'r1c1')}"]`).click();
    await field.locator(`[data-node-id="${cellId(t4, 'r1c2')}"]`).click({ modifiers: ['Shift'] });
    await expect(field.locator('.mfbe-cell-selected')).toHaveCount(2);
    const before = await documentXml(page);
    await queue(standin, [
      toolCall('f1', 'get_selection', {}),
      toolCall('f2', 'edit_table', { table: T4, op: 'merge', row: 1, column: 1, columns: 2 }),
      { text: 'Merged.' },
    ]);
    expect((await sendAndWait(page, 'merge these cells')).state).toBe('committed');
    const [q1] = await exchanges(standin);
    const context = workingContext(q1!.body as unknown as ChatBody);
    expect(context.selection).toMatchObject({
      kind: 'cells',
      characters: 8,
      paragraphs: 2,
      hasInlineElements: false,
      table: { id: t4.id, path: T4, type: 'table' },
      row: 1,
      column: 1,
      rows: 1,
      columns: 2,
      source: { view: 'description', field: 'annotation' },
    });
    const [selected] = await lastToolMessages(standin);
    expect(parse<Record<string, unknown>>(selected!).source).toEqual({
      view: 'description',
      field: 'annotation',
    });
    expect(tableXml(await documentXml(page), XML_INDEX[T4]!)).toContain('colspan="2"');
    await undoRedo(page, before, await documentXml(page));
  });

  test('C7 ids: two table requests in a row and two script runs leave every node id of the book unique; the second request numbers past the first', async ({
    core,
    page,
    standin,
  }) => {
    test.setTimeout(240_000);
    const target = path.join(core.dataDir!, 'scripts', '07_Tables');
    if (!existsSync(target)) cpSync(TABLE_SCRIPTS, target, { recursive: true });
    await core.rpc('scripts.reload');
    await openBook(core, page, standin);
    await turnOn(page);
    const numbers: number[][] = [];
    for (const args of [
      { op: 'insertColumns', column: 1, where: 'before' },
      { op: 'insertRows', row: 4, where: 'after' },
    ]) {
      await queue(standin, [toolCall('id', 'edit_table', { table: T1, ...args }), { text: 'Ok.' }]);
      expect((await sendAndWait(page, 'change table 1')).state).toBe('committed');
      const [message] = await lastToolMessages(standin);
      numbers.push(
        parse<EditTableResult>(message!).newCells!.map((cell) => Number(cell.id.slice(3))),
      );
    }
    expect(Math.min(...numbers[1]!)).toBeGreaterThan(Math.max(...numbers[0]!));
    const t2 = await tableModel(page, T2);
    for (let run = 0; run < 2; run += 1) {
      await caretIn(page, cellId(t2, 'r1c1'));
      const before = await documentXml(page);
      await page.getByTestId('menu-scripts').click();
      await page.getByTestId('menu-scripts-07_Tables').hover();
      await page.getByTestId('menu-scripts-07_Tables-tables.toggleRegular').click();
      await expect.poll(() => documentXml(page), { timeout: 60_000 }).not.toBe(before);
    }
    const ids = await page.evaluate(() => {
      const seen: string[] = [];
      const visit = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        const value = node as { attrs?: { nodeId?: unknown }; content?: unknown[] };
        if (typeof value.attrs?.nodeId === 'string') seen.push(value.attrs.nodeId);
        for (const child of value.content ?? []) visit(child);
      };
      const hooks = globalThis as unknown as {
        __mfbeTest: { scripts: { document(): unknown } };
      };
      const doc = hooks.__mfbeTest.scripts.document() as {
        bodies: unknown[];
        description: {
          titleInfo: { annotation?: unknown };
          srcTitleInfo?: { annotation?: unknown };
          documentInfo: { history?: unknown };
        };
      };
      for (const body of doc.bodies) visit(body);
      visit(doc.description.titleInfo.annotation);
      visit(doc.description.srcTitleInfo?.annotation);
      visit(doc.description.documentInfo.history);
      return seen;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the activity list names the table, the rows and the operations, never a cell text or an attribute value; a ragged replacement notes the table left irregular', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    await queue(standin, [
      toolCall('a1', 'read_table', { table: T1, fromRow: 1, toRow: 1 }),
      toolCall('a2', 'edit_table', { table: T1, op: 'insertColumns', column: 2, where: 'after' }),
      toolCall('a3', 'edit_table', {
        table: T1,
        op: 'setAttributes',
        row: 2,
        column: 1,
        attrs: { align: 'center', lang: 'de' },
      }),
      { text: 'Done.' },
    ]);
    await sendAndWait(page, 'change table 1');
    const rows = (await activityRows(page)).filter(
      (row) => row.kind === 'tool.call' || row.kind === 'tool.result',
    );
    const texts = rows.map((row) => row.text);
    expect(texts).toContain(
      await pageText(page, 'ai.activity.summary.readTableRowsSized', {
        from: 1,
        to: 1,
        target: T1,
        rows: 4,
        columns: 3,
      }),
    );
    const inserted = await pageText(page, 'ai.activity.summary.editTable', {
      target: T1,
      operation: await pageText(page, 'ai.activity.summary.tableOp.insertColumns', { count: 1 }),
    });
    expect(texts).toContain(inserted);
    const attributes = await pageText(page, 'ai.activity.summary.editTable', {
      target: T1,
      operation: await pageText(page, 'ai.activity.summary.tableOp.setAttributes.cells', {
        names: 'align, lang',
      }),
    });
    expect(texts).toContain(attributes);
    for (const text of texts) {
      expect(text).not.toMatch(/\b(h1|h3|r\dc\d|center|de)\b/);
    }

    await queue(standin, [
      toolCall('a4', 'replace_node', { node: T1, content: { xml: RAGGED_XML } }),
      { text: 'Replaced.' },
    ]);
    await sendAndWait(page, 'replace table 1');
    // The tool.call row carries the summary the result completed (`updateActivity`).
    const result = (await activityRows(page)).filter((row) => row.kind === 'tool.call').at(-1)!;
    const replaced = await pageText(page, 'ai.activity.summary.replaceNode', {
      target: `${await pageText(page, 'ai.activity.element.table')} ${T1}`,
    });
    expect(result.text).toBe(
      await pageText(page, 'ai.activity.summary.tablesLeftIrregular', {
        summary: replaced,
        count: 1,
      }),
    );
  });

  test('U15 the run lock: while a request waits, Add → Table structure → Insert row above is unavailable with the assistant’s reason, and enabled again after the answer', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    const t1 = await tableModel(page, T1);
    await caretIn(page, cellId(t1, 'r2c1'));
    await queue(standin, [{ text: 'Later.', delayMs: 4000 }]);
    await input(page).fill('wait a moment');
    await input(page).press('Enter');
    await expect(banner(page)).toBeVisible();
    await page.getByTestId('menu-add').click();
    await expect(page.getByTestId('menu-add-popup')).toBeVisible();
    await page.getByTestId('menu-add-tableStructure').hover();
    const entry = page.getByTestId('menu-add-tableStructure-insertRowAbove');
    const reason = await pageText(page, 'commands.unavailable.title', {
      command: await pageText(page, 'tables.cmd.insertRowAbove.tooltip'),
      reason: await pageText(page, 'commands.unavailable.runLock.ai'),
    });
    await expect(entry).toHaveAttribute('aria-disabled', 'true');
    await expect(entry).toHaveAttribute('title', reason);
    await expect(entry).toHaveAttribute('aria-description', reason);
    await closeMenus(page);
    await expect(banner(page)).toHaveCount(0, { timeout: 30_000 });
    await caretIn(page, cellId(t1, 'r2c1'));
    await page.getByTestId('menu-add').click();
    await expect(page.getByTestId('menu-add-popup')).toBeVisible();
    await page.getByTestId('menu-add-tableStructure').hover();
    await expect(page.getByTestId('menu-add-tableStructure-insertRowAbove')).not.toHaveAttribute(
      'aria-disabled',
    );
    await closeMenus(page);
  });
});
