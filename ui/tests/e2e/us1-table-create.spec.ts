/**
 * Feature 006, User Story 1 - Create a table where I need it, with the rows and columns I need
 * (T047 to T049; spec FR-001 to FR-005, FR-040, FR-041, FR-043, FR-045, FR-061; SC-002, SC-007,
 * SC-009; quickstart §1 "Automated").
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode. The file also runs in the projects `chromium-ru` and `chromium-uk` (C78):
 * every text of the interface is compared through `pageText` in the language the page shows.
 * The worker's core is shared by the tests of a worker (`fixtures/core.ts`), so every test starts
 * from the dialog's defaults (`session.tableDialog: null`, before the page loads) and fills every
 * field it relies on. Positions are found in `__mfbeTest.scripts.document()` by their place in
 * the fixture and set with `scripts.select` or `scripts.selectRange`; "unchanged" compares
 * `__mfbeTest.scripts.toXml()`, and after every insertion one Undo restores that text exactly and
 * one Redo gives the result again (SC-007, U22).
 *
 * Tests:
 *  - "Add → Table at every kind of caret position" (SC-002, the Body view; C26, C79; U18): one
 *    `__mfbeTest.tables.placementSweep` call over every caret position of every text block of
 *    `tables-placement.fb2` the Body view shows, against an oracle written here: FR-004's
 *    candidates, each tried in a second session of the book with `doc.validate` (project
 *    `chromium` only - it compares codes, not texts);
 *  - "ten insertions across the kinds of block": Add → Table in each kind of block, the table's
 *    siblings in the XML, `doc.validate` of the live model, Undo and Redo; three insertions kept,
 *    saved as a copy, the copy reopened and validated (manual step 11);
 *  - sc.1 to sc.9 of US1, "Table… in the context menu follows FR-004" and the edge cases (T048);
 *  - "10. Add → Table in the Source view" (T049);
 *  - the "SC-001" test of T184 joins them.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import {
  expect,
  fileNew,
  fixtureBook,
  startCoreWith,
  test,
  waitForBook,
  waitForStartupDocument,
  withUiLang,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import { pageAnyPattern, pageText } from './fixtures/i18n';
import { LINE_END, MOD } from './fixtures/keys';

/* ------------------------------------------------------------------------ */
/* The page's hooks and the model JSON                                      */
/* ------------------------------------------------------------------------ */

/** A node of the model JSON (`ui/src/model/document.ts`), as far as this journey reads it. */
interface Json {
  type: string;
  attrs?: Record<string, unknown> & { nodeId?: string };
  content?: Json[];
  text?: string;
}

interface DocJson {
  docId: string;
  bodies: Json[];
  description: {
    titleInfo: { annotation?: Json };
    documentInfo: { history?: Json };
  };
}

interface ModelPoint {
  nodeId: string;
  offset: number;
}

/** A `TablePoint` in model terms (data-model §16.4). */
type Landing =
  | { kind: 'insert'; parent: string; after: string | null }
  | { kind: 'split'; node: string; offset: number }
  | { kind: 'replace'; node: string };

interface SweepAnswer {
  pos: ModelPoint;
  enabled: boolean;
  reason: string | null;
  landing: Landing | null;
}

interface TableSummary {
  rows: number;
  columns: number;
  shortRows: number;
  row?: number;
  covered?: number;
  overlaps: number;
  pastEnd: number;
  id?: string;
}

declare const window: {
  __mfbeTest?: {
    scripts?: {
      document(): DocJson;
      toXml(): Promise<string>;
      select(nodeId: string, from?: number, to?: number): boolean;
      selectRange(anchor: ModelPoint, head: ModelPoint): boolean;
    };
    sourceMapping?: {
      bodySelection(): { anchor: ModelPoint; head: ModelPoint } | null;
      sourceSelection(): { anchor: number; head: number } | null;
      sourceText(): string | null;
      select(anchor: number, head?: number): boolean;
    };
    tables?: {
      placementSweep(positions: ModelPoint[]): SweepAnswer[];
      grid(tableRef: string): TableSummary | null;
    };
    sourceTable?: {
      sweep(offsets: number[]): { offset: number; enabled: boolean; code: string }[];
    };
  };
};

const PLACEMENT = fixtureBook('tables-placement.fb2');

/** The model of the open document. */
function documentOf(page: Page): Promise<DocJson> {
  return page.evaluate(() => window.__mfbeTest!.scripts!.document());
}

/** The live document as FB2 text, binaries elided. */
function toXml(page: Page): Promise<string> {
  return page.evaluate(() => window.__mfbeTest!.scripts!.toXml());
}

/** A caret (or a range) in the text block `nodeId` of the Body view. */
async function caretAt(page: Page, point: ModelPoint, to = point.offset): Promise<void> {
  const placed = await page.evaluate(
    ([nodeId, from, end]) => window.__mfbeTest!.scripts!.select(nodeId, from, end),
    [point.nodeId, point.offset, to] as const,
  );
  expect(placed, `the caret in ${point.nodeId} at ${point.offset}`).toBe(true);
}

/** The text blocks of the model: the leaves a caret stands in. */
const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'date', 'td', 'th']);

/** A text block's content size as ProseMirror counts it: UTF-16 code units, an inline atom 1. */
function sizeOf(block: Json): number {
  let size = 0;
  for (const child of block.content ?? []) {
    size += child.type === 'text' ? (child.text ?? '').length : 1;
  }
  return size;
}

function textOf(node: Json): string {
  return (node.content ?? [])
    .map((child) => (child.type === 'text' ? (child.text ?? '') : textOf(child)))
    .join('');
}

/** A tree the Body view shows: a body, the book's annotation (its block) or the history. */
interface Root {
  /** `body:<n>`, or the fixed id of the Body view's block (`FIXED_BLOCK_IDS`). */
  key: string;
  node: Json;
}

function rootsOf(doc: DocJson): Root[] {
  const roots: Root[] = [];
  const annotation = doc.description.titleInfo.annotation;
  const history = doc.description.documentInfo.history;
  if (annotation) roots.push({ key: 'desc:annotation', node: annotation });
  if (history) roots.push({ key: 'desc:history', node: history });
  doc.bodies.forEach((body, index) => roots.push({ key: `body:${index}`, node: body }));
  return roots;
}

function rootNode(doc: DocJson, key: string): Json {
  if (key === 'desc:annotation') return doc.description.titleInfo.annotation!;
  if (key === 'desc:history') return doc.description.documentInfo.history!;
  return doc.bodies[Number(key.slice('body:'.length))]!;
}

/** One step of the path from a root: the node and its index in its parent (−1 for the root). */
interface Frame {
  node: Json;
  index: number;
}

interface TextBlock {
  root: Root;
  /** The root first, the text block last. */
  chain: Frame[];
  node: Json;
  nodeId: string;
  size: number;
}

/** Every text block of the trees the Body view shows, in document order. */
function textBlocks(doc: DocJson): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const root of rootsOf(doc)) {
    const visit = (node: Json, chain: Frame[]) => {
      if (TEXT_BLOCKS.has(node.type)) {
        blocks.push({ root, chain, node, nodeId: node.attrs!.nodeId!, size: sizeOf(node) });
        return;
      }
      (node.content ?? []).forEach((child, index) => {
        if (child.type !== 'text') visit(child, [...chain, { node: child, index }]);
      });
    };
    visit(root.node, [{ node: root.node, index: -1 }]);
  }
  return blocks;
}

/** The first text block whose text satisfies `test` (bodies first, then the blocks). */
function blockWhere(doc: DocJson, test: (node: Json) => boolean, what: string): TextBlock {
  const blocks = textBlocks(doc);
  const ordered = [
    ...blocks.filter((block) => block.root.key.startsWith('body:')),
    ...blocks.filter((block) => !block.root.key.startsWith('body:')),
  ];
  const found = ordered.find((block) => test(block.node));
  if (!found) throw new Error(`no text block: ${what}`);
  return found;
}

/** The text block of `type` whose text starts with `text`. */
function blockStarting(doc: DocJson, type: string, text: string): TextBlock {
  return blockWhere(
    doc,
    (node) => node.type === type && textOf(node).startsWith(text),
    `${type} "${text}"`,
  );
}

/** The first empty text block of `type` in the bodies. */
function emptyBlock(doc: DocJson, type: string): TextBlock {
  return blockWhere(doc, (node) => node.type === type && sizeOf(node) === 0, `an empty ${type}`);
}

/* ------------------------------------------------------------------------ */
/* The oracle of SC-002 (C26)                                               */
/* ------------------------------------------------------------------------ */

/** The table each candidate is tried with. */
const ORACLE_TABLE: Json = {
  type: 'table',
  attrs: { nodeId: 'oracle-table' },
  content: [
    {
      type: 'tr',
      attrs: { nodeId: 'oracle-tr' },
      content: [
        { type: 'td', attrs: { nodeId: 'oracle-td' }, content: [{ type: 'text', text: 'x' }] },
      ],
    },
  ],
};

/** The index after a section's heading part: `title?`, `epigraph*`, `image?`, `annotation?`. */
function headingEnd(section: Json): number {
  const children = section.content ?? [];
  let index = 0;
  if (children[index]?.type === 'title') index += 1;
  while (children[index]?.type === 'epigraph') index += 1;
  if (children[index]?.type === 'image') index += 1;
  if (children[index]?.type === 'annotation') index += 1;
  return index;
}

/** One candidate of FR-004: where it lands and how it changes the container in a copy. */
interface Candidate {
  /** Validity depends on this key only (memoised). */
  key: string;
  landing: Landing;
  rootKey: string;
  /** Child indexes from the root to the container. */
  path: number[];
  change(container: Json): void;
}

/** The container's id as the hook names it: the Body view's blocks by their fixed ids. */
function containerId(block: TextBlock, level: number): string {
  if (level === 0 && block.root.key.startsWith('desc:')) return block.root.key;
  return block.chain[level]!.node.attrs!.nodeId!;
}

function idAt(container: Json, index: number): string | null {
  return index > 0 ? container.content![index - 1]!.attrs!.nodeId! : null;
}

/**
 * The candidates of C26 for a caret at `offset` of `block`: (a)'s point for a `p` or a
 * `subtitle` - an empty `p` replaced, offset 0 of a non-empty block before it, its end after it
 * (an empty `subtitle` included), else a split -, then at each enclosing level up to the body
 * the gaps after the caret's ancestor, never descending, a section's heading part skipped.
 */
function candidates(block: TextBlock, offset: number): Candidate[] {
  const out: Candidate[] = [];
  const { chain, node } = block;
  const n = chain.length;
  const rootKey = block.root.key;
  const pathTo = (level: number) => chain.slice(1, level + 1).map((frame) => frame.index);
  const container = chain[n - 2]!.node;
  const index = chain[n - 1]!.index;
  const parent = containerId(block, n - 2);
  if (node.type === 'p' || node.type === 'subtitle') {
    const base = { rootKey, path: pathTo(n - 2) };
    if (node.type === 'p' && block.size === 0) {
      out.push({
        ...base,
        key: `a:${block.nodeId}:empty`,
        landing: { kind: 'replace', node: block.nodeId },
        change: (c) => void c.content!.splice(index, 1, structuredClone(ORACLE_TABLE)),
      });
    } else if (offset === block.size) {
      out.push({
        ...base,
        key: `a:${block.nodeId}:end`,
        landing: { kind: 'insert', parent, after: block.nodeId },
        change: (c) => void c.content!.splice(index + 1, 0, structuredClone(ORACLE_TABLE)),
      });
    } else if (offset === 0) {
      out.push({
        ...base,
        key: `a:${block.nodeId}:start`,
        landing: { kind: 'insert', parent, after: idAt(container, index) },
        change: (c) => void c.content!.splice(index, 0, structuredClone(ORACLE_TABLE)),
      });
    } else {
      out.push({
        ...base,
        key: `a:${block.nodeId}:middle`,
        landing: { kind: 'split', node: block.nodeId, offset },
        // The block, the table and an empty copy of the block without its id.
        change: (c) => {
          const original = c.content![index]!;
          const attrs: Record<string, unknown> = { ...original.attrs, nodeId: 'oracle-half' };
          delete attrs.id;
          c.content!.splice(index + 1, 0, structuredClone(ORACLE_TABLE), {
            type: original.type,
            attrs,
            content: [],
          });
        },
      });
    }
  }
  for (let level = n - 2; level >= 0; level -= 1) {
    const holder = chain[level]!.node;
    const childIndex = chain[level + 1]!.index;
    const id = containerId(block, level);
    const first =
      holder.type === 'section' ? Math.max(childIndex + 1, headingEnd(holder)) : childIndex + 1;
    for (let gap = first; gap <= (holder.content ?? []).length; gap += 1) {
      out.push({
        key: `g:${id}:${gap}`,
        landing: { kind: 'insert', parent: id, after: idAt(holder, gap) },
        rootKey,
        path: pathTo(level),
        change: (c) => void c.content!.splice(gap, 0, structuredClone(ORACLE_TABLE)),
      });
    }
  }
  return out;
}

function landingText(landing: Landing | null): string {
  if (!landing) return 'none';
  if (landing.kind === 'insert') return `insert into ${landing.parent} after ${landing.after}`;
  if (landing.kind === 'split') return `split ${landing.node} at ${landing.offset}`;
  return `replace ${landing.node}`;
}

/** Runs `task` over `items` with at most `limit` running at once; results in input order. */
async function inParallel<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** The node ids of `from` mapped to those of `to`, two models of the same book. */
function nodeIdMap(from: DocJson, to: DocJson): Map<string, string> {
  const map = new Map<string, string>([
    ['desc:annotation', 'desc:annotation'],
    ['desc:history', 'desc:history'],
  ]);
  const walk = (a: Json, b: Json) => {
    expect(b.type).toBe(a.type);
    const id = a.attrs?.nodeId;
    if (typeof id === 'string') map.set(id, b.attrs!.nodeId!);
    const children = a.content ?? [];
    expect((b.content ?? []).length).toBe(children.length);
    children.forEach((child, index) => walk(child, b.content![index]!));
  };
  const rootsFrom = rootsOf(from);
  const rootsTo = rootsOf(to);
  expect(rootsTo.map((root) => root.key)).toEqual(rootsFrom.map((root) => root.key));
  rootsFrom.forEach((root, index) => walk(root.node, rootsTo[index]!.node));
  return map;
}

function mapLanding(landing: Landing | null, ids: Map<string, string>): Landing | null {
  const id = (value: string) => ids.get(value) ?? value;
  if (!landing) return null;
  if (landing.kind === 'insert') {
    return {
      kind: 'insert',
      parent: id(landing.parent),
      after: landing.after === null ? null : id(landing.after),
    };
  }
  if (landing.kind === 'split') return { ...landing, node: id(landing.node) };
  return { ...landing, node: id(landing.node) };
}

/* ------------------------------------------------------------------------ */
/* Page helpers                                                             */
/* ------------------------------------------------------------------------ */

async function supportsDocuments(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('doc.recent')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/** The application, then `file` through File → Open and the queued native dialog. */
async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
  await openFile(core, page, file);
}

/**
 * File → Open of `file` in the running application; the Body editor is ready afterwards. With
 * `discard`, the changes of the open document are discarded when the editor asks.
 */
async function openFile(
  core: CoreHandle,
  page: Page,
  file: string,
  { discard = false }: { discard?: boolean } = {},
): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await menu(page, 'file', 'open');
  if (discard) await page.getByTestId('dialog-save-changes-button-no').click();
  await waitForBook(page, file);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
  // The page's hooks come with the core's `app.info` (it runs with --test-hooks).
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof window.__mfbeTest?.scripts?.document === 'function' &&
          typeof window.__mfbeTest?.tables?.grid === 'function',
      ),
    )
    .toBe(true);
}

/** Save As to `file` through the queued native dialog; returns the written text. */
async function saveAs(core: CoreHandle, page: Page, file: string): Promise<string> {
  await core.enqueueDialog('dialog.saveFile', { path: file, encoding: 'utf-8' });
  await menu(page, 'file', 'saveAs');
  const saved = await pageAnyPattern(page, 'status.savedNoErrors', 'msg.errorsFound');
  await expect(page.getByTestId('status-message')).toContainText(saved);
  await expect(page).toHaveTitle(
    new RegExp(`^${path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} - `),
  );
  return readFileSync(file, 'utf8');
}

interface DialogValues {
  rows: number;
  columns: number;
  headerRow?: boolean;
  headerColumn?: boolean;
}

/** Fills all four fields of the open Table properties dialog and confirms it. */
async function confirmTableDialog(page: Page, values: DialogValues): Promise<void> {
  const dialog = page.getByTestId('dialog-table');
  await expect(dialog).toBeVisible();
  await page.getByTestId('dialog-table-rows').fill(String(values.rows));
  await page.getByTestId('dialog-table-columns').fill(String(values.columns));
  await page.getByTestId('dialog-table-header').setChecked(values.headerRow ?? false);
  await page.getByTestId('dialog-table-header-column').setChecked(values.headerColumn ?? false);
  await page.getByTestId('dialog-table-button-ok').click();
  await expect(dialog).toBeHidden();
}

/** Add → Table, which must be available, with the dialog confirmed with `values`. */
async function addTable(page: Page, values: DialogValues): Promise<void> {
  await page.getByTestId('menu-add').click();
  const entry = page.getByTestId('menu-add-table');
  await expect(entry).not.toHaveAttribute('aria-disabled');
  await entry.click();
  await confirmTableDialog(page, values);
}

/** The errors `doc.validate` finds in the live model. */
async function liveErrors(core: CoreHandle, page: Page): Promise<number> {
  const document = await documentOf(page);
  const report = await core.rpcJob<{ errorCount: number }>('doc.validate', {
    docId: document.docId,
    document,
  });
  return report.errorCount;
}

/** A pattern of `text` in the XML: regular-expression characters escaped. */
function esc(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The pattern of a new table, its rows' cell kinds given, every cell empty, no attribute. */
function tablePattern(rows: readonly (readonly ('td' | 'th')[])[]): string {
  const cell = (kind: string) => `<${kind}(?:/>|></${kind}>)\\s*`;
  return `<table>\\s*${rows.map((row) => `<tr>\\s*${row.map(cell).join('')}</tr>\\s*`).join('')}</table>`;
}

/** The 2 × 2 table without header cells the dialog's defaults make. */
const TABLE_2X2 = tablePattern([
  ['td', 'td'],
  ['td', 'td'],
]);

/** The cell kinds of the table the dialog's values make (FR-001, FR-003). */
function kindsOf(values: DialogValues): ('td' | 'th')[][] {
  const rows: ('td' | 'th')[][] = [];
  if (values.headerRow) rows.push(Array.from({ length: values.columns }, () => 'th' as const));
  for (let row = 0; row < values.rows; row += 1) {
    rows.push(
      Array.from({ length: values.columns }, (_, column) =>
        column === 0 && values.headerColumn ? ('th' as const) : ('td' as const),
      ),
    );
  }
  return rows;
}

const endOf = (block: TextBlock): ModelPoint => ({ nodeId: block.nodeId, offset: block.size });
const startOf = (block: TextBlock): ModelPoint => ({ nodeId: block.nodeId, offset: 0 });

/** Every node of the trees the Body view shows, in document order. */
function allNodes(doc: DocJson): Json[] {
  const nodes: Json[] = [];
  const visit = (node: Json) => {
    nodes.push(node);
    for (const child of node.content ?? []) visit(child);
  };
  for (const root of rootsOf(doc)) visit(root.node);
  return nodes;
}

function tableIds(doc: DocJson): Set<string> {
  return new Set(
    allNodes(doc)
      .filter((node) => node.type === 'table')
      .map((node) => node.attrs!.nodeId!),
  );
}

/** The one table of `doc` that `before` lacks. */
function newTableIn(doc: DocJson, before: ReadonlySet<string>): Json {
  const tables = allNodes(doc).filter(
    (node) => node.type === 'table' && !before.has(node.attrs!.nodeId!),
  );
  expect(tables, 'one new table').toHaveLength(1);
  return tables[0]!;
}

/** The node that passes `test`, with its parent and its index there. */
function placeOf(
  doc: DocJson,
  test: (node: Json) => boolean,
  what: string,
): { node: Json; parent: Json; index: number } {
  for (const root of rootsOf(doc)) {
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
    const found = search(root.node);
    if (found) return found;
  }
  throw new Error(`not found: ${what}`);
}

/** The table that follows the paragraph whose text starts with `text`. */
function tableAfter(doc: DocJson, text: string): Json {
  const { parent, index } = placeOf(
    doc,
    (node) => node.type === 'p' && textOf(node).startsWith(text),
    `the paragraph "${text}"`,
  );
  const table = parent.content![index + 1]!;
  expect(table.type).toBe('table');
  return table;
}

function bodySelection(page: Page): Promise<{ anchor: ModelPoint; head: ModelPoint } | null> {
  return page.evaluate(() => window.__mfbeTest!.sourceMapping!.bodySelection());
}

/** The caret at offset 0 of the table's first cell: in the model and in the status bar. */
async function expectCaretInFirstCell(page: Page, table: Json): Promise<void> {
  const first = table.content![0]!.content![0]!;
  const point = { nodeId: first.attrs!.nodeId!, offset: 0 };
  await expect.poll(() => bodySelection(page)).toEqual({ anchor: point, head: point });
  await expect(page.getByTestId('status-path')).toHaveText(
    new RegExp(`/tr\\[1\\]/${first.type}\\[1\\]$`),
  );
}

/**
 * One insertion through Add → Table at `point`, checked as US1 asks: the table's place in the
 * XML (`expected`, given the table's pattern), no attribute on the new table, its rows and its
 * cells, the caret at offset 0 of its first cell, one Undo giving back the text before and one
 * Redo the result (SC-007); undone again unless `keep`. Returns the new table.
 */
async function insertAndCheck(
  page: Page,
  point: ModelPoint,
  values: DialogValues,
  expected: (table: string) => RegExp,
  { keep = false }: { keep?: boolean } = {},
): Promise<Json> {
  await caretAt(page, point);
  const before = await toXml(page);
  const tables = tableIds(await documentOf(page));
  await addTable(page, values);
  await expect.poll(() => toXml(page)).not.toBe(before);
  const after = await toXml(page);
  expect(after).toMatch(expected(tablePattern(kindsOf(values))));
  const table = newTableIn(await documentOf(page), tables);
  await expectCaretInFirstCell(page, table);
  await menu(page, 'edit', 'undo');
  await expect.poll(() => toXml(page), { message: 'one Undo removes the table' }).toBe(before);
  await menu(page, 'edit', 'redo');
  await expect.poll(() => toXml(page), { message: 'one Redo brings it back' }).toBe(after);
  if (!keep) {
    await menu(page, 'edit', 'undo');
    await expect.poll(() => toXml(page)).toBe(before);
  }
  return table;
}

/** "Insert table: no table may stand here" in the interface language (FR-043). */
async function noTablePlaceTitle(page: Page): Promise<string> {
  return pageText(page, 'commands.unavailable.title', {
    command: await pageText(page, 'cmd.insert.table.tooltip'),
    reason: await pageText(page, 'tables.reason.noTablePlace'),
  });
}

/**
 * Right-clicks just right of the end of the editor text `text`, in the element that holds it
 * (Playwright scrolls it into view; the point is measured relative to the element).
 */
async function rightClickAfterText(page: Page, text: string): Promise<void> {
  const point = await page.evaluate<{ x: number; y: number } | null>(`(() => {
    const editor = document.querySelector('[data-testid="body-editor"]');
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(${JSON.stringify(text)});
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at + ${text.length - 1});
      range.setEnd(node, at + ${text.length});
      const rect = range.getBoundingClientRect();
      const box = node.parentElement.closest('p').getBoundingClientRect();
      return { x: rect.right + 1 - box.left, y: rect.top + rect.height / 2 - box.top };
    }
    return null;
  })()`);
  if (!point) throw new Error(`no text "${text}" in the Body view`);
  await blockElement(page, 'p', text).click({ button: 'right', position: point });
}

/** The Body view's element of the text block whose text starts with `text`. */
function blockElement(page: Page, selector: string, text: string) {
  return page.getByTestId('body-editor').locator(selector, { hasText: text }).first();
}

test.describe('US1 (feature 006) - create a table where it is needed', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us1-table-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.* yet');
    // The dialog's defaults for every test (the worker's core is shared); the AI panel hidden
    // for the page load, so the views have their full width (restored afterwards).
    await core.rpc('settings.set', {
      patch: { session: { tableDialog: null, aiPanelVisible: false } },
    });
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    await core
      .rpc('settings.set', {
        patch: { session: { tableDialog: null, aiPanelVisible: true, toolbarLayouts: null } },
      })
      .catch(() => {});
  });

  test('Add → Table at every kind of caret position (SC-002, Body)', async ({
    core,
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'compares codes: the English leg suffices');
    test.setTimeout(240_000);
    await openBook(core, page, PLACEMENT);
    const shown = await documentOf(page);
    // Every offset of every text block, cells included (data-model §16.4).
    const blocks = textBlocks(shown);
    const positions: ModelPoint[] = blocks.flatMap((block) =>
      Array.from({ length: block.size + 1 }, (_, offset) => ({ nodeId: block.nodeId, offset })),
    );
    expect(blocks.length).toBeGreaterThan(40);
    const xmlBefore = await toXml(page);
    const answers = await page.evaluate(
      (points) => window.__mfbeTest!.tables!.placementSweep(points),
      positions,
    );
    expect(answers).toHaveLength(positions.length);
    expect(await toXml(page), 'the sweep changes nothing').toBe(xmlBefore);

    // The oracle: a second session of the book, each candidate tried with doc.validate.
    const opened = await core.rpcJob<{ document: DocJson }>('doc.open', { path: PLACEMENT });
    const second = opened.document;
    try {
      const ids = nodeIdMap(second, shown);
      const secondBlocks = textBlocks(second);
      expect(secondBlocks.map((block) => block.size)).toEqual(blocks.map((block) => block.size));
      const verdicts = new Map<string, Promise<boolean>>();
      const valid = (candidate: Candidate): Promise<boolean> => {
        let verdict = verdicts.get(candidate.key);
        if (!verdict) {
          const copy = structuredClone(second);
          let container = rootNode(copy, candidate.rootKey);
          for (const index of candidate.path) container = container.content![index]!;
          candidate.change(container);
          verdict = core
            .rpcJob<{ errorCount: number }>('doc.validate', { docId: second.docId, document: copy })
            .then((report) => report.errorCount === 0);
          verdicts.set(candidate.key, verdict);
        }
        return verdict;
      };
      const work = secondBlocks.flatMap((block) =>
        Array.from({ length: block.size + 1 }, (_, offset) => ({ block, offset })),
      );
      const expected = await inParallel(work, 8, async ({ block, offset }) => {
        for (const candidate of candidates(block, offset)) {
          if (await valid(candidate)) return mapLanding(candidate.landing, ids);
        }
        return null;
      });

      const mismatches: string[] = [];
      answers.forEach((answer, index) => {
        const position = positions[index]!;
        const block = blocks.find((candidate) => candidate.nodeId === position.nodeId)!;
        const where = `${block.node.type} ${position.nodeId} "${textOf(block.node).slice(0, 32)}" at ${position.offset}`;
        const want = expected[index]!;
        const problems: string[] = [];
        if (answer.pos.nodeId !== position.nodeId || answer.pos.offset !== position.offset) {
          problems.push(`answered for ${answer.pos.nodeId} at ${answer.pos.offset}`);
        }
        if (answer.enabled !== (answer.reason === null)) {
          problems.push(`enabled ${answer.enabled} with the reason ${answer.reason}`);
        }
        if (answer.enabled !== (want !== null)) problems.push(`enabled ${answer.enabled}`);
        if (answer.reason !== (want ? null : 'noTablePlace')) {
          problems.push(`reason ${answer.reason}`);
        }
        if (landingText(answer.landing) !== landingText(want)) {
          problems.push(`lands: ${landingText(answer.landing)}`);
        }
        if (problems.length > 0) {
          mismatches.push(`${where}: ${problems.join('; ')} - expected ${landingText(want)}`);
        }
      });
      expect(mismatches, `${mismatches.length} of ${positions.length} positions`).toEqual([]);
      // Both kinds of answer occur: the sweep is not trivially uniform.
      expect(expected.some((landing) => landing === null)).toBe(true);
      expect(expected.some((landing) => landing?.kind === 'split')).toBe(true);
    } finally {
      await core.rpc('doc.close', { docId: second.docId }).catch(() => {});
    }
  });

  test('ten insertions across the kinds of block: the place, a valid book, Undo and Redo', async ({
    core,
    page,
  }) => {
    test.setTimeout(240_000);
    await openBook(core, page, PLACEMENT);
    const T = TABLE_2X2;
    const pSplit = (doc: DocJson) =>
      blockWhere(doc, (node) => node.attrs?.id === 'p-split', 'the paragraph p-split');
    // The halves of p-split at offset 11, the attributes as the writer writes them.
    const original = await toXml(page);
    const splitTag = /<p id="p-split"[^>]*>/.exec(original)![0];
    const secondHalfTag = splitTag.replace(/\s+id="p-split"/, '');
    const cases: {
      name: string;
      at: (doc: DocJson) => ModelPoint;
      expected: RegExp;
      keep?: true;
    }[] = [
      {
        name: 'the start of a paragraph: the table before it',
        at: (doc) => startOf(blockStarting(doc, 'p', 'The paragraph at the start of section 1')),
        expected: new RegExp(
          `Section 1</p>\\s*</title>\\s*${T}\\s*<p>The paragraph at the start of section 1`,
        ),
      },
      {
        name: 'the end of a paragraph: the table after it',
        at: (doc) => endOf(blockStarting(doc, 'p', 'A paragraph in the middle of section 1.')),
        expected: new RegExp(`A paragraph in the middle of section 1\\.</p>\\s*${T}\\s*<poem>`),
      },
      {
        name: 'an empty paragraph: the table in its place',
        at: (doc) => startOf(emptyBlock(doc, 'p')),
        expected: new RegExp(
          `which an insertion splits\\.</p>\\s*${T}\\s*<p>A non-empty paragraph after the empty one\\.`,
        ),
      },
      {
        name: 'the empty subtitle: the table after it',
        at: (doc) => startOf(emptyBlock(doc, 'subtitle')),
        expected: new RegExp(
          `<subtitle(?:/>|></subtitle>)\\s*${T}\\s*<p>A paragraph in the middle of section 1\\.`,
        ),
      },
      {
        name: "a section's title: the first point of its text",
        at: (doc) => endOf(blockStarting(doc, 'p', 'Section 1')),
        expected: new RegExp(
          `Section 1</p>\\s*</title>\\s*${T}\\s*<p>The paragraph at the start of section 1`,
        ),
      },
      {
        name: 'a poem line: right after the poem',
        at: (doc) => endOf(blockStarting(doc, 'v', 'The first line of the poem')),
        expected: new RegExp(`The poet</text-author>\\s*</poem>\\s*${T}\\s*<cite>`),
      },
      {
        name: 'a cite paragraph: inside the cite, after the paragraph',
        at: (doc) => endOf(blockStarting(doc, 'p', 'The first paragraph of a cite.')),
        expected: new RegExp(
          `The first paragraph of a cite\\.</p>\\s*${T}\\s*<p>The second paragraph of the cite\\.`,
        ),
      },
      {
        name: "a cite's text-author line: right after the cite",
        at: (doc) => endOf(blockStarting(doc, 'text-author', 'The cited author')),
        expected: new RegExp(
          `The cited author</text-author>\\s*</cite>\\s*${T}\\s*<table>\\s*<tr>\\s*<td>r1c1`,
        ),
      },
      {
        name: 'a cell: right after its table',
        at: (doc) => endOf(blockStarting(doc, 'td', 'r1c1')),
        expected: new RegExp(
          `<td>r2c2</td>\\s*</tr>\\s*</table>\\s*${T}\\s*<p>The paragraph at the end of section 1\\.`,
        ),
      },
      {
        name: "a section annotation's paragraph: inside the annotation",
        at: (doc) => endOf(blockStarting(doc, 'p', 'The annotation of section 4.')),
        expected: new RegExp(`The annotation of section 4\\.</p>\\s*${T}\\s*</annotation>`),
      },
      {
        name: 'the history block: inside the history',
        at: (doc) => endOf(blockStarting(doc, 'p', 'The first paragraph of the history.')),
        expected: new RegExp(
          `The first paragraph of the history\\.</p>\\s*${T}\\s*<p>The second paragraph of the history\\.`,
        ),
      },
      // The last three are kept, saved and reopened (manual step 11).
      {
        name: 'the middle of a paragraph with an id: split around the table',
        at: (doc) => ({ nodeId: pSplit(doc).nodeId, offset: 11 }),
        expected: new RegExp(
          `${esc(splitTag)}A paragraph</p>\\s*${T}\\s*${esc(secondHalfTag)} with an id, a style and a language, which an insertion splits\\.</p>`,
        ),
        keep: true,
      },
      {
        name: "a paragraph of a section's epigraph: the first point after the heading part",
        at: (doc) => endOf(blockStarting(doc, 'p', 'The first epigraph of section 2.')),
        expected: new RegExp(
          `The author of the cite in the annotation</text-author>\\s*</cite>\\s*</annotation>\\s*${T}\\s*<p>The first paragraph of the text of section 2`,
        ),
        keep: true,
      },
      {
        name: 'the annotation block: inside the annotation',
        at: (doc) =>
          endOf(blockStarting(doc, 'p', "The first paragraph of the book's annotation.")),
        expected: new RegExp(
          `The first paragraph of the book's annotation\\.</p>\\s*${T}\\s*<p>The second paragraph of the book's annotation\\.`,
        ),
        keep: true,
      },
    ];
    for (const insertion of cases) {
      await test.step(insertion.name, async () => {
        await caretAt(page, insertion.at(await documentOf(page)));
        const before = await toXml(page);
        await addTable(page, { rows: 2, columns: 2 });
        await expect.poll(() => toXml(page)).not.toBe(before);
        const after = await toXml(page);
        expect(after).toMatch(insertion.expected);
        expect(await liveErrors(core, page)).toBe(0);
        await menu(page, 'edit', 'undo');
        await expect
          .poll(() => toXml(page), { message: 'one Undo restores the text' })
          .toBe(before);
        await menu(page, 'edit', 'redo');
        await expect.poll(() => toXml(page), { message: 'one Redo inserts it again' }).toBe(after);
        if (!insertion.keep) {
          await menu(page, 'edit', 'undo');
          await expect.poll(() => toXml(page)).toBe(before);
        }
      });
    }

    // Saved as a copy, reopened: valid, and every kept table where it was put.
    const kept = cases.filter((insertion) => insertion.keep);
    const file = path.join(dir, 'placement-copy.fb2');
    const written = await saveAs(core, page, file);
    for (const insertion of kept) expect(written, insertion.name).toMatch(insertion.expected);
    await fileNew(page);
    await openFile(core, page, file);
    const reopened = await toXml(page);
    for (const insertion of kept) expect(reopened, insertion.name).toMatch(insertion.expected);
    await page.getByTestId('body-editor').focus();
    await page.keyboard.press('F8');
    await expect(page.getByTestId('validation-panel')).toBeVisible();
    await expect(page.getByTestId('validation-summary')).toBeVisible();
    await expect(
      page.locator('[data-testid^="validation-issue-"][data-severity="error"]'),
    ).toHaveCount(0);
  });

  /* ---------------------------------------------------------------------- */
  /* The scenarios of the Body view (T048)                                  */
  /* ---------------------------------------------------------------------- */

  test('sc.1: at the end of a paragraph - a header row and 4 rows of 3 cells after it, one Undo step', async ({
    core,
    page,
  }) => {
    await openBook(core, page, PLACEMENT);
    const doc = await documentOf(page);
    await insertAndCheck(
      page,
      endOf(blockStarting(doc, 'p', 'A paragraph in the middle of section 1.')),
      { rows: 4, columns: 3, headerRow: true },
      (T) => new RegExp(`A paragraph in the middle of section 1\\.</p>\\s*${T}\\s*<poem>`),
    );
  });

  test('sc.2: in the middle of a paragraph - split around the table, the id stays with the first half', async ({
    core,
    page,
  }) => {
    await openBook(core, page, PLACEMENT);
    const original = await toXml(page);
    const splitTag = /<p id="p-split"[^>]*>/.exec(original)![0];
    expect(splitTag).toContain('style="lead"');
    expect(splitTag).toContain('xml:lang="en"');
    // The second half: the style and the language, no id (the spec's edge case; U38).
    const secondTag = splitTag.replace(/\s+id="p-split"/, '');
    expect(secondTag).not.toContain('id=');
    const block = blockWhere(await documentOf(page), (node) => node.attrs?.id === 'p-split', 'p');
    await insertAndCheck(
      page,
      { nodeId: block.nodeId, offset: 11 },
      { rows: 2, columns: 3 },
      (T) =>
        new RegExp(
          `${esc(splitTag)}A paragraph</p>\\s*${T}\\s*${esc(secondTag)} with an id, a style and a language, which an insertion splits\\.</p>`,
        ),
    );
    // The Undo gave back the paragraph unsplit, with its id.
    expect(await toXml(page)).toContain(
      `${splitTag}A paragraph with an id, a style and a language, which an insertion splits.</p>`,
    );
  });

  test('sc.3: before a paragraph at its start, in place of an empty one, after the empty subtitle', async ({
    core,
    page,
  }) => {
    await openBook(core, page, PLACEMENT);
    const doc = await documentOf(page);
    const values = { rows: 3, columns: 2 };
    await insertAndCheck(
      page,
      startOf(blockStarting(doc, 'p', 'A non-empty paragraph after the empty one.')),
      values,
      (T) =>
        new RegExp(
          `<p></p>\\s*${T}\\s*<p>A non-empty paragraph after the empty one\\.</p>\\s*<subtitle`,
        ),
    );
    await insertAndCheck(
      page,
      startOf(emptyBlock(doc, 'p')),
      values,
      (T) =>
        new RegExp(
          `which an insertion splits\\.</p>\\s*${T}\\s*<p>A non-empty paragraph after the empty one\\.`,
        ),
    );
    // "Before" applies to a non-empty block only (C25).
    await insertAndCheck(
      page,
      startOf(emptyBlock(doc, 'subtitle')),
      values,
      (T) =>
        new RegExp(
          `<subtitle(?:/>|></subtitle>)\\s*${T}\\s*<p>A paragraph in the middle of section 1\\.`,
        ),
    );
  });

  test("sc.4: a section's title - the first element of its text, after the heading part", async ({
    core,
    page,
  }) => {
    await openBook(core, page, PLACEMENT);
    const doc = await documentOf(page);
    const values = { rows: 2, columns: 2, headerColumn: true };
    await insertAndCheck(
      page,
      endOf(blockStarting(doc, 'p', 'Section 1')),
      values,
      (T) =>
        new RegExp(
          `Section 1</p>\\s*</title>\\s*${T}\\s*<p>The paragraph at the start of section 1`,
        ),
    );
    // A heading image and an annotation: the table after the annotation, the image still the
    // heading image (C3).
    await insertAndCheck(
      page,
      startOf(blockStarting(doc, 'p', 'Section 4: a heading image and an annotation')),
      values,
      (T) =>
        new RegExp(
          `Section 4: a heading image and an annotation</p>\\s*</title>\\s*<image l:href="#heading\\.jpg"/>\\s*<annotation>\\s*<p>The annotation of section 4\\.</p>\\s*</annotation>\\s*${T}\\s*<p>The text of section 4\\.</p>`,
        ),
    );
  });

  test('sc.5: after a poem, after a cite, and inside the cite of the body’s epigraph', async ({
    core,
    page,
  }) => {
    await openBook(core, page, PLACEMENT);
    const doc = await documentOf(page);
    const values = { rows: 1, columns: 4 };
    await insertAndCheck(
      page,
      { nodeId: blockStarting(doc, 'v', 'the second line of the poem').nodeId, offset: 4 },
      values,
      (T) => new RegExp(`The poet</text-author>\\s*</poem>\\s*${T}\\s*<cite>`),
    );
    await insertAndCheck(
      page,
      startOf(blockStarting(doc, 'text-author', 'The cited author')),
      values,
      (T) => new RegExp(`The cited author</text-author>\\s*</cite>\\s*${T}\\s*<table>`),
    );
    await insertAndCheck(
      page,
      endOf(blockStarting(doc, 'p', "A paragraph of the cite in the body's epigraph.")),
      values,
      (T) =>
        new RegExp(
          `A paragraph of the cite in the body's epigraph\\.</p>\\s*${T}\\s*<text-author>The author of the cite in the body's epigraph</text-author>\\s*</cite>\\s*</epigraph>`,
        ),
    );
  });

  test('sc.6: a cell - the new table right after the caret’s table', async ({ core, page }) => {
    await openBook(core, page, PLACEMENT);
    const doc = await documentOf(page);
    await insertAndCheck(
      page,
      { nodeId: blockStarting(doc, 'td', 'r2c1').nodeId, offset: 2 },
      { rows: 2, columns: 2, headerRow: true, headerColumn: true },
      (T) =>
        new RegExp(
          `<td>r2c2</td>\\s*</tr>\\s*</table>\\s*${T}\\s*<p>The paragraph at the end of section 1\\.`,
        ),
    );
  });

  test('sc.7: no table may stand here - the menu, the toolbar button, the context menu and Alt+T', async ({
    core,
    page,
  }) => {
    // The Commands toolbar shows the button (offered in Customize only; resource-formats §6).
    await core.rpc('settings.set', {
      patch: { session: { toolbarLayouts: { commands: ['insert.table'] } } },
    });
    await openBook(core, page, PLACEMENT);
    const title = await noTablePlaceTitle(page);
    const doc = await documentOf(page);
    const places = [
      {
        name: 'the title of the section that holds subsections',
        block: blockStarting(doc, 'p', 'Section 5: a section that holds subsections'),
        element: blockElement(page, '.fb-title p', 'Section 5: a section that holds subsections'),
      },
      {
        name: "the body's title",
        block: blockStarting(doc, 'p', 'Table placement'),
        element: blockElement(page, '.fb-body > .fb-title p', 'Table placement'),
      },
      {
        name: "a paragraph directly in the body's epigraph",
        block: blockStarting(doc, 'p', "A paragraph directly in the body's epigraph."),
        element: blockElement(
          page,
          '.fb-body > .fb-epigraph > p',
          "A paragraph directly in the body's epigraph.",
        ),
      },
    ];
    const before = await toXml(page);
    for (const place of places) {
      await test.step(place.name, async () => {
        await caretAt(page, { nodeId: place.block.nodeId, offset: 3 });
        await page.getByTestId('menu-add').click();
        const entry = page.getByTestId('menu-add-table');
        await expect(entry).toHaveAttribute('aria-disabled', 'true');
        await expect(entry).toHaveAttribute('title', title);
        await page.keyboard.press('Escape');
        await expect(entry).toBeHidden();
        const button = page.getByTestId('toolbar-insert.table');
        await expect(button).toBeDisabled();
        await expect(button).toHaveAttribute('title', title);
        // The context menu's Table… judged at the clicked point, the same place.
        await place.element.click({ button: 'right' });
        const table = page.getByTestId('context-menu-insert.table');
        await expect(table).toHaveAttribute('aria-disabled', 'true');
        await expect(table).toHaveAttribute('title', title);
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('context-menu')).toHaveCount(0);
        // Alt+T opens no dialog (an Alt letter the command leaves alone may open a menu).
        await caretAt(page, { nodeId: place.block.nodeId, offset: 3 });
        await page.keyboard.press('Alt+t');
        await page.waitForTimeout(300);
        await expect(page.getByTestId('dialog-table')).toHaveCount(0);
        await page.keyboard.press('Escape');
      });
    }
    expect(await toXml(page)).toBe(before);
  });

  test('sc.8: the dialog remembers the last confirmed values, also after a restart', async ({
    core,
    page,
    uiLang,
  }) => {
    test.setTimeout(180_000);
    await openBook(core, page, PLACEMENT);
    const doc = await documentOf(page);
    const paragraph = endOf(blockStarting(doc, 'p', 'A paragraph in the middle of section 1.'));
    const rows = page.getByTestId('dialog-table-rows');
    const columns = page.getByTestId('dialog-table-columns');
    const headerRow = page.getByTestId('dialog-table-header');
    const headerColumn = page.getByTestId('dialog-table-header-column');
    const ok = page.getByTestId('dialog-table-button-ok');
    const openDialog = async () => {
      await caretAt(page, paragraph);
      await menu(page, 'add', 'table');
      await expect(page.getByTestId('dialog-table')).toBeVisible();
    };
    const expectProposed = async (values: Required<DialogValues>) => {
      await expect(rows).toHaveValue(String(values.rows));
      await expect(columns).toHaveValue(String(values.columns));
      await (values.headerRow
        ? expect(headerRow).toBeChecked()
        : expect(headerRow).not.toBeChecked());
      await (values.headerColumn
        ? expect(headerColumn).toBeChecked()
        : expect(headerColumn).not.toBeChecked());
    };

    // First use: 2, 2, no header row or column; the focus on Rows (FR-002).
    await openDialog();
    await expectProposed({ rows: 2, columns: 2, headerRow: false, headerColumn: false });
    await expect(rows).toBeFocused();
    await confirmTableDialog(page, { rows: 4, columns: 3, headerRow: true });
    await openDialog();
    await expectProposed({ rows: 4, columns: 3, headerRow: true, headerColumn: false });
    // Cancel stores nothing.
    await rows.fill('9');
    await columns.fill('9');
    await page.getByTestId('dialog-table-button-cancel').click();
    await openDialog();
    await expectProposed({ rows: 4, columns: 3, headerRow: true, headerColumn: false });

    // Out of range or not a whole number: the message, aria-invalid and no OK (FR-001).
    const rowsError = page.getByTestId('dialog-table-rows-error');
    const columnsError = page.getByTestId('dialog-table-columns-error');
    const rowsMessage = await pageText(page, 'dialog.table.rowsInvalid', { min: 1, max: 999 });
    const columnsMessage = await pageText(page, 'dialog.table.columnsInvalid', { min: 1, max: 64 });
    for (const value of ['1000', '2.5']) {
      await rows.fill(value);
      await expect(rows).toHaveAttribute('aria-invalid', 'true');
      await expect(rowsError).toHaveText(rowsMessage);
      await expect(ok).toBeDisabled();
      await rows.fill('4');
      await expect(rows).not.toHaveAttribute('aria-invalid');
      await expect(rowsError).toHaveCount(0);
      await expect(ok).toBeEnabled();
    }
    await columns.fill('65');
    await expect(columns).toHaveAttribute('aria-invalid', 'true');
    await expect(columnsError).toHaveText(columnsMessage);
    await expect(ok).toBeDisabled();
    await columns.fill('3');
    await expect(columns).not.toHaveAttribute('aria-invalid');
    await expect(columnsError).toHaveCount(0);
    await expect(ok).toBeEnabled();
    await page.getByTestId('dialog-table-button-cancel').click();

    // The values live in settings.json and survive a restart: a second core on the same data
    // folder proposes them (rpc-api.md §3.7).
    const stored = JSON.parse(readFileSync(path.join(core.dataDir!, 'settings.json'), 'utf8')) as {
      session?: { tableDialog?: unknown };
    };
    expect(stored.session?.tableDialog).toEqual({
      rows: 4,
      columns: 3,
      headerRow: true,
      headerColumn: false,
    });
    const restarted = await startCoreWith(process.env.MFBE_CORE_BIN!, core.dataDir!, []);
    const other = await page.context().newPage();
    try {
      await other.goto(withUiLang(restarted.url, uiLang));
      await other.getByTestId('app-root').waitFor();
      await waitForStartupDocument(other);
      await expect
        .poll(() =>
          other.evaluate(() => typeof window.__mfbeTest?.scripts?.document === 'function'),
        )
        .toBe(true);
      const startup = await documentOf(other);
      const inSection = textBlocks(startup).find(
        (block) => block.node.type === 'p' && block.chain.at(-2)!.node.type === 'section',
      )!;
      await caretAt(other, startOf(inSection));
      await menu(other, 'add', 'table');
      await expect(other.getByTestId('dialog-table')).toBeVisible();
      await expect(other.getByTestId('dialog-table-rows')).toHaveValue('4');
      await expect(other.getByTestId('dialog-table-columns')).toHaveValue('3');
      await expect(other.getByTestId('dialog-table-header')).toBeChecked();
      await expect(other.getByTestId('dialog-table-header-column')).not.toBeChecked();
      await other.getByTestId('dialog-table-button-cancel').click();
    } finally {
      await other.close();
      await restarted.stop();
    }
  });

  test('sc.9: Tab and Shift+Tab move cell by cell; Tab in the last cell appends a copying row as its own undo step', async ({
    core,
    page,
  }) => {
    test.setTimeout(180_000);
    await openBook(core, page, PLACEMENT);
    const doc = await documentOf(page);
    await caretAt(page, endOf(blockStarting(doc, 'p', 'A paragraph in the middle of section 1.')));
    const tables = tableIds(doc);
    await addTable(page, { rows: 2, columns: 3, headerRow: true, headerColumn: true });
    const status = page.getByTestId('status-path');
    const order = [
      'tr[1]/th[1]',
      'tr[1]/th[2]',
      'tr[1]/th[3]',
      'tr[2]/th[1]',
      'tr[2]/td[1]',
      'tr[2]/td[2]',
      'tr[3]/th[1]',
      'tr[3]/td[1]',
      'tr[3]/td[2]',
    ];
    const at = (cell: string) => new RegExp(`/table\\[1\\]/${esc(cell)}$`);
    for (let index = 0; index < order.length; index += 1) {
      await expect(status).toHaveText(at(order[index]!));
      await page.keyboard.type(`w${index + 1}`);
      if (index === 4) {
        // Shift+Tab goes back one cell, Tab forward again.
        await page.keyboard.press('Shift+Tab');
        await expect(status).toHaveText(at(order[3]!));
        await page.keyboard.press('Tab');
        await expect(status).toHaveText(at(order[4]!));
      }
      if (index < order.length - 1) await page.keyboard.press('Tab');
    }
    // The last cell centred and at the bottom, through the Table bar.
    await page.getByTestId('table-bar-td-align').selectOption('center');
    await page.getByTestId('table-bar-td-valign').selectOption('bottom');
    const table = newTableIn(await documentOf(page), tables);
    const last = table.content![2]!.content![2]!;
    expect(last.attrs).toMatchObject({ align: 'center', valign: 'bottom' });
    await caretAt(page, { nodeId: last.attrs!.nodeId!, offset: 2 });
    const before = await toXml(page);
    await page.keyboard.press('Tab');
    await expect(status).toHaveText(at('tr[4]/th[1]'));
    await expect.poll(() => toXml(page)).not.toBe(before);
    const after = await toXml(page);
    expect(after).toMatch(
      new RegExp(
        `<td align="center" valign="bottom">w9</td>\\s*</tr>\\s*<tr>\\s*<th(?:/>|></th>)\\s*<td(?:/>|></td>)\\s*<td align="center" valign="bottom"(?:/>|></td>)\\s*</tr>\\s*</table>`,
      ),
    );
    const grown = newTableIn(await documentOf(page), tables);
    expect(grown.content).toHaveLength(4);
    const first = grown.content![3]!.content![0]!;
    const caret = { nodeId: first.attrs!.nodeId!, offset: 0 };
    await expect.poll(() => bodySelection(page)).toEqual({ anchor: caret, head: caret });
    // Its own undo step: the typing before it stays (C33).
    await menu(page, 'edit', 'undo');
    await expect.poll(() => toXml(page)).toBe(before);
    await menu(page, 'edit', 'redo');
    await expect.poll(() => toXml(page)).toBe(after);

    // tables.fb2: the languages of the last row's cells (FR-005) ...
    await openFile(core, page, fixtureBook('tables.fb2'), { discard: true });
    let book = await documentOf(page);
    const languages = tableAfter(book, 'US2 sc.3 and its edge cases');
    await caretAt(page, { nodeId: languages.content![2]!.content![2]!.attrs!.nodeId!, offset: 4 });
    await page.keyboard.press('Tab');
    await expect
      .poll(async () => tableAfter(await documentOf(page), 'US2 sc.3').content!.length)
      .toBe(4);
    book = await documentOf(page);
    const added = tableAfter(book, 'US2 sc.3 and its edge cases').content![3]!;
    expect(added.content!.map((cell) => cell.type)).toEqual(['td', 'td', 'td']);
    expect(added.content!.map((cell) => cell.attrs?.lang ?? null)).toEqual([null, null, 'de']);

    // ... and a rowspan past the end crosses the new row (C15).
    const pastEnd = tableAfter(book, 'Case rowspan-past-end (US8 sc.2)');
    const c = pastEnd.content![1]!.content![0]!;
    expect(textOf(c)).toBe('c');
    await caretAt(page, { nodeId: c.attrs!.nodeId!, offset: 1 });
    await page.keyboard.press('Tab');
    await expect
      .poll(
        async () =>
          tableAfter(await documentOf(page), 'Case rowspan-past-end (US8').content!.length,
      )
      .toBe(3);
    const crossed = tableAfter(await documentOf(page), 'Case rowspan-past-end (US8 sc.2)');
    expect(crossed.content![2]!.content!.map((cell) => cell.type)).toEqual(['td']);
    expect(crossed.content![0]!.content![1]!.attrs?.rowspan).toBe(4);
    const tableRef = crossed.attrs!.nodeId!;
    expect(await page.evaluate((ref) => window.__mfbeTest!.tables!.grid(ref), tableRef)).toEqual({
      rows: 3,
      columns: 2,
      shortRows: 0,
      overlaps: 0,
      pastEnd: 1,
    });
  });

  test('Table… in the context menu follows FR-004, judged at the clicked point', async ({
    core,
    page,
  }) => {
    await openBook(core, page, PLACEMENT);
    const doc = await documentOf(page);
    const bodyTitle = blockStarting(doc, 'p', 'Table placement');
    await caretAt(page, { nodeId: bodyTitle.nodeId, offset: 2 });
    const caretInTitle = { nodeId: bodyTitle.nodeId, offset: 2 };
    const paragraph = 'A paragraph in the middle of section 1.';
    const entry = page.getByTestId('context-menu-insert.table');

    // Enabled for a click in a section's paragraph although the caret stands in the body's title.
    await rightClickAfterText(page, paragraph);
    await expect(entry).toBeVisible();
    await expect(entry).not.toHaveAttribute('aria-disabled');
    // Opening the menu moved nothing; Escape leaves the caret where it was (C28).
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('context-menu')).toHaveCount(0);
    await expect
      .poll(() => bodySelection(page))
      .toEqual({ anchor: caretInTitle, head: caretInTitle });

    // Running it moves the caret to the click and inserts the table at that paragraph.
    const before = await toXml(page);
    const tables = tableIds(doc);
    await rightClickAfterText(page, paragraph);
    await entry.click();
    await confirmTableDialog(page, { rows: 2, columns: 2 });
    await expect.poll(() => toXml(page)).not.toBe(before);
    expect(await toXml(page)).toMatch(
      new RegExp(`${esc(paragraph)}</p>\\s*${TABLE_2X2}\\s*<poem>`),
    );
    await expectCaretInFirstCell(page, newTableIn(await documentOf(page), tables));
    await menu(page, 'edit', 'undo');
    await expect.poll(() => toXml(page)).toBe(before);

    // Disabled, with its reason, for a click in the body's title.
    await blockElement(page, '.fb-body > .fb-title p', 'Table placement').click({
      button: 'right',
    });
    await expect(entry).toHaveAttribute('aria-disabled', 'true');
    await expect(entry).toHaveAttribute('title', await noTablePlaceTitle(page));
    await page.keyboard.press('Escape');
  });

  test('edge cases: a selection is kept and the table goes at its end; Enter in a cell changes nothing', async ({
    core,
    page,
  }) => {
    await openBook(core, page, PLACEMENT);
    const original = await toXml(page);
    const splitTag = /<p id="p-split"[^>]*>/.exec(original)![0];
    const secondTag = splitTag.replace(/\s+id="p-split"/, '');
    const doc = await documentOf(page);
    const first = blockStarting(doc, 'p', 'The paragraph at the start of section 1');
    const second = blockWhere(doc, (node) => node.attrs?.id === 'p-split', 'p-split');
    // From the middle of one paragraph to the middle of the next (decision 4).
    const selected = await page.evaluate(
      ([anchor, head]) => window.__mfbeTest!.scripts!.selectRange(anchor, head),
      [
        { nodeId: first.nodeId, offset: 10 },
        { nodeId: second.nodeId, offset: 11 },
      ] as const,
    );
    expect(selected).toBe(true);
    const tables = tableIds(doc);
    await addTable(page, { rows: 2, columns: 2 });
    await expect.poll(() => toXml(page)).not.toBe(original);
    const xml = await toXml(page);
    // The selected text is still there; the second paragraph split at the selection's end.
    expect(xml).toContain('<p>The paragraph at the start of section 1, with a note');
    expect(xml).toMatch(
      new RegExp(
        `${esc(splitTag)}A paragraph</p>\\s*${TABLE_2X2}\\s*${esc(secondTag)} with an id, a style`,
      ),
    );
    await expectCaretInFirstCell(page, newTableIn(await documentOf(page), tables));
    // Enter in a cell does nothing (`enterInCell`).
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    expect(await toXml(page)).toBe(xml);
  });

  /* ---------------------------------------------------------------------- */
  /* The Source view (T049)                                                 */
  /* ---------------------------------------------------------------------- */

  test('10. Add → Table in the Source view', async ({ core, page }) => {
    test.setTimeout(240_000);
    await core.rpc('settings.set', {
      patch: { session: { toolbarLayouts: { commands: ['insert.table'] } } },
    });
    await openBook(core, page, PLACEMENT);
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    const content = page.locator('.mfbe-source-editor .cm-content');
    const addTableEntry = page.getByTestId('menu-add-table');
    const button = page.getByTestId('toolbar-insert.table');
    const command = await pageText(page, 'cmd.insert.table.tooltip');
    const refusal = async (code: string, params: Record<string, string | number> = {}) =>
      pageText(page, 'commands.unavailable.title', {
        command,
        reason: await pageText(page, `tables.reason.source.${code}`, params),
      });
    /** The verdict at `offset` once the background parse reached the end of the text. */
    const settled = async (offset: number) => {
      await expect
        .poll(
          () => page.evaluate((at) => window.__mfbeTest!.sourceTable!.sweep([at])[0]!.code, offset),
          { timeout: 30_000 },
        )
        .not.toBe('analysing');
    };
    const cursorAt = async (offset: number) => {
      expect(
        await page.evaluate((at) => window.__mfbeTest!.sourceMapping!.select(at), offset),
      ).toBe(true);
      await settled(offset);
    };
    const sourceText = async () =>
      (await page.evaluate(() => window.__mfbeTest!.sourceMapping!.sourceText())) ?? '';
    const sourceSelection = () =>
      page.evaluate(() => window.__mfbeTest!.sourceMapping!.sourceSelection());
    const expectAddTable = async (title: string | null) => {
      await page.getByTestId('menu-add').click();
      if (title === null) {
        await expect(addTableEntry).not.toHaveAttribute('aria-disabled');
      } else {
        await expect(addTableEntry).toHaveAttribute('aria-disabled', 'true');
        await expect(addTableEntry).toHaveAttribute('title', title);
      }
      await page.keyboard.press('Escape');
      await expect(addTableEntry).toBeHidden();
    };
    /** Right-clicks at the cursor's place on the screen; the menu stays open. */
    const rightClickAtCursor = async () => {
      await content.focus();
      // CodeMirror draws the cursor where the selection is in its next measure cycle, an
      // animation frame: its place is read after two frames, never the place it had before.
      await page.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      const cursor = page.locator('.mfbe-source-editor .cm-cursor-primary').first();
      await expect(cursor).toBeAttached();
      const box = (await cursor.boundingBox())!;
      await page.mouse.click(box.x + 1, box.y + box.height / 2, { button: 'right' });
      await expect(page.getByTestId('source-context-menu')).toBeVisible();
    };

    // The cursor between </p> and <p> inside a section: the paragraph's text found, then End.
    const paragraphText = 'The paragraph at the start of section 1, with a note';
    await content.click();
    await page.keyboard.press(`${MOD}+Home`);
    await page.keyboard.press(`${MOD}+f`);
    await page.getByTestId('dialog-find-query').fill(paragraphText);
    await page.getByTestId('dialog-find-button-findNext').click();
    await page.getByTestId('dialog-find-button-cancel').click();
    await expect(page.getByTestId('dialog-find')).toHaveCount(0);
    await content.focus();
    await page.keyboard.press(LINE_END);
    const original = await sourceText();
    const lines = original.split('\n');
    const lineIndex = lines.findIndex((line) => line.includes(paragraphText));
    const paragraphLine = lines[lineIndex]!;
    expect(lines[lineIndex + 1]).toMatch(/^\s*<p id="p-split"/);
    const between = lines.slice(0, lineIndex + 1).join('\n').length;
    expect(await sourceSelection()).toEqual({ anchor: between, head: between });
    await settled(between);

    // Add → Table is the Source view's one Add command; Add → Binary Object… keeps its state.
    await expectAddTable(null);
    await page.getByTestId('menu-add').click();
    for (const id of [
      'title',
      'epigraph',
      'image',
      'inlineImage',
      'poem',
      'cite',
      'sectionImage',
    ]) {
      await expect(page.getByTestId(`menu-add-${id}`), id).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(page.getByTestId('menu-add-binary')).not.toHaveAttribute('aria-disabled');
    await page.keyboard.press('Escape');
    await expect(button).toBeEnabled();

    // 2 rows of 3 cells, laid out like the neighbours: a tab per level.
    await page.getByTestId('menu-add').click();
    await addTableEntry.click();
    await confirmTableDialog(page, { rows: 2, columns: 3 });
    await expect.poll(sourceText).not.toBe(original);
    const inserted = await sourceText();
    const indent = /^\s*/.exec(paragraphLine)![0];
    const row = [
      `${indent}\t<tr>`,
      `${indent}\t\t<td></td>`,
      `${indent}\t\t<td></td>`,
      `${indent}\t\t<td></td>`,
      `${indent}\t</tr>`,
    ];
    const block = [`${indent}<table>`, ...row, ...row, `${indent}</table>`];
    const after = inserted.split('\n');
    expect(after.slice(lineIndex, lineIndex + block.length + 2)).toEqual([
      paragraphLine,
      ...block,
      lines[lineIndex + 1],
    ]);
    const firstCell = inserted.indexOf('<td>', between) + '<td>'.length;
    expect(await sourceSelection()).toEqual({ anchor: firstCell, head: firstCell });
    // Typing lands in the first cell; the insertion is one undo step of its own.
    await page.keyboard.type('X');
    await expect
      .poll(sourceText)
      .toBe(`${inserted.slice(0, firstCell)}X${inserted.slice(firstCell)}`);
    await menu(page, 'edit', 'undo');
    await expect.poll(sourceText).toBe(inserted);
    await menu(page, 'edit', 'undo');
    await expect.poll(sourceText).toBe(original);
    await menu(page, 'edit', 'redo');
    await expect.poll(sourceText).toBe(inserted);

    // The Body view: the 2 × 3 table after that paragraph, the caret in its first cell.
    await page.getByTestId('view-body').click();
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    const body = await documentOf(page);
    const table = tableAfter(body, paragraphText);
    expect(table.content!.map((tr) => tr.content!.map((cell) => cell.type))).toEqual([
      ['td', 'td', 'td'],
      ['td', 'td', 'td'],
    ]);
    const cell = { nodeId: table.content![0]!.content![0]!.attrs!.nodeId!, offset: 0 };
    await expect.poll(() => bodySelection(page)).toEqual({ anchor: cell, head: cell });
    expect(await liveErrors(core, page)).toBe(0);
    // ... and back: the cursor between the first <td> and </td> (quickstart §12).
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    await expect
      .poll(async () => {
        const text = await sourceText();
        const at = text.indexOf('<td>', text.indexOf(paragraphText)) + '<td>'.length;
        const selection = await sourceSelection();
        return selection && selection.anchor === at && selection.head === at;
      })
      .toBe(true);

    // The refusals, each with its reason (FR-061 "Unavailable").
    const text = await sourceText();
    const inText = text.indexOf(paragraphText) + 4;
    await cursorAt(inText);
    await expectAddTable(await refusal('inText'));
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', await refusal('inText'));
    await cursorAt(text.indexOf('<p id="p-split"') + 4);
    await expectAddTable(await refusal('inTag'));
    const section2 = text.indexOf('Section 2: a heading part and content');
    const afterTitle = text.indexOf('</title>', section2) + '</title>'.length;
    expect(text.slice(afterTitle).trimStart().startsWith('<epigraph>')).toBe(true);
    await cursorAt(afterTitle);
    await expectAddTable(await refusal('notAllowed', { element: 'section' }));

    // Alt+T at a refused point opens no dialog and is not consumed: Alt+T opens Tools in
    // English, no menu in Russian and Ukrainian; between two paragraphs it opens the dialog.
    await cursorAt(inText);
    await content.focus();
    await page.keyboard.press('Alt+t');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('dialog-table')).toHaveCount(0);
    if ((await page.locator('html').getAttribute('lang')) === 'en') {
      await expect(page.getByTestId('menu-tools-popup')).toBeVisible();
    }
    await page.keyboard.press('Escape');
    const gap = text.indexOf('<p id="p-split"');
    const betweenNow = text.lastIndexOf('</p>', gap) + '</p>'.length;
    await cursorAt(betweenNow);
    await content.focus();
    await page.keyboard.press('Alt+t');
    await expect(page.getByTestId('dialog-table')).toBeVisible();
    await page.getByTestId('dialog-table-button-cancel').click();
    await expect(button).toBeEnabled();

    // Table… in the Source context menu, judged at the clicked point; opening it moves nothing.
    await cursorAt(betweenNow);
    await rightClickAtCursor();
    const sourceEntry = page.getByTestId('source-context-menu-insert.table');
    await expect(sourceEntry).not.toHaveAttribute('aria-disabled');
    const order = await page
      .getByTestId('source-context-menu')
      .locator('[role="menuitem"]')
      .evaluateAll((items) =>
        items.map((item) => (item as unknown as { dataset: { testid?: string } }).dataset.testid),
      );
    expect(order.indexOf('source-context-menu-insert.table')).toBe(
      order.indexOf('source-context-menu-selectAll') + 1,
    );
    await page.keyboard.press('Escape');
    await cursorAt(inText);
    await rightClickAtCursor();
    await expect(sourceEntry).toHaveAttribute('aria-disabled', 'true');
    await expect(sourceEntry).toHaveAttribute('title', await refusal('inText'));
    expect(await sourceSelection()).toEqual({ anchor: inText, head: inText });
    await page.keyboard.press('Escape');

    // A broken closing tag: notWellFormed with the line of the first problem; repaired, the
    // command is available again (U5).
    const notWellFormed = (line: number) => refusal('notWellFormed', { line });
    const brokenAt = text.indexOf('</p>', text.indexOf('A paragraph in the middle of section 1.'));
    const brokenLine = text.slice(0, brokenAt).split('\n').length;
    await page.evaluate(
      (at) => window.__mfbeTest!.sourceMapping!.select(at, at + 1),
      brokenAt + '</p'.length,
    );
    await content.focus();
    await page.keyboard.press('Delete');
    await expect.poll(sourceText).not.toBe(text);
    await cursorAt(betweenNow);
    await page.getByTestId('menu-add').click();
    await expect(addTableEntry).toHaveAttribute('aria-disabled', 'true');
    // The broken tag's own line, although the parser notices the problem only at the next tag.
    await expect(addTableEntry).toHaveAttribute('title', await notWellFormed(brokenLine));
    await page.keyboard.press('Escape');
    expect(
      await page.evaluate(
        (at) => window.__mfbeTest!.sourceMapping!.select(at),
        brokenAt + '</p'.length,
      ),
    ).toBe(true);
    await content.focus();
    await page.keyboard.type('>');
    await expect.poll(sourceText).toBe(text);
    await cursorAt(betweenNow);
    await expectAddTable(null);

    // A malformed book opens in the Source view alone: unavailable before the first edit.
    await core.enqueueDialog('dialog.openFile', { paths: [fixtureBook('malformed.fb2')] });
    await menu(page, 'file', 'open');
    const discard = page.getByTestId('dialog-save-changes-button-no');
    const parseError = page.getByTestId('dialog-parse-error-button-ok');
    await expect(discard.or(parseError)).toBeVisible();
    if (await discard.isVisible()) await discard.click();
    await parseError.click();
    await waitForBook(page, fixtureBook('malformed.fb2'));
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    const malformed = await sourceText();
    await cursorAt(malformed.indexOf('<section>') + '<section>'.length);
    const pattern = esc(await notWellFormed(987654)).replace('987654', '\\d+');
    await page.getByTestId('menu-add').click();
    await expect(addTableEntry).toHaveAttribute('aria-disabled', 'true');
    await expect(addTableEntry).toHaveAttribute('title', new RegExp(`^${pattern}$`));
    await page.keyboard.press('Escape');
  });
});
