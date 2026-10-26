/**
 * Feature 006 - every table command from every surface (T185; C5; SC-008, SC-007; FR-039 to
 * FR-043, FR-048, FR-049; the spec's edge cases "Fast Mode keeps every command available",
 * "While a script runs … every table command is unavailable" and "The container commands …
 * stay unavailable inside tables"; decisions 2 and 15; C6, C27, C28; U6, U38, U40; quickstart
 * §2, §12 and §17; research R2.5, R2.17 and R8; resource-formats.md Tests §7 and §19).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode. Every test opens `tests/fixtures/books/tables.fb2` (T012, T014) through a
 * queued `dialog.openFile` and finds its tables by the paragraph before each; texts are compared
 * in the interface language (`pageText`, `uiText`). The worker's core is shared by the tests of
 * a worker, and this file's tests may run in parallel workers: each test leaves the worker's
 * settings as it found them - the toolbar layout, the hotkeys, the assistant's settings, Fast
 * Mode (which test 3's F5 turns on and persists), Restore position (off, so no reopened book
 * puts a remembered caret back), the AI panel and the Table dialog's values. `beforeAll` copies
 * the script groups `07_Tables` (`tables.read`, FR-049) and `06_Runs` (`runs.longSilent`,
 * FR-048) into the worker's data folder. The assistant, where a test turns it on, is the custom
 * target pointed at the loopback stand-in; nothing else is ever contacted (`recordOutside`).
 *
 * The places of the commands (`PLACES`), each with its result in the XML:
 *  - the twelve row and column commands, *Toggle header cell*, *Toggle header row*, *Toggle
 *    header column*, *Select table*, *Delete table* and the two paragraph commands at `r2c2` of
 *    US2 table (1), `[r1c1, r1c2, r1c3] / [r2c1 id=us2-r2c1, r2c2, r2c3] align=center / [r3c1,
 *    r3c2, r3c3]`;
 *  - *Merge cells* on its block `r2c2`-`r3c3`, whose cells carry no id, and *Make header cells*
 *    on its block `r2c1`-`r3c2`; *Make normal cells* on the block `h1`-`r2c2` of US2 table (3),
 *    `[h1 th, h2 th colspan=2] / [r2c1, r2c2, r2c3 align=right] / [r3c1, r3c2, r3c3 lang=de]`;
 *  - *Split cell* in `a` of US2 table (2), `[a rowspan 2, b] / [c]`; *Repair table* in the
 *    vectors' `short-row` table `t2`; *Table…* at the end of the paragraph after US2 table (1),
 *    confirmed with the dialog's values (2 × 2).
 *
 * Tests:
 *  1. every command from every surface (SC-008; FR-039 to FR-041, FR-043, FR-049; C27, C28;
 *     U40): the 25 offered buttons added through *Customize toolbar*, each with its 24 px icon;
 *     at every place the Add menu's *Table structure*, the context menu's (whose table section
 *     holds *Table…* and the submenu, nothing else) and the toolbar agree on every command's
 *     state and reason, each unavailable one saying "<command>: <reason>"; the place's command
 *     from the menu - its result in the XML, one Undo, one Redo, one more Undo (SC-007) -, then
 *     from the context menu and from its button, each giving the same XML; after each menu run
 *     whose table remains, the table as the model, a script (`tables.read`) and the assistant's
 *     `read_part` see it (FR-049); the container commands unavailable in a cell; *Reset*;
 *  2. a chord the user assigns acts only in a table (FR-042; decision 15; C6): the Hotkeys page
 *     lists the 24 commands without a shortcut; a chord assigned to *Insert row below* inserts a
 *     row in a Body cell and in a cell of the book annotation's field (one Undo, one Redo each,
 *     the field's through the Description view's undo) and nothing with the caret in a
 *     paragraph or the focus in the Find dialog, the assistant's field or the Table bar's cell
 *     id; *Default* removes it, and `hotkeys.json` holds no table chord;
 *  3. Fast Mode keeps every command (U38): the entries of *Table structure* at every place as
 *     without it; *Insert row below*, *Merge cells* and *Repair table* with one Undo and one Redo;
 *  4. every table command waits for a script or a request (FR-048; data-model §6.5): during a
 *     script run started in the Body view, and one started in the book annotation's field, every
 *     entry of *Table structure* and *Table* unavailable with the script's reason and no context
 *     menu on a cell; during a request to the assistant the request's reason; afterwards every
 *     entry as before;
 *  5. @platform (U6; FR-040; C28; research R2.5): with the caret in a paragraph, a right-click
 *     straight on a cell moves the caret there, and *Insert row below* from its context menu acts
 *     there, while *Split cell* says why it is unavailable - the Windows and macOS e2e legs run it
 *     with their own core;
 *  6. the table buttons at scale 2 (resource-formats.md Tests §19): shown at their natural CSS
 *     width, 24, as `keyboard-hidpi.spec.ts` checks the original buttons.
 */

import { cpSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

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
import {
  catalogueEntries,
  pageLang,
  pageText,
  plainText,
  uiText,
  type UiLang,
} from './fixtures/i18n';
import { LINE_END } from './fixtures/keys';

/* ------------------------------------------------------------------------ */
/* The model JSON and the page's hooks                                      */
/* ------------------------------------------------------------------------ */

interface Json {
  type: string;
  attrs?: Record<string, unknown> & { nodeId?: string };
  content?: Json[];
  text?: string;
}

interface DocJson {
  docId: string;
  bodies: Json[];
  description: { titleInfo: { annotation?: Json } };
}

interface ModelPoint {
  nodeId: string;
  offset: number;
}

/** The active table edit target as the tables' test hook describes it (`tables.target()`). */
interface TargetInfo {
  kind: 'body' | 'description';
  key: string;
  selection: { head: string | null };
}

interface LastRequest {
  id: string;
  state: string;
  changes: number;
}

declare const window: {
  devicePixelRatio: number;
  __mfbeTest?: {
    scripts?: {
      document(): DocJson;
      toXml(): Promise<string>;
      select(nodeId: string, from?: number, to?: number): boolean;
      selectRange(anchor: ModelPoint, head: ModelPoint): boolean;
      list(): { id: string }[];
      run(id: string): Promise<{ status: string; message?: string }>;
    };
    tables?: {
      grid(tableRef: string): { rows: number; columns: number } | null;
      target(): TargetInfo | null;
    };
    ai?: { lastRequest(): LastRequest | null };
  };
};

/* ------------------------------------------------------------------------ */
/* The fixture                                                              */
/* ------------------------------------------------------------------------ */

const TABLES = fixtureBook('tables.fb2');
const SCRIPT_FIXTURES = fileURLToPath(new URL('../../../tests/scripts/fixtures', import.meta.url));

/** The paragraphs before the tables (the scenario tables of `tables.fb2`, T014). */
const T1 = 'US2 sc.1, sc.8, sc.9, sc.11, manual step 12';
const T2 = 'US2 sc.2, sc.4';
const T3 = 'US2 sc.3 and its edge cases';
const T4 = 'US2 sc.5';
const T6_ROW = 'US2 sc.7 (one row)';
const SHORT_ROW = 'Case short-row (US8 sc.1)';
const AFTER_SHORT_ROW = 'Case repair-shift (C1)';

/** The 24 table commands in FR-039's order. */
const FR039 = [
  'insertRowAbove',
  'insertRowBelow',
  'deleteRow',
  'insertColumnLeft',
  'insertColumnRight',
  'deleteColumn',
  'mergeCells',
  'splitCell',
  'toggleHeaderCell',
  'makeHeaderCells',
  'makeNormalCells',
  'toggleHeaderRow',
  'toggleHeaderColumn',
  'repair',
  'select',
  'delete',
  'moveRowUp',
  'moveRowDown',
  'moveColumnLeft',
  'moveColumnRight',
  'duplicateRow',
  'duplicateColumn',
  'paragraphBefore',
  'paragraphAfter',
];

/** The buttons the Commands toolbar offers beyond its original layout (FR-041). */
const OFFERED = ['insert.table', ...FR039.map((name) => `table.${name}`)];

/** The chord test 2 assigns: no command uses it (C6). */
const CHORD = 'Control+Alt+Shift+F10';

/* ------------------------------------------------------------------------ */
/* The XML                                                                  */
/* ------------------------------------------------------------------------ */

/** The XML with the white space between tags removed and an empty cell or paragraph as `<x/>`. */
function flat(xml: string): string {
  return xml.replace(/>\s+</g, '><').replace(/<(t[dhr]|p)((?:\s[^>]*)?)><\/\1>/g, '<$1$2/>');
}

/** The flattened XML from the paragraph `from` up to the paragraph `to`. */
function segment(xml: string, from: string, to: string): string {
  const text = flat(xml);
  const start = text.indexOf(`<p>${from}</p>`);
  expect(start, `the paragraph "${from}"`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf(`<p>${to}</p>`, start);
  expect(end, `the paragraph "${to}" after "${from}"`).toBeGreaterThan(start);
  return text.slice(start, end);
}

function tr(cells: string, align?: string): string {
  return `<tr${align ? ` align="${align}"` : ''}>${cells}</tr>`;
}

function td(text = '', attrs = ''): string {
  return text === '' ? `<td${attrs}/>` : `<td${attrs}>${text}</td>`;
}

function th(text = '', attrs = ''): string {
  return text === '' ? `<th${attrs}/>` : `<th${attrs}>${text}</th>`;
}

function tds(...texts: string[]): string {
  return texts.map((text) => td(text)).join('');
}

function table(...rows: string[]): string {
  return `<table>${rows.join('')}</table>`;
}

const ID = ' id="us2-r2c1"';
/** US2 table (1) as the writer gives it. */
const R1 = tr(tds('r1c1', 'r1c2', 'r1c3'));
const R2 = tr(td('r2c1', ID) + tds('r2c2', 'r2c3'), 'center');
const R3 = tr(tds('r3c1', 'r3c2', 'r3c3'));
const TABLE1 = table(R1, R2, R3);
/** An empty row with the reference row's alignment (FR-008). */
const EMPTY_R2 = tr(td() + td() + td(), 'center');
/** US2 table (2) and (3). */
const TABLE2 = table(tr(td('a', ' rowspan="2"') + td('b')), tr(td('c')));
const T3_R2 = tr(tds('r2c1', 'r2c2') + td('r2c3', ' align="right"'));
const T3_R3 = tr(tds('r3c1', 'r3c2') + td('r3c3', ' xml:lang="de"'));

/* ------------------------------------------------------------------------ */
/* The places                                                               */
/* ------------------------------------------------------------------------ */

/** Where a command runs: a caret at the end of a cell's text, a block of cells, a paragraph. */
type At = { caret: string } | { block: [string, string]; cells: number } | { paragraphEnd: true };

interface Place {
  /** The command: `table.<name>` or `insert.table`. */
  id: string;
  /** The paragraph before the place's table (for *Table…*, the paragraph itself) ... */
  label: string;
  /** ... and the next paragraph after that table, which ends the compared part of the XML. */
  next: string;
  at: At;
  /** The XML from `label` to `next`, flattened, before the command ... */
  before: string;
  /** ... and after it. */
  result: string;
}

const BEFORE1 = `<p>${T1}</p>${TABLE1}`;

/** A command at `r2c2` of US2 table (1). */
function inTable1(name: string, result: string): Place {
  return {
    id: `table.${name}`,
    label: T1,
    next: T2,
    at: { caret: 'r2c2' },
    before: BEFORE1,
    result,
  };
}

const PLACES: Place[] = [
  inTable1('insertRowAbove', `<p>${T1}</p>${table(R1, EMPTY_R2, R2, R3)}`),
  inTable1('insertRowBelow', `<p>${T1}</p>${table(R1, R2, EMPTY_R2, R3)}`),
  inTable1('deleteRow', `<p>${T1}</p>${table(R1, R3)}`),
  inTable1(
    'insertColumnLeft',
    `<p>${T1}</p>${table(
      tr(td('r1c1') + td() + tds('r1c2', 'r1c3')),
      tr(td('r2c1', ID) + td() + tds('r2c2', 'r2c3'), 'center'),
      tr(td('r3c1') + td() + tds('r3c2', 'r3c3')),
    )}`,
  ),
  inTable1(
    'insertColumnRight',
    `<p>${T1}</p>${table(
      tr(tds('r1c1', 'r1c2') + td() + td('r1c3')),
      tr(td('r2c1', ID) + td('r2c2') + td() + td('r2c3'), 'center'),
      tr(tds('r3c1', 'r3c2') + td() + td('r3c3')),
    )}`,
  ),
  inTable1(
    'deleteColumn',
    `<p>${T1}</p>${table(
      tr(tds('r1c1', 'r1c3')),
      tr(td('r2c1', ID) + td('r2c3'), 'center'),
      tr(tds('r3c1', 'r3c3')),
    )}`,
  ),
  {
    id: 'table.mergeCells',
    label: T1,
    next: T2,
    at: { block: ['r2c2', 'r3c3'], cells: 4 },
    before: BEFORE1,
    result: `<p>${T1}</p>${table(
      R1,
      tr(td('r2c1', ID) + td('r2c2 r2c3 r3c2 r3c3', ' colspan="2" rowspan="2"'), 'center'),
      tr(td('r3c1')),
    )}`,
  },
  {
    id: 'table.splitCell',
    label: T2,
    next: T3,
    at: { caret: 'a' },
    before: `<p>${T2}</p>${TABLE2}`,
    result: `<p>${T2}</p>${table(tr(tds('a', 'b')), tr(td() + td('c')))}`,
  },
  inTable1(
    'toggleHeaderCell',
    `<p>${T1}</p>${table(R1, tr(td('r2c1', ID) + th('r2c2') + td('r2c3'), 'center'), R3)}`,
  ),
  {
    id: 'table.makeHeaderCells',
    label: T1,
    next: T2,
    at: { block: ['r2c1', 'r3c2'], cells: 4 },
    before: BEFORE1,
    result: `<p>${T1}</p>${table(
      R1,
      tr(th('r2c1', ID) + th('r2c2') + td('r2c3'), 'center'),
      tr(th('r3c1') + th('r3c2') + td('r3c3')),
    )}`,
  },
  {
    id: 'table.makeNormalCells',
    label: T3,
    next: T4,
    // h2 spans columns 2 and 3: the block takes the whole width of rows 1 and 2.
    at: { block: ['h1', 'r2c2'], cells: 5 },
    before: `<p>${T3}</p>${table(tr(th('h1') + th('h2', ' colspan="2"')), T3_R2, T3_R3)}`,
    result: `<p>${T3}</p>${table(tr(td('h1') + td('h2', ' colspan="2"')), T3_R2, T3_R3)}`,
  },
  inTable1(
    'toggleHeaderRow',
    `<p>${T1}</p>${table(R1, tr(th('r2c1', ID) + th('r2c2') + th('r2c3'), 'center'), R3)}`,
  ),
  inTable1(
    'toggleHeaderColumn',
    `<p>${T1}</p>${table(
      tr(td('r1c1') + th('r1c2') + td('r1c3')),
      tr(td('r2c1', ID) + th('r2c2') + td('r2c3'), 'center'),
      tr(td('r3c1') + th('r3c2') + td('r3c3')),
    )}`,
  ),
  {
    id: 'table.repair',
    label: SHORT_ROW,
    next: AFTER_SHORT_ROW,
    at: { caret: 'e' },
    before: `<p>${SHORT_ROW}</p><table id="t2">${tr(tds('a', 'b', 'c'))}${tr(tds('d', 'e'))}${tr(tds('f', 'g', 'h'))}</table>`,
    result: `<p>${SHORT_ROW}</p><table id="t2">${tr(tds('a', 'b', 'c'))}${tr(tds('d', 'e') + td())}${tr(tds('f', 'g', 'h'))}</table>`,
  },
  // Select table changes the selection only: the XML stays as it was.
  inTable1('select', BEFORE1),
  inTable1('delete', `<p>${T1}</p>`),
  inTable1('moveRowUp', `<p>${T1}</p>${table(R2, R1, R3)}`),
  inTable1('moveRowDown', `<p>${T1}</p>${table(R1, R3, R2)}`),
  inTable1(
    'moveColumnLeft',
    `<p>${T1}</p>${table(
      tr(tds('r1c2', 'r1c1', 'r1c3')),
      tr(td('r2c2') + td('r2c1', ID) + td('r2c3'), 'center'),
      tr(tds('r3c2', 'r3c1', 'r3c3')),
    )}`,
  ),
  inTable1(
    'moveColumnRight',
    `<p>${T1}</p>${table(
      tr(tds('r1c1', 'r1c3', 'r1c2')),
      tr(td('r2c1', ID) + tds('r2c3', 'r2c2'), 'center'),
      tr(tds('r3c1', 'r3c3', 'r3c2')),
    )}`,
  ),
  inTable1(
    'duplicateRow',
    `<p>${T1}</p>${table(R1, R2, tr(tds('r2c1', 'r2c2', 'r2c3'), 'center'), R3)}`,
  ),
  inTable1(
    'duplicateColumn',
    `<p>${T1}</p>${table(
      tr(tds('r1c1', 'r1c2', 'r1c2', 'r1c3')),
      tr(td('r2c1', ID) + tds('r2c2', 'r2c2', 'r2c3'), 'center'),
      tr(tds('r3c1', 'r3c2', 'r3c2', 'r3c3')),
    )}`,
  ),
  inTable1('paragraphBefore', `<p>${T1}</p><p/>${TABLE1}`),
  inTable1('paragraphAfter', `<p>${T1}</p>${TABLE1}<p/>`),
  {
    id: 'insert.table',
    label: T2,
    next: T3,
    at: { paragraphEnd: true },
    before: `<p>${T2}</p>${TABLE2}`,
    result: `<p>${T2}</p>${table(tr(td() + td()), tr(td() + td()))}${TABLE2}`,
  },
];

function place(id: string): Place {
  const found = PLACES.find((one) => one.id === id);
  if (!found) throw new Error(`no place for ${id}`);
  return found;
}

/* ------------------------------------------------------------------------ */
/* Model helpers                                                            */
/* ------------------------------------------------------------------------ */

function documentOf(page: Page): Promise<DocJson> {
  return page.evaluate(() => window.__mfbeTest!.scripts!.document());
}

/** The live document as FB2 text, binaries elided. */
function toXml(page: Page): Promise<string> {
  return page.evaluate(() => window.__mfbeTest!.scripts!.toXml());
}

function textOf(node: Json): string {
  return (node.content ?? [])
    .map((child) => (child.type === 'text' ? (child.text ?? '') : textOf(child)))
    .join('');
}

/** The trees of the document: the bodies, then the book's annotation. */
function rootsOf(doc: DocJson): Json[] {
  const annotation = doc.description.titleInfo.annotation;
  return [...doc.bodies, ...(annotation ? [annotation] : [])];
}

/** The node that passes `test`, with its parent and its index there. */
function placeOf(
  doc: DocJson,
  test: (node: Json) => boolean,
): { node: Json; parent: Json; index: number } | null {
  const search = (parent: Json): { node: Json; parent: Json; index: number } | null => {
    const children = parent.content ?? [];
    for (let index = 0; index < children.length; index += 1) {
      const node = children[index]!;
      if (test(node)) return { node, parent, index };
      const found = search(node);
      if (found) return found;
    }
    return null;
  };
  for (const root of rootsOf(doc)) {
    const found = search(root);
    if (found) return found;
  }
  return null;
}

/** The paragraph whose text is `text`. */
function paragraphOf(doc: DocJson, text: string): Json {
  const found = placeOf(doc, (node) => node.type === 'p' && textOf(node) === text);
  if (!found) throw new Error(`no paragraph "${text}"`);
  return found.node;
}

/** The table right after the paragraph `label`. */
function tableAfter(doc: DocJson, label: string): Json {
  const found = placeOf(doc, (node) => node.type === 'p' && textOf(node) === label);
  const next = found?.parent.content?.[found.index + 1];
  if (!next || next.type !== 'table') throw new Error(`no table after "${label}"`);
  return next;
}

/** The table with the node id `nodeId`. */
function tableById(doc: DocJson, nodeId: string): Json | null {
  return (
    placeOf(doc, (node) => node.type === 'table' && node.attrs?.nodeId === nodeId)?.node ?? null
  );
}

/** The cells of a table in reading order. */
function cellsOf(model: Json): Json[] {
  return (model.content ?? [])
    .filter((row) => row.type === 'tr')
    .flatMap((row) =>
      (row.content ?? []).filter((cell) => cell.type === 'td' || cell.type === 'th'),
    );
}

function cellOf(model: Json, text: string): Json {
  const found = cellsOf(model).find((cell) => textOf(cell) === text);
  if (!found) throw new Error(`no cell "${text}"`);
  return found;
}

function idOf(node: Json): string {
  const id = node.attrs?.nodeId;
  if (typeof id !== 'string') throw new Error(`a ${node.type} without a node id`);
  return id;
}

/** The line `tables.read` reports for a table: its rows, then each row's cells and spans. */
function readLine(model: Json): string {
  const describe = (cell: Json) => {
    let text = cell.type;
    for (const span of ['colspan', 'rowspan']) {
      const value = cell.attrs?.[span];
      if (typeof value === 'number' && value > 1) text += ` ${span}=${value}`;
    }
    return text;
  };
  const rows = (model.content ?? []).filter((row) => row.type === 'tr');
  const parts = rows.map((row) =>
    (row.content ?? [])
      .filter((cell) => cell.type === 'td' || cell.type === 'th')
      .map(describe)
      .join(' '),
  );
  return `${rows.length} rows: ${parts.join(' | ')}`;
}

/* ------------------------------------------------------------------------ */
/* Page helpers                                                             */
/* ------------------------------------------------------------------------ */

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/** Two animation frames: the page has painted what the last step changed. */
async function painted(page: Page): Promise<void> {
  await page.evaluate(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
}

/** Escape until no menu, submenu or context menu is open. */
async function closeMenus(page: Page): Promise<void> {
  const open = page.locator('.mfbe-menu-popup, [data-testid="context-menu"]');
  await expect(async () => {
    if ((await open.count()) > 0) await page.keyboard.press('Escape');
    expect(await open.count()).toBe(0);
  }).toPass({ timeout: 5_000 });
}

/** `tables.fb2` through File → Open and the queued native dialog; the hooks ready. */
async function openTables(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [TABLES] });
  await menu(page, 'file', 'open');
  await waitForBook(page, TABLES);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof window.__mfbeTest?.scripts?.document === 'function' &&
          typeof window.__mfbeTest?.tables?.target === 'function',
      ),
    )
    .toBe(true);
}

/** The scripts `ids` are listed (the catalogue follows the copied folders). */
async function scriptsListed(page: Page, ids: string[]): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((wanted) => {
          const listed = new Set((window.__mfbeTest?.scripts?.list() ?? []).map((one) => one.id));
          return wanted.every((id) => listed.has(id));
        }, ids),
      { timeout: 15_000 },
    )
    .toBe(true);
}

/** The caret at `offset` of the text block with the node id `nodeId` of the Body view. */
async function caretIn(page: Page, nodeId: string, offset: number): Promise<void> {
  const placed = await page.evaluate(([id, at]) => window.__mfbeTest!.scripts!.select(id, at, at), [
    nodeId,
    offset,
  ] as const);
  expect(placed, `the caret in ${nodeId}`).toBe(true);
}

/** The Body view's element of the table with the node id `nodeId`. */
function tableElement(page: Page, nodeId: string): Locator {
  return page
    .getByTestId('body-editor')
    .locator(`[data-testid="body-table"][data-node-id="${nodeId}"]`);
}

/** The Body view's element of the cell with the node id `nodeId`. */
function cellElement(page: Page, nodeId: string): Locator {
  return page.getByTestId('body-editor').locator(`:is(td, th)[data-node-id="${nodeId}"]`);
}

/**
 * Right-clicks `target` (at `position` in it) once it is in view and the scroll that brought it
 * there has reached the page: the context menu closes on any scroll (`PopupMenu`, U13).
 */
async function rightClick(
  page: Page,
  target: Locator,
  position?: { x: number; y: number },
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await painted(page);
  await target.click({ button: 'right', position });
}

/** The point just right of the end of the paragraph's text, relative to the paragraph. */
async function afterTextOf(page: Page, nodeId: string): Promise<{ x: number; y: number }> {
  await page
    .getByTestId('body-editor')
    .locator(`p[data-node-id="${nodeId}"]`)
    .scrollIntoViewIfNeeded();
  await painted(page);
  const point = await page.evaluate<{ x: number; y: number } | null>(`(() => {
    const p = document.querySelector('[data-testid="body-editor"] p[data-node-id="${nodeId}"]');
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let last = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data.length) last = node;
    if (!last) return null;
    const range = document.createRange();
    range.setStart(last, last.data.length - 1);
    range.setEnd(last, last.data.length);
    const rect = range.getBoundingClientRect();
    const box = p.getBoundingClientRect();
    return { x: rect.right + 2 - box.left, y: rect.top + rect.height / 2 - box.top };
  })()`);
  if (!point) throw new Error(`no text in the paragraph ${nodeId}`);
  return point;
}

/** The XML once a step changed it from `before`. */
async function changed(page: Page, before: string): Promise<string> {
  await expect
    .poll(() => toXml(page), { message: 'the command changed the book' })
    .not.toBe(before);
  return toXml(page);
}

/** One Edit → Undo gives back `before` byte for byte, one Edit → Redo `after` (SC-007, U22). */
async function undoRedo(page: Page, before: string, after: string): Promise<void> {
  await menu(page, 'edit', 'undo');
  await expect.poll(() => toXml(page), { message: 'one Undo restores the XML' }).toBe(before);
  await menu(page, 'edit', 'redo');
  await expect.poll(() => toXml(page), { message: 'one Redo applies it again' }).toBe(after);
}

/** One more Edit → Undo, back to `xml`. */
async function undoTo(page: Page, xml: string): Promise<void> {
  await menu(page, 'edit', 'undo');
  await expect.poll(() => toXml(page), { message: 'Undo restores the XML' }).toBe(xml);
}

/* ------------------------------------------------------------------------ */
/* A place in the page                                                      */
/* ------------------------------------------------------------------------ */

/** A place read from the model as the book is now: its table, cells and paragraph. */
interface Located {
  place: Place;
  /** The place's table (none for *Table…*). */
  table: Json | null;
  /** The element a right-click opens the place's context menu on, and where. */
  target: Locator;
  position?: { x: number; y: number };
  /** Sets the place's selection. */
  select(): Promise<void>;
}

async function locate(page: Page, place: Place): Promise<Located> {
  const doc = await documentOf(page);
  const { at } = place;
  if ('paragraphEnd' in at) {
    const paragraph = paragraphOf(doc, place.label);
    const id = idOf(paragraph);
    return {
      place,
      table: null,
      target: page.getByTestId('body-editor').locator(`p[data-node-id="${id}"]`),
      position: await afterTextOf(page, id),
      select: () => caretIn(page, id, textOf(paragraph).length),
    };
  }
  const model = tableAfter(doc, place.label);
  if ('caret' in at) {
    const cell = cellOf(model, at.caret);
    return {
      place,
      table: model,
      target: cellElement(page, idOf(cell)),
      select: () => caretIn(page, idOf(cell), at.caret.length),
    };
  }
  const [from, to] = at.block.map((text) => idOf(cellOf(model, text)));
  return {
    place,
    table: model,
    target: cellElement(page, from!),
    select: async () => {
      const made = await page.evaluate(
        ([anchor, head]) =>
          window.__mfbeTest!.scripts!.selectRange(
            { nodeId: anchor, offset: 0 },
            { nodeId: head, offset: 0 },
          ),
        [from!, to!] as const,
      );
      expect(made, `the block ${at.block.join('-')}`).toBe(true);
      await expect(tableElement(page, idOf(model)).locator('.mfbe-cell-selected')).toHaveCount(
        at.cells,
      );
    },
  };
}

/** The state of a menu entry or a toolbar button. */
interface EntryState {
  id: string;
  disabled: boolean;
  title: string | null;
  description: string | null;
}

/** The entries (role `menuitem`) of the open popup `testId`, in order. */
function popupEntries(page: Page, testId: string): Promise<EntryState[]> {
  return page.evaluate<
    EntryState[]
  >(`[...document.querySelector('[data-testid="${testId}"]').children]
    .filter((child) => child.getAttribute('role') === 'menuitem')
    .map((child) => ({
      id: child.getAttribute('data-testid'),
      disabled: child.getAttribute('aria-disabled') === 'true',
      title: child.getAttribute('title'),
      description: child.getAttribute('aria-description'),
    }))`);
}

/** The state of the element `testId`: a menu entry (`aria-disabled`) or a button. */
function stateOf(page: Page, testId: string): Promise<EntryState> {
  return page.evaluate<EntryState>(`(() => {
    const element = document.querySelector('[data-testid="${testId}"]');
    return {
      id: element.getAttribute('data-testid'),
      disabled: element.tagName === 'BUTTON' ? element.disabled : element.getAttribute('aria-disabled') === 'true',
      title: element.getAttribute('title'),
      description: element.getAttribute('aria-description'),
    };
  })()`);
}

/** *Add → Table* and the 24 entries of *Add → Table structure*; the menus closed again. */
async function menuStates(page: Page): Promise<{ insert: EntryState; entries: EntryState[] }> {
  await page.getByTestId('menu-add').click();
  await expect(page.getByTestId('menu-add-table')).toBeVisible();
  const insert = await stateOf(page, 'menu-add-table');
  await page.getByTestId('menu-add-tableStructure').click();
  await expect(page.getByTestId('menu-add-tableStructure-popup')).toBeVisible();
  const entries = await popupEntries(page, 'menu-add-tableStructure-popup');
  await closeMenus(page);
  return { insert, entries };
}

/**
 * The context menu opened on the place: the test ids of its table section - the items after
 * its last separator - and the states of *Table…* and, for a click in a table, of the 24
 * entries of its *Table structure* submenu; the menu closed again.
 */
async function contextStates(
  page: Page,
  located: Located,
): Promise<{ section: string[]; insert: EntryState; entries: EntryState[] | null }> {
  await rightClick(page, located.target, located.position);
  await expect(page.getByTestId('context-menu')).toBeVisible();
  const top = await page.evaluate<
    string[]
  >(`[...document.querySelector('[data-testid="context-menu"]').children]
    .map((child) => child.getAttribute('role') === 'separator' ? '|' : (child.getAttribute('data-testid') ?? '?'))`);
  const section = top.slice(top.lastIndexOf('|') + 1);
  const insert = await stateOf(page, 'context-menu-insert.table');
  let entries: EntryState[] | null = null;
  if (section.includes('context-menu-tableStructure')) {
    await page.getByTestId('context-menu-tableStructure').click();
    await expect(page.getByTestId('context-menu-tableStructure-popup')).toBeVisible();
    entries = await popupEntries(page, 'context-menu-tableStructure-popup');
  }
  await closeMenus(page);
  return { section, insert, entries };
}

/** The states of the 25 offered buttons on the toolbar, by command id. */
async function buttonStates(page: Page): Promise<Map<string, EntryState>> {
  const states = await Promise.all(OFFERED.map((id) => stateOf(page, `toolbar-${id}`)));
  return new Map(OFFERED.map((id, index) => [id, states[index]!]));
}

/** Every reason a command may give, in the interface language (data-model §9.6). */
function reasonTexts(lang: UiLang): Set<string> {
  const reasons = new Set<string>();
  for (const [key, value] of catalogueEntries(lang)) {
    if (/\{\{/.test(value)) continue;
    if (key.startsWith('tables.reason.') || key.startsWith('commands.unavailable.runLock.')) {
      reasons.add(plainText(value));
    }
  }
  return reasons;
}

/** The reason in "<command>: <reason>" for the command's tooltip `tooltipKey`, else null. */
function reasonIn(lang: UiLang, tooltipKey: string, title: string | null): string | null {
  const marker = '\u0001';
  const [prefix, suffix] = uiText(lang, 'commands.unavailable.title', {
    command: uiText(lang, tooltipKey),
    reason: marker,
  }).split(marker) as [string, string];
  if (title === null || !title.startsWith(prefix) || !title.endsWith(suffix)) return null;
  return title.slice(prefix.length, title.length - suffix.length);
}

/**
 * The surfaces agree at the place (SC-008; FR-040, FR-041, FR-043; decision 2; U40): the Add
 * menu's *Table structure* and the context menu's (whose table section holds *Table…* and, in
 * a table, the submenu - nothing else) list FR-039's 24 commands; a command's entry in both
 * menus and its toolbar button are available alike, and an unavailable one carries the same
 * "<command>: <reason>" - a reason of the catalogue - as `title` and `aria-description` (the
 * button's description ends with it); *Table…* likewise. The place's own command is available.
 */
async function expectSurfaces(page: Page, located: Located, lang: UiLang): Promise<void> {
  const reasons = reasonTexts(lang);
  const fromMenu = await menuStates(page);
  await located.select();
  const fromContext = await contextStates(page, located);
  await located.select();
  const buttons = await buttonStates(page);
  const inTable = located.table !== null;
  expect(fromContext.section).toEqual(
    inTable
      ? ['context-menu-insert.table', 'context-menu-tableStructure']
      : ['context-menu-insert.table'],
  );
  expect(fromMenu.entries.map((entry) => entry.id)).toEqual(
    FR039.map((name) => `menu-add-tableStructure-${name}`),
  );
  if (fromContext.entries) {
    expect(fromContext.entries.map((entry) => entry.id)).toEqual(
      FR039.map((name) => `context-menu-tableStructure-${name}`),
    );
  }
  const compare = (
    what: string,
    tooltipKey: string,
    entry: EntryState,
    others: (EntryState | undefined)[],
    button: EntryState,
  ) => {
    expect(button.disabled, `${what}: the button`).toBe(entry.disabled);
    for (const other of others) {
      if (!other) continue;
      expect(other.disabled, `${what}: ${other.id}`).toBe(entry.disabled);
      expect(other.title, `${what}: ${other.id}`).toBe(entry.title);
      expect(other.description, `${what}: ${other.id}`).toBe(entry.description);
    }
    if (!entry.disabled) {
      expect(entry.title, `${what}: an available entry has no reason`).toBeNull();
      return;
    }
    const reason = reasonIn(lang, tooltipKey, entry.title);
    expect(
      reason !== null && reasons.has(reason),
      `${what}: "${entry.title}" is "<command>: <reason>"`,
    ).toBe(true);
    expect(entry.description, what).toBe(entry.title);
    expect(button.title, `${what}: the button`).toBe(entry.title);
    expect(button.description?.endsWith(entry.title!), `${what}: the button`).toBe(true);
  };
  FR039.forEach((name, index) =>
    compare(
      name,
      `tables.cmd.${name}.tooltip`,
      fromMenu.entries[index]!,
      [fromContext.entries?.[index]],
      buttons.get(`table.${name}`)!,
    ),
  );
  compare(
    'insert.table',
    'cmd.insert.table.tooltip',
    fromMenu.insert,
    [fromContext.insert],
    buttons.get('insert.table')!,
  );
  const own =
    located.place.id === 'insert.table'
      ? fromMenu.insert
      : fromMenu.entries[FR039.indexOf(located.place.id.slice('table.'.length))]!;
  expect(own.disabled, `${located.place.id} is available at its place`).toBe(false);
}

/** The Table dialog confirmed with the values it proposes (*Table…*). */
async function confirmTableDialog(page: Page): Promise<void> {
  const dialog = page.getByTestId('dialog-table');
  await expect(dialog).toBeVisible();
  await page.getByTestId('dialog-table-button-ok').click();
  await expect(dialog).toBeHidden();
}

/** The place's command from *Add → Table structure* (*Add → Table* for *Table…*). */
async function runFromMenu(page: Page, located: Located): Promise<void> {
  const { id } = located.place;
  await page.getByTestId('menu-add').click();
  if (id === 'insert.table') {
    const entry = page.getByTestId('menu-add-table');
    await expect(entry).not.toHaveAttribute('aria-disabled');
    await entry.click();
    await confirmTableDialog(page);
    return;
  }
  await page.getByTestId('menu-add-tableStructure').click();
  const entry = page.getByTestId(`menu-add-tableStructure-${id.slice('table.'.length)}`);
  await expect(entry).not.toHaveAttribute('aria-disabled');
  await entry.click();
}

/** The place's command from the context menu opened on the place (C28: a block is kept). */
async function runFromContextMenu(page: Page, located: Located): Promise<void> {
  const { id } = located.place;
  await rightClick(page, located.target, located.position);
  await expect(page.getByTestId('context-menu')).toBeVisible();
  if (id === 'insert.table') {
    const entry = page.getByTestId('context-menu-insert.table');
    await expect(entry).not.toHaveAttribute('aria-disabled');
    await entry.click();
    await confirmTableDialog(page);
    return;
  }
  await page.getByTestId('context-menu-tableStructure').click();
  await expect(page.getByTestId('context-menu-tableStructure-popup')).toBeVisible();
  const entry = page.getByTestId(`context-menu-tableStructure-${id.slice('table.'.length)}`);
  await expect(entry).not.toHaveAttribute('aria-disabled');
  await entry.click();
  await expect(page.getByTestId('context-menu')).toHaveCount(0);
}

/** The place's command from its toolbar button. */
async function runFromToolbar(page: Page, located: Located): Promise<void> {
  const button = page.getByTestId(`toolbar-${located.place.id}`);
  await expect(button).toBeEnabled();
  await button.click();
  if (located.place.id === 'insert.table') await confirmTableDialog(page);
}

/* ------------------------------------------------------------------------ */
/* The assistant and the toolbar                                            */
/* ------------------------------------------------------------------------ */

/** The assistant's custom target is the stand-in (before the page loads; quickstart §11). */
async function assistantOn(core: CoreHandle, standin: StandinHandle): Promise<void> {
  await standin.reset();
  await core.resetAiRequests();
  await core.setAiResolve([]);
  await core.rpc('settings.set', {
    patch: {
      ai: {
        mode: 'custom',
        custom: { address: `${standin.url}/v1`, key: '', model: 'standin-chat' },
      },
    },
  });
}

const lastRequestId = async (page: Page) =>
  (await page.evaluate(() => window.__mfbeTest?.ai?.lastRequest() ?? null))?.id ?? null;

/** Types the instruction into the panel's field, sends it and waits for the request's end. */
async function sendAndWait(page: Page, instruction: string): Promise<void> {
  const before = await lastRequestId(page);
  await page.getByTestId('ai-input').fill(instruction);
  await page.getByTestId('ai-input').press('Enter');
  await expect.poll(() => lastRequestId(page), { timeout: 30_000 }).not.toBe(before);
  await expect(page.getByTestId('ai-send')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('script-run-banner')).toHaveCount(0, { timeout: 30_000 });
}

/** *Customize toolbar* of the Commands toolbar, from its right-click menu. */
async function openCustomize(page: Page): Promise<void> {
  await page.getByTestId('toolbar-commands').locator('[data-toolbar-index]').first().click({
    button: 'right',
  });
  await page.getByTestId('toolbar-menu-customize').click();
  await expect(page.getByTestId('dialog-customize-toolbar')).toBeVisible();
}

async function closeCustomize(page: Page): Promise<void> {
  await page.getByTestId('dialog-customize-toolbar-button-close').click();
  await expect(page.getByTestId('dialog-customize-toolbar')).toHaveCount(0);
}

function listItems(page: Page, list: 'available' | 'current'): Promise<(string | null)[]> {
  return page
    .getByTestId(`customize-toolbar-${list}`)
    .locator('option')
    .evaluateAll((options) => options.map((option) => option.getAttribute('data-item')));
}

/**
 * The 25 offered buttons added through *Customize toolbar* (FR-041; C27): the available list
 * ends with them; with the end entry of the toolbar's list selected, Add puts each after the
 * last, in FR-039's order; each shows its 24 px icon (resource-formats.md Tests §19).
 */
async function addTableButtons(page: Page): Promise<void> {
  await openCustomize(page);
  const available = await listItems(page, 'available');
  expect(available.slice(-OFFERED.length)).toEqual(OFFERED);
  const current = await listItems(page, 'current');
  await page.getByTestId('customize-toolbar-current').selectOption({ index: current.length - 1 });
  await page
    .getByTestId('customize-toolbar-available')
    .selectOption({ index: available.length - OFFERED.length });
  for (let added = 0; added < OFFERED.length; added += 1) {
    await page.getByTestId('dialog-customize-toolbar-button-add').click();
  }
  expect(await listItems(page, 'current')).toEqual([...current.slice(0, -1), ...OFFERED, 'end']);
  await closeCustomize(page);
  for (const id of OFFERED) {
    const image = page.getByTestId(`toolbar-${id}`).locator('img');
    await expect
      .poll(
        () =>
          image.evaluate((element) => {
            const img = element as unknown as { complete: boolean; naturalWidth: number };
            return img.complete ? img.naturalWidth : 0;
          }),
        { message: `the icon of ${id}` },
      )
      .toBe(24);
  }
}

/** *Reset* of *Customize toolbar*: the original layout, without the table buttons. */
async function resetToolbar(page: Page): Promise<void> {
  await openCustomize(page);
  await page.getByTestId('dialog-customize-toolbar-button-reset').click();
  await closeCustomize(page);
  await expect(page.locator('[data-testid^="toolbar-table."]')).toHaveCount(0);
  await expect(page.getByTestId('toolbar-insert.table')).toHaveCount(0);
}

/* ------------------------------------------------------------------------ */
/* The book annotation's field (test 2 and test 4)                          */
/* ------------------------------------------------------------------------ */

const ANNOTATION = 'description-annotation';

/** The `<annotation>` of `<title-info>` in the document's FB2 text. */
function annotationXml(xml: string): string {
  const parent = xml.indexOf('<title-info>');
  const from = xml.indexOf('<annotation', parent);
  const to = xml.indexOf('</annotation>', from);
  expect(from, '<annotation> in <title-info>').toBeGreaterThan(parent);
  return xml.slice(from, to + '</annotation>'.length);
}

/** View → Description; the book annotation's field ready. */
async function showDescription(page: Page): Promise<void> {
  await page.getByTestId('view-description').click();
  await expect(page.getByTestId('description-view')).toBeVisible();
  await expect(page.getByTestId(ANNOTATION)).toHaveAttribute('contenteditable', 'true');
}

/** The regular 2 × 3 table of the book annotation's field (T012). */
async function annotationTable(page: Page): Promise<Json> {
  const annotation = (await documentOf(page)).description.titleInfo.annotation!;
  return (annotation.content ?? []).find((child) => child.type === 'table')!;
}

/** A click at the end of a cell's text in the field: the caret there, the field the target. */
async function clickFieldCell(page: Page, nodeId: string): Promise<void> {
  const element = page.getByTestId(ANNOTATION).locator(`:is(td, th)[data-node-id="${nodeId}"]`);
  await element.scrollIntoViewIfNeeded();
  const box = (await element.boundingBox())!;
  await element.click({ position: { x: box.width - 3, y: box.height / 2 } });
  await page.keyboard.press(LINE_END);
  await expect
    .poll(async () => {
      const target = await page.evaluate(() => window.__mfbeTest!.tables!.target());
      return target?.kind === 'description' && target.key === 'titleInfo.annotation'
        ? target.selection.head
        : null;
    })
    .toBe(nodeId);
}

/** The commands of `table.*` in `hotkeys.json` of the data folder. */
function tableChords(dataDir: string): string[] {
  const file = path.join(dataDir, 'hotkeys.json');
  if (!existsSync(file)) return [];
  const found: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith('table.')) found.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(JSON.parse(readFileSync(file, 'utf8')));
  return found;
}

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

interface SettingsSnapshot {
  ai: unknown;
  view: { fastMode: boolean };
  other: { restorePosition: boolean };
  session: {
    toolbarLayouts?: Record<string, unknown>;
    aiPanelVisible: boolean;
    tableDialog?: unknown;
  };
}

test.describe('Feature 006 - every table command from every surface', () => {
  let saved: SettingsSnapshot | null = null;

  test.beforeAll(({ coreServer }) => {
    if (!coreServer.hasCore || !coreServer.dataDir) return;
    for (const group of ['07_Tables', '06_Runs']) {
      const target = path.join(coreServer.dataDir, 'scripts', group);
      if (!existsSync(target))
        cpSync(path.join(SCRIPT_FIXTURES, group), target, { recursive: true });
    }
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    saved = await core.rpc<SettingsSnapshot>('settings.get');
    // Before the page loads: the original toolbar, the Table dialog's defaults (2 × 2), the AI
    // panel hidden (the assistant's tests show it), Restore position off.
    await core.rpc('settings.set', {
      patch: {
        session: { toolbarLayouts: null, tableDialog: null, aiPanelVisible: false },
        other: { restorePosition: false },
      },
    });
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore || !saved) return;
    const { ai, view, other, session } = saved;
    await core
      .rpc('settings.set', {
        patch: {
          ai,
          view: { fastMode: view.fastMode },
          other: { restorePosition: other.restorePosition },
          session: {
            toolbarLayouts: null,
            aiPanelVisible: session.aiPanelVisible,
            tableDialog: session.tableDialog ?? null,
          },
        },
      })
      .catch(() => {});
    if (session.toolbarLayouts && Object.keys(session.toolbarLayouts).length > 0) {
      await core
        .rpc('settings.set', { patch: { session: { toolbarLayouts: session.toolbarLayouts } } })
        .catch(() => {});
    }
    saved = null;
  });

  test('1. every table command from Add → Table structure, the context menu and its toolbar button; the surfaces agree and say why a command is unavailable; scripts and the assistant see each result as a table', async ({
    core,
    page,
    standin,
    context,
  }) => {
    // 25 places, each on three surfaces with a script run and a request to the assistant: 38 s
    // on the development host; CI's runners are two to three times slower.
    test.setTimeout(300_000);
    const outside = await recordOutside(context);
    await assistantOn(core, standin);
    await openTables(core, page);
    await ensureAssistantOn(page);
    await scriptsListed(page, ['tables.read']);
    const lang = await pageLang(page);
    await addTableButtons(page);

    // The container commands stay unavailable with the caret in a cell (the spec's edge case).
    const t1 = tableAfter(await documentOf(page), T1);
    await caretIn(page, idOf(cellOf(t1, 'r2c2')), 2);
    await page.getByTestId('menu-edit').click();
    for (const id of ['clone', 'split', 'merge', 'removeOuter']) {
      await expect(page.getByTestId(`menu-edit-${id}`), id).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    }
    await closeMenus(page);

    // A table of one row: Delete row says why (US2 sc.7; FR-043).
    const oneRow = tableAfter(await documentOf(page), T6_ROW);
    await caretIn(page, idOf(cellOf(oneRow, 'r1c2')), 2);
    const onlyRow = uiText(lang, 'commands.unavailable.title', {
      command: uiText(lang, 'tables.cmd.deleteRow.tooltip'),
      reason: uiText(lang, 'tables.reason.only-row'),
    });
    if (lang === 'en')
      expect(onlyRow).toBe('Delete row: the table has only one row; use Delete table');
    const deleteRow = (await menuStates(page)).entries[FR039.indexOf('deleteRow')]!;
    expect(deleteRow).toEqual({
      id: 'menu-add-tableStructure-deleteRow',
      disabled: true,
      title: onlyRow,
      description: onlyRow,
    });
    expect((await buttonStates(page)).get('table.deleteRow')).toMatchObject({
      disabled: true,
      title: onlyRow,
    });

    for (const one of PLACES) {
      await test.step(one.id, async () => {
        const located = await locate(page, one);
        await located.select();
        const before = await toXml(page);
        expect(segment(before, one.label, one.next), 'the place as the fixture has it').toBe(
          one.before,
        );
        await expectSurfaces(page, located, lang);

        // From the menu: the result, then FR-049, then one Undo, one Redo and one more Undo.
        await located.select();
        await runFromMenu(page, located);
        const selectsOnly = one.id === 'table.select';
        const after = selectsOnly ? before : await changed(page, before);
        expect(segment(after, one.label, one.next)).toBe(one.result);
        // Nothing but the compared part changed.
        expect(flat(after).replace(one.result, '')).toBe(flat(before).replace(one.before, ''));
        const tableRef =
          one.id === 'insert.table'
            ? idOf(tableAfter(await documentOf(page), one.label))
            : located.table && idOf(located.table);
        if (selectsOnly) {
          // Select table: the table selected, no undo step (data-model §4.5 `table.select`).
          await expect(tableElement(page, tableRef!)).toHaveClass(/\bfb-selected\b/);
          await expect(page.getByTestId('toolbar-edit.undo')).toBeDisabled();
          expect(await toXml(page)).toBe(before);
        }
        const model =
          one.id === 'table.delete' ? null : tableById(await documentOf(page), tableRef!);
        if (model) {
          // FR-049: the model holds the table as table > tr > td | th and nothing else ...
          expect(
            (model.content ?? []).map((row) => row.type).filter((type) => type !== 'tr'),
          ).toEqual([]);
          for (const row of model.content ?? []) {
            expect(
              (row.content ?? [])
                .map((cell) => cell.type)
                .filter((type) => type !== 'td' && type !== 'th'),
            ).toEqual([]);
          }
          // ... a script reads it with the caret in it (a run that changes nothing records no
          // undo step) ...
          const cells = cellsOf(model);
          await caretIn(page, idOf(cells[0]!), 0);
          await page.evaluate(() => window.__mfbeTest!.scripts!.run('tables.read'));
          await expect(page.getByTestId('status-message')).toHaveText(readLine(model));
          // ... and the assistant's read_part lists one block per cell (ai-catalogue.md, "The
          // other tools are unchanged").
          await standin.reset();
          await standin.scenarios([
            {
              toolCalls: [
                { id: 'read-1', name: 'read_part', arguments: { node: tableRef!, format: 'text' } },
              ],
            },
            { text: 'Read.' },
          ]);
          await sendAndWait(page, 'Read the table');
          const requests = await standin.requests();
          const body = requests.at(-1)!.body as unknown as {
            messages: { role: string; content: string | null }[];
          };
          const tools = body.messages.filter((message) => message.role === 'tool');
          expect(tools).toHaveLength(1);
          const part = JSON.parse(tools[0]!.content ?? 'null') as {
            blocks: { id: string; type: string }[];
          };
          expect(part.blocks.map((block) => `${block.type} ${block.id}`)).toEqual(
            cells.map((cell) => `${cell.type} ${idOf(cell)}`),
          );
          expect(await toXml(page), 'reading changed nothing').toBe(after);
        }
        if (!selectsOnly) {
          await undoRedo(page, before, after);
          await undoTo(page, before);
        }

        // From the context menu and from the button: the same XML, then Undo.
        for (const run of [runFromContextMenu, runFromToolbar]) {
          await located.select();
          await run(page, located);
          if (selectsOnly) {
            await expect(tableElement(page, tableRef!)).toHaveClass(/\bfb-selected\b/);
            expect(await toXml(page)).toBe(before);
            await expect(page.getByTestId('toolbar-edit.undo')).toBeDisabled();
          } else {
            await expect
              .poll(() => toXml(page), { message: `${run.name}: the same result` })
              .toBe(after);
            await undoTo(page, before);
          }
        }
      });
    }

    await resetToolbar(page);
    expect(outside).toEqual([]);
  });

  test('2. a chord the user assigns to Insert row below acts in a Body cell and in a description field’s cell, and nowhere else; Default removes it again', async ({
    core,
    page,
    standin,
    context,
  }) => {
    const outside = await recordOutside(context);
    // hotkeys.json lives in the worker's shared core: given back in `finally`.
    const bindings = await core.rpc<unknown[]>('hotkeys.get');
    try {
      await assistantOn(core, standin);
      await openTables(core, page);
      await ensureAssistantOn(page);
      const status = page.getByTestId('status-path');
      const row = (name: string) => page.getByTestId(`settings-hotkeys-command-table.${name}`);
      const openHotkeys = async () => {
        await menu(page, 'tools', 'settings');
        await expect(page.getByTestId('dialog-settings')).toBeVisible();
        await page.getByTestId('settings-tab-hotkeys').click();
        await expect(page.getByTestId('settings-page-hotkeys')).toBeVisible();
        await page.getByTestId('settings-hotkeys-group-table').click();
      };
      const settingsOk = async () => {
        await page.getByTestId('dialog-settings-button-ok').click();
        await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
      };

      // Settings → Hotkeys: the Table group lists the 24 commands, none with a shortcut.
      await openHotkeys();
      const rows = page.getByTestId('settings-hotkeys-commands').locator('[role="option"]');
      const listed = await rows.evaluateAll((items) =>
        items.map((item) => item.getAttribute('data-testid')),
      );
      expect([...listed].sort()).toEqual(
        FR039.map((name) => `settings-hotkeys-command-table.${name}`).sort(),
      );
      expect(await rows.locator('.mfbe-hotkeys-chord').allTextContents()).toEqual(
        FR039.map(() => ''),
      );
      // The chord captured and assigned to Insert row below.
      await row('insertRowBelow').click();
      await page.getByTestId('settings-hotkeys-capture').focus();
      await page.keyboard.press(CHORD);
      await expect(page.getByTestId('settings-hotkeys-assign')).toBeEnabled();
      await page.getByTestId('settings-hotkeys-assign').click();
      await expect(row('insertRowBelow').locator('.mfbe-hotkeys-chord')).not.toHaveText('');
      await settingsOk();
      await expect.poll(() => tableChords(core.dataDir!)).toEqual(['table.insertRowBelow']);

      // At r2c2 of table (1): a row below it, one Undo and one Redo.
      const t1 = tableAfter(await documentOf(page), T1);
      const r2c2 = cellElement(page, idOf(cellOf(t1, 'r2c2')));
      await r2c2.click();
      await expect(status).toHaveText(/\/tr\[2\]\/td\[2\]$/);
      const before = await toXml(page);
      await page.keyboard.press(CHORD);
      const after = await changed(page, before);
      expect(segment(after, T1, T2)).toBe(place('table.insertRowBelow').result);
      await undoRedo(page, before, after);

      // In the regular table of the book annotation's field: a row too, one Undo and one Redo
      // through the Description view's undo (SC-007's field half).
      await showDescription(page);
      const regular = await annotationTable(page);
      await clickFieldCell(page, idOf(cellOf(regular, 'r1c3')));
      const fieldBefore = annotationXml(await toXml(page));
      await page.keyboard.press(CHORD);
      await expect
        .poll(async () => annotationXml(await toXml(page)), { message: 'a row in the field' })
        .not.toBe(fieldBefore);
      const fieldAfter = annotationXml(await toXml(page));
      expect(
        await page.evaluate((ref) => window.__mfbeTest!.tables!.grid(ref), idOf(regular)),
      ).toMatchObject({ rows: 3, columns: 3 });
      await menu(page, 'edit', 'undo');
      await expect
        .poll(async () => annotationXml(await toXml(page)), { message: 'Undo restores the field' })
        .toBe(fieldBefore);
      await menu(page, 'edit', 'redo');
      await expect
        .poll(async () => annotationXml(await toXml(page)), { message: 'Redo applies it again' })
        .toBe(fieldAfter);
      await page.getByTestId('view-body').click();
      await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');

      // Nothing elsewhere: the caret in a paragraph, the focus in the Find dialog's field, in
      // the assistant's field and in the Table bar's cell id.
      const unchanged = await toXml(page);
      const pressed = async (where: string) => {
        await page.keyboard.press(CHORD);
        await painted(page);
        await page.waitForTimeout(300);
        expect(await toXml(page), `the chord with ${where}`).toBe(unchanged);
      };
      const label = paragraphOf(await documentOf(page), T1);
      await page
        .getByTestId('body-editor')
        .locator(`p[data-node-id="${idOf(label)}"]`)
        .click();
      await expect(status).toHaveText(/\/p\[\d+\]$/);
      await pressed('the caret in a paragraph');
      await r2c2.click();
      await expect(status).toHaveText(/\/tr\[2\]\/td\[2\]$/);
      await menu(page, 'edit', 'find');
      await page.getByTestId('dialog-find-query').click();
      await expect(page.getByTestId('dialog-find-query')).toBeFocused();
      await pressed('the focus in the Find dialog');
      await page.getByTestId('dialog-find-button-cancel').click();
      await expect(page.getByTestId('dialog-find')).toHaveCount(0);
      await r2c2.click();
      await page.getByTestId('ai-input').click();
      await expect(page.getByTestId('ai-input')).toBeFocused();
      await pressed("the focus in the assistant's field");
      await r2c2.click();
      await expect(page.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'true');
      await page.getByTestId('table-bar-cell-id').click();
      await expect(page.getByTestId('table-bar-cell-id')).toBeFocused();
      await pressed("the focus in the Table bar's cell id");
      await r2c2.click();

      // Default takes the chord back: there is no default to restore (decision 15).
      await openHotkeys();
      await row('insertRowBelow').click();
      await page.getByTestId('settings-hotkeys-default').click();
      await expect(row('insertRowBelow').locator('.mfbe-hotkeys-chord')).toHaveText('');
      await settingsOk();
      await expect.poll(() => tableChords(core.dataDir!)).toEqual([]);
      expect(outside).toEqual([]);
    } finally {
      await core.rpc('hotkeys.set', { bindings }).catch(() => {});
    }
  });

  test('3. Fast Mode keeps every table command: Table structure as without it at every place; Insert row below, Merge cells and Repair table with one Undo and one Redo', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const states = async () => {
      const all: string[][] = [];
      for (const one of PLACES) {
        const located = await locate(page, one);
        await located.select();
        const { entries } = await menuStates(page);
        all.push(entries.map((entry) => `${entry.id} ${entry.disabled ? 'off' : 'on'}`));
      }
      return all;
    };
    const normal = await states();
    // View → Fast Mode by its key, F5, with the focus in the Body view.
    const t1 = tableAfter(await documentOf(page), T1);
    await cellElement(page, idOf(cellOf(t1, 'r2c2'))).click();
    await page.keyboard.press('F5');
    await expect(page.getByTestId('body-view')).toHaveAttribute('data-fast-mode', 'true');
    expect(await states()).toEqual(normal);
    for (const id of ['table.insertRowBelow', 'table.mergeCells', 'table.repair']) {
      await test.step(id, async () => {
        const one = place(id);
        const located = await locate(page, one);
        await located.select();
        const before = await toXml(page);
        await runFromMenu(page, located);
        const after = await changed(page, before);
        expect(segment(after, one.label, one.next)).toBe(one.result);
        await undoRedo(page, before, after);
        await undoTo(page, before);
      });
    }
    await expect(page.getByTestId('body-view')).toHaveAttribute('data-fast-mode', 'true');
  });

  test('4. every table command waits for a script run - started in the Body view or in a description field - and for a request to the assistant, saying why; afterwards each is as before', async ({
    core,
    page,
    standin,
    context,
  }) => {
    const outside = await recordOutside(context);
    await assistantOn(core, standin);
    await openTables(core, page);
    await ensureAssistantOn(page);
    await scriptsListed(page, ['runs.longSilent']);
    const lang = await pageLang(page);
    const banner = page.getByTestId('script-run-banner');
    /** Every entry of *Table structure* unavailable with the lock's reason; *Table* too. */
    const expectLocked = async (kind: 'script' | 'ai') => {
      const reason = uiText(lang, `commands.unavailable.runLock.${kind}`);
      const { insert, entries } = await menuStates(page);
      expect(insert.disabled, 'Add → Table').toBe(true);
      expect(entries).toEqual(
        FR039.map((name) => {
          const title = uiText(lang, 'commands.unavailable.title', {
            command: uiText(lang, `tables.cmd.${name}.tooltip`),
            reason,
          });
          return {
            id: `menu-add-tableStructure-${name}`,
            disabled: true,
            title,
            description: title,
          };
        }),
      );
    };
    /** A right-click on `cell` opens no context menu. */
    const noContextMenu = async (cell: Locator) => {
      await rightClick(page, cell);
      await painted(page);
      await page.waitForTimeout(200);
      await expect(page.getByTestId('context-menu')).toHaveCount(0);
    };
    const startRun = async () => {
      await page.evaluate(() => {
        void window.__mfbeTest!.scripts!.run('runs.longSilent');
      });
      await expect(banner).toBeVisible();
    };
    const cancelRun = async (xml: string) => {
      await banner.getByTestId('script-run-cancel').click();
      await expect(banner).toHaveCount(0);
      // Cancel gives back the document as before the run (the fixture changes a paragraph).
      await expect.poll(() => toXml(page)).toBe(xml);
    };

    const r2c2 = await locate(page, place('table.insertRowBelow'));
    await r2c2.select();
    const normal = await menuStates(page);
    const xml = await toXml(page);

    // A script run started in the Body view with the caret at r2c2.
    await r2c2.select();
    await startRun();
    await expectLocked('script');
    await noContextMenu(r2c2.target);
    await cancelRun(xml);

    // A run started in the Description view with the caret in the annotation's table. A script
    // works on the Body view, which the run shows (feature 002; `scripting/catalog.ts`), and
    // the same holds there: no context menu on that table's cell in the Body view's annotation.
    await showDescription(page);
    const regular = await annotationTable(page);
    const fieldCell = idOf(cellOf(regular, 'r1c2'));
    await clickFieldCell(page, fieldCell);
    await startRun();
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'body');
    await expectLocked('script');
    await noContextMenu(cellElement(page, fieldCell));
    await cancelRun(xml);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');

    // A request to the assistant, its answer held by the stand-in.
    await r2c2.select();
    await standin.reset();
    await standin.scenarios([{ text: 'Later.', delayMs: 4000 }]);
    await page.getByTestId('ai-input').fill('Wait a moment');
    await page.getByTestId('ai-input').press('Enter');
    await expect(banner).toBeVisible();
    await expectLocked('ai');
    await expect(banner).toHaveCount(0, { timeout: 30_000 });

    // Afterwards every entry is as before.
    await r2c2.select();
    expect(await menuStates(page)).toEqual(normal);
    expect(await toXml(page)).toBe(xml);
    expect(outside).toEqual([]);
  });

  test.describe('@platform the context menu of a cell', () => {
    test('5. with the caret in a paragraph, a right-click straight on a cell moves the caret there; Insert row below acts there; Split cell says why it is unavailable', async ({
      core,
      page,
    }) => {
      await openTables(core, page);
      const doc = await documentOf(page);
      const t1 = tableAfter(doc, T1);
      const label = paragraphOf(doc, T1);
      await caretIn(page, idOf(label), 2);
      await rightClick(page, cellElement(page, idOf(cellOf(t1, 'r3c2'))));
      await expect(page.getByTestId('context-menu')).toBeVisible();
      await expect(page.getByTestId('status-path')).toHaveText(/\/tr\[3\]\/td\[2\]$/);
      await page.getByTestId('context-menu-tableStructure').click();
      await expect(page.getByTestId('context-menu-tableStructure-popup')).toBeVisible();
      const split = page.getByTestId('context-menu-tableStructure-splitCell');
      const title = await pageText(page, 'commands.unavailable.title', {
        command: await pageText(page, 'tables.cmd.splitCell.tooltip'),
        reason: await pageText(page, 'tables.reason.not-merged.cell'),
      });
      await expect(split).toHaveAttribute('aria-disabled', 'true');
      await expect(split).toHaveAttribute('title', title);
      await expect(split).toHaveAttribute('aria-description', title);
      const before = await toXml(page);
      const insertRowBelow = page.getByTestId('context-menu-tableStructure-insertRowBelow');
      await expect(insertRowBelow).not.toHaveAttribute('aria-disabled');
      await insertRowBelow.click();
      const after = await changed(page, before);
      expect(segment(after, T1, T2)).toBe(
        `<p>${T1}</p>${table(R1, R2, R3, tr(td() + td() + td()))}`,
      );
      await undoRedo(page, before, after);
    });
  });

  test.describe('the table buttons at scale 2', () => {
    test.use({ deviceScaleFactor: 2 });

    test('6. every table button shows its 24 px icon at its natural CSS width', async ({
      core,
      page,
    }) => {
      await core.openApp(page);
      await expect(page.getByTestId('toolbars')).toBeVisible();
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
      await addTableButtons(page);
      const images = await page.evaluate<{ src: string; natural: number; width: number }[]>(
        `[...document.querySelectorAll('.mfbe-toolbar-button img')]
          .filter((img) => (img.getAttribute('src') || '').includes('/toolbar24/table-'))
          .map((img) => ({
            src: img.getAttribute('src') || '',
            natural: img.naturalWidth,
            width: img.getBoundingClientRect().width,
          }))`,
      );
      expect(images).toHaveLength(OFFERED.length);
      for (const image of images) {
        // Shown at its natural CSS size, as keyboard-hidpi.spec.ts checks the original icons.
        expect(image.width, image.src).toBe(image.natural);
        expect(image.natural, image.src).toBe(24);
      }
      await resetToolbar(page);
    });
  });
});
