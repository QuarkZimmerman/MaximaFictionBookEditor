/**
 * Feature 006, User Story 8 - Irregular tables are marked (T123; spec FR-057, FR-058, FR-062;
 * US8 sc.7 to sc.11; SC-011; U2, U4, U23, U33, U38; C52, C54, C58, C59, C61, C78; decision 8;
 * research R3.6 to R3.8, R6.1 to R6.5; quickstart §8 "Automated"). Every irregular table carries
 * the editor's warning badge at its top-right corner in the Body view - never saved, copied or
 * selected, moving no table, in the Validation panel's warning style -, with a tooltip naming its
 * problems; a click opens a small popover with *Repair table*, which repairs that table in one
 * step and is disabled while a script runs. The Document Tree marks the table's entry, or the
 * entry that contains a table without one (decision 8: the source book's annotation has none).
 * The mark follows every change - the Source view, a script, the assistant - and File → Validate
 * lists each irregular table as the warning `table.irregular`, which goes to its table and never
 * blocks saving.
 *
 * The texts are built from the vectors' params with `uiText(lang, …)` in the language the page
 * shows, so the journey asserts the same texts in English, Russian and Ukrainian (it also runs
 * in `chromium-ru` and `chromium-uk`, `playwright.config.ts`): the problems
 * `tables.problem.shortRow` (one short row) or `.shortRows` (two or more), then `.overlaps` and
 * `.pastEnd`, joined by `tables.problem.separator`; the name `validation.table.irregular`, or
 * `.irregularNamed` for a table with an id (C61); the tooltip the problems with a capital first
 * letter - the name for a named table -, `. ` and `tables.mark.repairHint` (data-model §3.2).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode. The book is `tests/fixtures/books/tables.fb2` (whole-book mode, every table
 * mounted), whose irregular tables are the vectors' irregular cases with `fixture:
 * "tables.fb2"` (T012), each after a paragraph `Case <name> (<spec>)`; the Body view shows all
 * of them but `plural-forms`, which stands in the source book's annotation (US10 marks it in
 * its Description field). The scripts of `tests/scripts/fixtures/06_Runs` and `07_Tables` are
 * copied into the worker's data folder, and the assistant talks to the loopback stand-in.
 *
 * User story 10 (T155; quickstart §10: "also in `us8-table-marks`") adds the marks of the
 * Description view's fields, in the same three languages: the book annotation's
 * `overlap-from-two-rows-above` with its popover - *Repair table* and Undo, Escape and an outside
 * mousedown, the field's caret kept, and *Repair table* disabled while a request to the
 * assistant's stand-in waits (the run lock a request in the Description view holds; a script run
 * switches to the Body view) - and `plural-forms` in the source book's annotation, its only
 * place.
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import type { JsonValue } from './fixtures/ai-standin.mjs';
import {
  ensureAssistantOn,
  expect,
  fixtureBook,
  test,
  waitForBook,
  type CoreHandle,
} from './fixtures/core';
import { pageAnyPattern, pageLang, uiText, type UiLang } from './fixtures/i18n';
import { MOD } from './fixtures/keys';

/* ------------------------------------------------------------------------ */
/* The model JSON and the page's hooks                                      */
/* ------------------------------------------------------------------------ */

interface Json {
  type: string;
  attrs?: Record<string, unknown> & { nodeId?: string; id?: string };
  content?: Json[];
  text?: string;
}

interface DocJson {
  docId: string;
  bodies: Json[];
  description: {
    titleInfo: { annotation?: Json };
    srcTitleInfo?: { annotation?: Json };
    documentInfo: { history?: Json };
  };
}

interface ModelPoint {
  nodeId: string;
  offset: number;
}

interface LastRequest {
  id: string;
  state: string;
  changes: number;
}

declare const window: {
  __mfbeTest?: {
    scripts?: {
      document(): DocJson;
      toXml(): Promise<string>;
      select(nodeId: string, from?: number, to?: number): boolean;
      list(): { id: string }[];
      run(id: string): Promise<{ status: string }>;
    };
    sourceMapping?: {
      bodySelection(): { anchor: ModelPoint; head: ModelPoint } | null;
      sourceSelection(): { anchor: number; head: number } | null;
      select(anchor: number, head?: number): boolean;
      sourceText(): string | null;
    };
    tables?: { grid(tableRef: string): unknown; target(): { selection: unknown } | null };
    ai?: { lastRequest(): LastRequest | null };
  };
};

/* ------------------------------------------------------------------------ */
/* The shared vectors and the texts                                         */
/* ------------------------------------------------------------------------ */

interface Params {
  rows: number;
  columns: number;
  shortRows: number;
  row?: number;
  covered?: number;
  overlaps: number;
  pastEnd: number;
  id?: string;
}

interface VectorCell {
  type?: string;
  attrs?: Record<string, unknown>;
}

interface VectorCase {
  name: string;
  fixture?: string;
  expect: {
    regular: boolean;
    params: Params;
    repaired?: { attrs?: Record<string, unknown>; rows: (VectorCell[] | { type: string })[] };
  };
}

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const vectors = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'tables', 'grid-vectors.json'), 'utf8'),
) as { cases: VectorCase[] };
const RUNS_FIXTURES = path.join(REPO_ROOT, 'tests', 'scripts', 'fixtures', '06_Runs');
const TABLES_FIXTURES = path.join(REPO_ROOT, 'tests', 'scripts', 'fixtures', '07_Tables');

/** The irregular vector cases written into `tables.fb2` (T012), 13 of them. */
const IRREGULAR = vectors.cases.filter(
  (one) => one.fixture === 'tables.fb2' && !one.expect.regular,
);
/** The source book's annotation holds this one: the Body view and the tree never show it. */
const SOURCE_BOOK_CASE = 'plural-forms';
/** The irregular cases the Body view shows. */
const SHOWN = IRREGULAR.filter((one) => one.name !== SOURCE_BOOK_CASE);

function params(name: string): Params {
  const found = vectors.cases.find((one) => one.name === name);
  if (!found) throw new Error(`no vector case ${name}`);
  return found.expect.params;
}

/** The problems of a table, as data-model §3.2 tells them. */
function problemParts(lang: UiLang, p: Params): string[] {
  const parts: string[] = [];
  if (p.shortRows === 1) {
    parts.push(
      uiText(lang, 'tables.problem.shortRow', {
        row: p.row!,
        covered: p.covered!,
        columns: p.columns,
        count: p.columns,
      }),
    );
  } else if (p.shortRows >= 2) {
    parts.push(
      uiText(lang, 'tables.problem.shortRows', { count: p.shortRows, columns: p.columns }),
    );
  }
  if (p.overlaps >= 1) parts.push(uiText(lang, 'tables.problem.overlaps', { count: p.overlaps }));
  if (p.pastEnd >= 1) parts.push(uiText(lang, 'tables.problem.pastEnd', { count: p.pastEnd }));
  return parts;
}

function problemsText(lang: UiLang, p: Params): string {
  return problemParts(lang, p).join(uiText(lang, 'tables.problem.separator'));
}

/** The mark's name, which is also the Validation panel's text (C61). */
function markName(lang: UiLang, p: Params): string {
  const problems = problemsText(lang, p);
  return p.id
    ? uiText(lang, 'validation.table.irregularNamed', { id: p.id, problems })
    : uiText(lang, 'validation.table.irregular', { problems });
}

/** The mark's tooltip: the problems with a capital first letter (the name when named), the hint. */
function markTooltip(lang: UiLang, p: Params): string {
  const problems = problemsText(lang, p);
  const head = p.id
    ? markName(lang, p)
    : problems.charAt(0).toLocaleUpperCase(lang) + problems.slice(1);
  return `${head}. ${uiText(lang, 'tables.mark.repairHint')}`;
}

/** The tooltip of an entry that contains the table (decision 8). */
function containsText(lang: UiLang, p: Params): string {
  const problems = problemsText(lang, p);
  return p.id
    ? uiText(lang, 'tables.mark.containsNamed', { id: p.id, problems })
    : uiText(lang, 'tables.mark.contains', { problems });
}

/* ------------------------------------------------------------------------ */
/* The document                                                             */
/* ------------------------------------------------------------------------ */

const TABLES = fixtureBook('tables.fb2');
/** The user story 8 scenario table (T014) and the user story 7 4 × 3 table. */
const US8 = 'US8 sc.5, sc.6';
const US7 = 'US7 sc.1 to sc.4, manual step 7';
/** Hosted CI runners against a 2020-era laptop (docs/performance.md). */
const PERF_FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 2) || 2;
/** SC-011: the mark goes within the interaction budget of a table command. */
const MARK_BUDGET_MS = 100;

function documentOf(page: Page): Promise<DocJson> {
  return page.evaluate(() => window.__mfbeTest!.scripts!.document());
}

function toXml(page: Page): Promise<string> {
  return page.evaluate(() => window.__mfbeTest!.scripts!.toXml());
}

function textOf(node: Json): string {
  return (node.content ?? [])
    .map((child) => (child.type === 'text' ? (child.text ?? '') : textOf(child)))
    .join('');
}

/** Every node below `node`, in document order, with its parent. */
function* walk(node: Json): Generator<{ node: Json; parent: Json; index: number }> {
  const children = node.content ?? [];
  for (let index = 0; index < children.length; index += 1) {
    yield { node: children[index]!, parent: node, index };
    yield* walk(children[index]!);
  }
}

function trees(doc: DocJson): Json[] {
  return [
    ...doc.bodies,
    doc.description.titleInfo.annotation,
    doc.description.srcTitleInfo?.annotation,
    doc.description.documentInfo.history,
  ].filter((tree): tree is Json => !!tree);
}

/** A table of the model with its parent: the one after the paragraph that starts with `prefix`. */
function locateAfter(doc: DocJson, prefix: string): { table: Json; parent: Json } {
  for (const tree of trees(doc)) {
    for (const { node, parent, index } of walk(tree)) {
      if (node.type === 'p' && textOf(node).startsWith(prefix)) {
        const next = parent.content?.[index + 1];
        if (next?.type === 'table') return { table: next, parent };
      }
    }
  }
  throw new Error(`no table after the paragraph "${prefix}…"`);
}

function caseTable(doc: DocJson, name: string): Json {
  return locateAfter(doc, `Case ${name} (`).table;
}

function cellRows(table: Json): Json[][] {
  return (table.content ?? [])
    .filter((row) => row.type === 'tr')
    .map((row) => (row.content ?? []).filter((cell) => cell.type === 'td' || cell.type === 'th'));
}

function firstCell(table: Json): Json {
  return cellRows(table)[0]![0]!;
}

function cellOf(table: Json, text: string): Json {
  for (const row of cellRows(table)) {
    for (const cell of row) if (textOf(cell) === text) return cell;
  }
  throw new Error(`no cell "${text}"`);
}

/** A table as the vectors compare it: types other than `td`, set attributes, no node ids. */
function shape(table: { attrs?: Record<string, unknown>; content?: Json[] }): unknown {
  const clean = (attrs: Record<string, unknown> | undefined) => {
    const out = Object.fromEntries(
      Object.entries(attrs ?? {}).filter(([key, value]) => key !== 'nodeId' && value != null),
    );
    return Object.keys(out).length > 0 ? out : undefined;
  };
  return {
    attrs: clean(table.attrs),
    rows: (table.content ?? []).map((row) =>
      (row.content ?? []).map((cell) => ({
        type: cell.type === 'td' ? undefined : cell.type,
        attrs: clean(cell.attrs),
      })),
    ),
  };
}

function vectorShape(table: NonNullable<VectorCase['expect']['repaired']>): unknown {
  const clean = (attrs: Record<string, unknown> | undefined) =>
    attrs && Object.keys(attrs).length > 0 ? attrs : undefined;
  return {
    attrs: clean(table.attrs),
    rows: table.rows.map((row) =>
      (row as VectorCell[]).map((cell) => ({
        type: cell.type && cell.type !== 'td' ? cell.type : undefined,
        attrs: clean(cell.attrs),
      })),
    ),
  };
}

/* ------------------------------------------------------------------------ */
/* Page helpers                                                             */
/* ------------------------------------------------------------------------ */

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

async function hooksReady(page: Page): Promise<void> {
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
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

async function openFile(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await menu(page, 'file', 'open');
  await waitForBook(page, file);
  await hooksReady(page);
}

async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.openApp(page);
  await openFile(core, page, file);
}

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

async function caretIn(page: Page, nodeId: string, offset = 0): Promise<void> {
  const placed = await page.evaluate(([id, at]) => window.__mfbeTest!.scripts!.select(id, at, at), [
    nodeId,
    offset,
  ] as const);
  expect(placed, `the caret in ${nodeId}`).toBe(true);
}

async function bodySelection(page: Page) {
  return page.evaluate(() => window.__mfbeTest!.sourceMapping!.bodySelection());
}

function tableElement(page: Page, ref: string): Locator {
  return page.locator(`[data-testid="body-table"][data-node-id="${ref}"]`);
}

/** The `body-table` of the case `name`, with its model. */
async function caseElement(page: Page, name: string): Promise<{ ref: string; element: Locator }> {
  const ref = caseTable(await documentOf(page), name).attrs!.nodeId!;
  const element = tableElement(page, ref);
  await expect(element, `the table of ${name}`).toHaveCount(1);
  return { ref, element };
}

/** The `body-table` after the paragraph `label`, looked up afresh in the model. */
async function labelledTable(page: Page, label: string): Promise<{ ref: string; table: Json }> {
  const { table } = locateAfter(await documentOf(page), label);
  return { ref: table.attrs!.nodeId!, table };
}

/** The `data-node-id` of every marked table of the Body view. */
function markedRefs(page: Page): Promise<(string | null)[]> {
  return page
    .locator('[data-testid="body-table"][data-irregular="true"]')
    .evaluateAll((elements) =>
      elements.map((element) =>
        (element as unknown as { getAttribute(name: string): string | null }).getAttribute(
          'data-node-id',
        ),
      ),
    );
}

/** The entry of *Edit → Table structure* for the command `commandId`, its submenu open. */
async function structureEntry(page: Page, commandId: string): Promise<Locator> {
  await page.getByTestId('menu-edit').click();
  await page.getByTestId('menu-edit-tableStructure').click();
  await expect(page.getByTestId('menu-edit-tableStructure-popup')).toBeVisible();
  return page.getByTestId(
    `menu-edit-tableStructure-${commandId.slice(commandId.indexOf('.') + 1)}`,
  );
}

async function closeMenus(page: Page, popup: string): Promise<void> {
  await expect(async () => {
    if ((await page.getByTestId(popup).count()) > 0) await page.keyboard.press('Escape');
    expect(await page.getByTestId(popup).count()).toBe(0);
  }).toPass({ timeout: 5_000 });
}

/** Two animation frames: the page has painted what the last step changed. */
async function painted(page: Page): Promise<void> {
  await page.evaluate(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
}

/**
 * Scrolls the tree's virtual list to the top, or one page further down, and resolves once its
 * rows are rendered for that position (`us5-tree.spec.ts`); whether the list moved.
 */
async function scrollTree(page: Page, to: 'top' | 'nextPage'): Promise<boolean> {
  return page.evaluate<boolean>(`(async () => {
    const element = document.querySelector('[data-testid="tree-content"]');
    const before = element.scrollTop;
    element.scrollTop = ${to === 'top' ? '0' : 'before + Math.max(100, element.clientHeight - 44)'};
    const target = element.scrollTop;
    const rendered = () => {
      const rows = [...element.querySelectorAll('[data-testid^="tree-row-"][role="treeitem"]')];
      if (rows.length === 0) return false;
      const tops = rows.map((row) => parseFloat(row.style.top));
      const height = parseFloat(rows[0].style.height) || 22;
      const bottom = Math.min(target + element.clientHeight, element.scrollHeight);
      return Math.min(...tops) <= target && Math.max(...tops) + 2 * height >= bottom;
    };
    for (let frame = 0; frame < 60 && !rendered(); frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
    return target !== before;
  })()`);
}

interface TreeMark {
  title: string | null;
  label: string | null;
  role: string | null;
}

/** Every row of the tree with `data-irregular="true"` and its mark, from top to bottom. */
async function irregularTreeRows(page: Page): Promise<Map<string, TreeMark>> {
  const found = new Map<string, TreeMark>();
  const collect = () =>
    page.evaluate<[string, TreeMark][]>(`(() => {
      const rows = document.querySelectorAll(
        '[data-testid="tree-content"] [data-testid^="tree-row-"][role="treeitem"][data-irregular="true"]');
      return [...rows].map((row) => {
        const id = row.getAttribute('data-testid');
        const mark = row.querySelector('[data-testid="' + id + '-mark"]');
        return [id, {
          title: mark ? mark.getAttribute('title') : null,
          label: mark ? mark.getAttribute('aria-label') : null,
          role: mark ? mark.getAttribute('role') : null,
        }];
      });
    })()`);
  await scrollTree(page, 'top');
  for (let page_ = 0; page_ < 200; page_ += 1) {
    for (const [id, mark] of await collect()) found.set(id, mark);
    if (!(await scrollTree(page, 'nextPage'))) break;
  }
  return found;
}

/** The tree row `tree-row-<id>`, scrolled into the rendered band; null when no row has it. */
async function treeRow(page: Page, id: string): Promise<Locator | null> {
  const row = page.getByTestId(`tree-row-${id}`);
  await scrollTree(page, 'top');
  for (let step = 0; step < 200; step += 1) {
    if ((await row.count()) > 0) return row;
    if (!(await scrollTree(page, 'nextPage'))) break;
  }
  return null;
}

/** Validate (F8) with the focus in the page; resolves once the panel lists its issues. */
async function validate(page: Page): Promise<void> {
  await page.keyboard.press('F8');
  await expect(page.getByTestId('validation-panel')).toBeVisible();
  await expect(page.locator('[data-testid^="validation-issue-"]').first()).toBeVisible();
}

/** The Validation panel's rows of the code `table.irregular`. */
function warningRows(page: Page): Locator {
  return page.locator('[data-testid^="validation-issue-"][data-code="table.irregular"]');
}

/** The offset of the first non-blank character of the 1-based `line` of `text`. */
function lineStart(text: string, line: number): number {
  let offset = 0;
  for (let at = 1; at < line; at += 1) offset = text.indexOf('\n', offset) + 1;
  return offset;
}

/* ------------------------------------------------------------------------ */
/* The assistant (the helpers of us4-ai-validity.spec.ts)                    */
/* ------------------------------------------------------------------------ */

const lastRequest = (page: Page) =>
  page.evaluate<LastRequest | null>('window.__mfbeTest.ai.lastRequest()');
const lastRequestId = async (page: Page) => (await lastRequest(page))?.id ?? null;

async function sendAndWait(page: Page, instruction: string, timeout = 30_000) {
  const before = await lastRequestId(page);
  await page.getByTestId('ai-input').fill(instruction);
  await page.getByTestId('ai-input').press('Enter');
  await expect.poll(() => lastRequestId(page), { timeout }).not.toBe(before);
  await expect(page.getByTestId('ai-send')).toBeVisible({ timeout });
  await expect(page.getByTestId('script-run-banner')).toHaveCount(0, { timeout });
  return (await lastRequest(page))!;
}

type Args = { [member: string]: JsonValue | undefined };

const toolCall = (id: string, name: string, args: Args) => ({
  toolCalls: [{ id, name, arguments: args }],
});

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('US8 (feature 006) - irregular tables are marked, in the Body view, the tree and Validate', () => {
  let dir: string;

  test.beforeAll(({ coreServer }) => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us8-marks-'));
    if (!coreServer.hasCore || !coreServer.dataDir) return;
    for (const [source, name] of [
      [RUNS_FIXTURES, '06_Runs'],
      [TABLES_FIXTURES, '07_Tables'],
    ] as const) {
      const target = path.join(coreServer.dataDir, 'scripts', name);
      if (!existsSync(target)) cpSync(source, target, { recursive: true });
    }
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    // Before the page loads: the AI panel hidden, so the views have their full width, and
    // Restore position off - every save and every open records the caret of the book that
    // leaves (feature 004 US8), and an open puts the remembered caret back once the core has
    // answered, after the journey placed its own (the journeys reopen tables.fb2).
    await core.rpc('settings.set', {
      patch: { session: { aiPanelVisible: false }, other: { restorePosition: false } },
    });
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    // The look sets the theme, sc.7 Fast Mode and sc.10 the assistant's mode in the worker's
    // shared core: a `null` member returns to its default (`core/src/settings/settings.cpp`).
    await core
      .rpc('settings.set', {
        patch: {
          view: { theme: null, fastMode: null },
          ai: null,
          session: { aiPanelVisible: null },
          other: { restorePosition: null },
        },
      })
      .catch(() => {});
  });

  test('sc.8: every irregular table of the Body view, and no regular one, carries one mark with its name and tooltip; the caption moves no table; the tree marks the table entries and the entries that contain one', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page, TABLES);
    const lang = await pageLang(page);
    const doc = await documentOf(page);
    const refs = new Map(SHOWN.map((one) => [one.name, caseTable(doc, one.name).attrs!.nodeId!]));
    expect(refs.size).toBe(12);
    // Exactly the irregular cases the Body view shows; one mark each, none elsewhere.
    await expect
      .poll(async () => (await markedRefs(page)).sort())
      .toEqual([...refs.values()].sort());
    await expect(page.getByTestId('body-table-mark')).toHaveCount(refs.size);
    for (const one of SHOWN) {
      const element = tableElement(page, refs.get(one.name)!);
      const mark = element.getByTestId('body-table-mark');
      await expect(mark, one.name).toHaveCount(1);
      await expect(mark, one.name).toHaveAttribute('role', 'img');
      await expect(mark, one.name).toHaveAttribute('aria-label', markName(lang, one.expect.params));
      await expect(mark, one.name).toHaveAttribute('title', markTooltip(lang, one.expect.params));
      // R6 probe P8: the zero-height caption leaves the table's box as it is.
      const boxes = await page.evaluate<number[][]>(`((ref) => {
        const table = document.querySelector('[data-testid="body-table"][data-node-id="' + ref + '"]');
        const caption = table.querySelector('caption');
        const shown = table.getBoundingClientRect();
        caption.style.display = 'none';
        const hidden = table.getBoundingClientRect();
        caption.style.display = '';
        return [shown, hidden].map((r) => [r.x, r.y, r.width, r.height]);
      })(${JSON.stringify(refs.get(one.name))})`);
      boxes[0]!.forEach((value, index) => {
        expect(Math.abs(value - boxes[1]![index]!), `${one.name}: box ${index}`).toBeLessThan(0.01);
      });
    }
    // US8 sc.1's table is named: the named variant (C61).
    await expect(
      tableElement(page, refs.get('short-row')!).getByTestId('body-table-mark'),
    ).toHaveAttribute('aria-label', markName(lang, params('short-row')));
    expect(params('short-row').id).toBe('t2');

    // The Document Tree: the rows of the irregular tables that stand directly in sections, and
    // the containing entries of decision 8 - the Annotation and History blocks, the second cite,
    // the second section annotation -; nothing for the source book's annotation (C58).
    // A table's own row: the Body mark's name and tooltip; a containing entry: its lines as both.
    const expected = new Map<string, { title: string; label: string }>();
    const contains = (p: Params) => ({
      title: containsText(lang, p),
      label: containsText(lang, p),
    });
    const blocks = new Set([
      doc.description.titleInfo.annotation,
      doc.description.documentInfo.history,
    ]);
    for (const one of SHOWN) {
      const { table, parent } = locateAfter(doc, `Case ${one.name} (`);
      const ref = table.attrs!.nodeId!;
      if (parent.type === 'section') {
        expected.set(`tree-row-${ref}`, {
          title: markTooltip(lang, one.expect.params),
          label: markName(lang, one.expect.params),
        });
      } else if (!blocks.has(parent)) {
        // A cite's or a section annotation's table: its entry contains it.
        expect(['cite', 'annotation'], one.name).toContain(parent.type);
        expected.set(`tree-row-${parent.attrs!.nodeId!}`, contains(one.expect.params));
      }
    }
    expected.set('tree-row-desc:annotation', contains(params('overlap-from-two-rows-above')));
    expected.set('tree-row-desc:history', contains(params('three-problems')));
    expect(expected.size).toBe(12);
    await page.getByTestId('tree-content').focus();
    await page.keyboard.press('*');
    const rows = await irregularTreeRows(page);
    expect([...rows.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [id, texts] of expected) {
      expect(rows.get(id), id).toEqual({ ...texts, role: 'img' });
    }
  });

  test('the look, light and dark: the badge of the Validation panel’s warning, the on-accent "!", the ring in the Body background; it hides no cell text, adds no scroll bar and covers nothing above the table', async ({
    core,
    page,
  }) => {
    test.setTimeout(180_000);
    for (const theme of ['light', 'dark'] as const) {
      await core.rpc('settings.set', { patch: { view: { theme } } });
      await openBook(core, page, TABLES);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.getByTestId('body-editor').focus();
      await validate(page);
      const styles = await page.evaluate<Record<string, Record<string, string>>>(`(() => {
        const names = ['width', 'height', 'border-radius', 'background-color', 'color',
          'font-size', 'font-weight', 'font-family', 'line-height'];
        const read = (element) => {
          const style = getComputedStyle(element);
          return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]));
        };
        const badge = document.querySelector('[data-testid="body-table-mark"] .mfbe-table-mark-badge');
        const icon = document.querySelector('.mfbe-validation-icon-warning');
        return {
          badge: read(badge),
          icon: read(icon),
          extra: {
            shadow: getComputedStyle(badge).boxShadow,
            body: getComputedStyle(document.querySelector('.mfbe-view-body')).backgroundColor,
          },
        };
      })()`);
      expect(styles.badge, theme).toEqual(styles.icon);
      expect(styles.badge!.color, theme).toBe(
        theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(22, 22, 22)',
      );
      // The 1 px ring in the Body background (U33).
      expect(styles.extra!.shadow, theme).toContain(styles.extra!.body!);
      expect(styles.extra!.shadow, theme).toContain('1px');
    }

    // C54, in the dark theme still open: a long word aligned right in short-row's top-right
    // cell, and the badge misses that cell's content box.
    const shortRow = await labelledTable(page, 'Case short-row (');
    const c = cellOf(shortRow.table, 'c').attrs!.nodeId!;
    await page.getByTestId('body-editor').focus();
    await caretIn(page, c, 1);
    await page.keyboard.type('Pneumonoultramicroscopic');
    await expect(page.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'true');
    await page.getByTestId('table-bar-td-align').selectOption('right');
    await expect(tableElement(page, shortRow.ref).locator(`[data-node-id="${c}"]`)).toHaveAttribute(
      'align',
      'right',
    );
    await painted(page);
    const MEASURE = `((ref, cellId) => {
      const table = document.querySelector('[data-testid="body-table"][data-node-id="' + ref + '"]');
      const badge = table.querySelector('.mfbe-table-mark-badge').getBoundingClientRect();
      const cell = table.querySelector('[data-node-id="' + cellId + '"]');
      const box = cell.getBoundingClientRect();
      const style = getComputedStyle(cell);
      const px = (name) => parseFloat(style.getPropertyValue(name)) || 0;
      const content = {
        left: box.left + px('border-left-width') + px('padding-left'),
        right: box.right - px('border-right-width') - px('padding-right'),
        top: box.top + px('border-top-width') + px('padding-top'),
        bottom: box.bottom - px('border-bottom-width') - px('padding-bottom'),
      };
      let before = table.previousElementSibling;
      const above = before ? before.getBoundingClientRect().bottom : -Infinity;
      const scroller = document.querySelector('[data-testid="body-view"]').closest('.mfbe-view-content');
      return {
        badge: { left: badge.left, right: badge.right, top: badge.top, bottom: badge.bottom },
        content,
        above,
        table: table.getBoundingClientRect().width,
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
      };
    })`;
    type Measured = {
      badge: { left: number; right: number; top: number; bottom: number };
      content: { left: number; right: number; top: number; bottom: number };
      above: number;
      table: number;
      scrollWidth: number;
      clientWidth: number;
    };
    const measure = (cellId: string) =>
      page.evaluate<Measured>(
        `${MEASURE}(${JSON.stringify(shortRow.ref)}, ${JSON.stringify(cellId)})`,
      );
    const first = await measure(c);
    const meets =
      first.badge.left < first.content.right &&
      first.badge.right > first.content.left &&
      first.badge.top < first.content.bottom &&
      first.badge.bottom > first.content.top;
    expect(
      meets,
      `the badge ${JSON.stringify(first.badge)} misses ${JSON.stringify(first.content)}`,
    ).toBe(false);
    // The badge covers nothing of the paragraph before the table.
    expect(first.badge.top).toBeGreaterThanOrEqual(first.above - 0.5);
    // A long sentence makes the table fill the text area: the mark adds no scroll bar (C54).
    const e = cellOf(shortRow.table, 'e').attrs!.nodeId!;
    await caretIn(page, e, 1);
    await page.keyboard.type(
      ' is a cell that holds a long sentence, long enough that the table fills the whole width of the text area and its words wrap over several lines.',
    );
    await painted(page);
    const wide = await measure(e);
    expect(wide.table).toBeGreaterThan(first.table);
    expect(wide.scrollWidth).toBeLessThanOrEqual(wide.clientWidth);
  });

  test('sc.7: the mark is never copied or saved, and Fast Mode shows it', async ({
    core,
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openBook(core, page, TABLES);
    const lang = await pageLang(page);
    await expect(page.getByTestId('body-table-mark')).toHaveCount(SHOWN.length);
    await page.getByTestId('body-editor').focus();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.press(`${MOD}+c`);
    const copied = await page.evaluate<{ html: string; text: string }>(`(async () => {
      const out = { html: '', text: '' };
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes('text/html')) out.html += await (await item.getType('text/html')).text();
        if (item.types.includes('text/plain')) out.text += await (await item.getType('text/plain')).text();
      }
      return out;
    })()`);
    expect(copied.html).toContain('<table');
    expect(copied.html.toLowerCase()).not.toContain('caption');
    expect(copied.html).not.toContain('fb-table-mark');
    for (const one of SHOWN) {
      expect(copied.text, one.name).not.toContain(markName(lang, one.expect.params));
    }
    const saved = await saveAs(core, page, path.join(dir, 'sc7.fb2'));
    expect(saved).not.toContain('<caption');
    // View → Fast Mode: every mark stays visible.
    await menu(page, 'view', 'fastMode');
    await expect(page.locator('.mfbe-body-view--fast')).toHaveCount(1);
    const marks = page.getByTestId('body-table-mark');
    await expect(marks).toHaveCount(SHOWN.length);
    for (let index = 0; index < SHOWN.length; index += 1) {
      await marks.nth(index).scrollIntoViewIfNeeded();
      await expect(marks.nth(index)).toBeVisible();
    }
  });

  test('sc.9: hover and click - the popover lists the problems and repairs that table in one step within the budget; Undo and Redo; Escape and an outside mousedown close it; under the run lock Repair table is disabled', async ({
    core,
    page,
  }) => {
    test.setTimeout(180_000);
    await openBook(core, page, TABLES);
    const lang = await pageLang(page);
    const p = params('tooltip-example');
    const { ref, element } = await caseElement(page, 'tooltip-example');
    const model = caseTable(await documentOf(page), 'tooltip-example');
    const mark = element.getByTestId('body-table-mark');
    // The caret in the table's first cell; a click on the mark leaves it there.
    await page.getByTestId('body-editor').focus();
    await caretIn(page, firstCell(model).attrs!.nodeId!, 1);
    const caret = await bodySelection(page);
    // Hover: the tooltip is the mark's title. The table in the middle of the view, so the
    // popover finds room below the mark (a modeless dialog stays inside the window).
    await page.evaluate(
      `document.querySelector('[data-testid="body-table"][data-node-id="${ref}"]').scrollIntoView({ block: 'center' })`,
    );
    await painted(page);
    await mark.hover();
    await expect(mark).toHaveAttribute('title', markTooltip(lang, p));
    await mark.click();
    const popover = page.getByTestId('dialog-table-mark');
    await expect(popover).toBeVisible();
    expect(await bodySelection(page)).toEqual(caret);
    // Below the mark, modeless; the two parts, Repair table and Close.
    const markBox = (await mark.boundingBox())!;
    const popoverBox = (await popover.boundingBox())!;
    expect(popoverBox.y).toBeGreaterThanOrEqual(markBox.y + markBox.height - 0.5);
    await expect(popover).toHaveAttribute('aria-modal', 'false');
    await expect(page.getByTestId('dialog-table-mark-title')).toContainText(
      uiText(lang, 'dialog.tableMark.title'),
    );
    await expect(page.getByTestId('dialog-table-mark-problems').locator('li')).toHaveText(
      problemParts(lang, p),
    );
    await expect(page.getByTestId('dialog-table-mark-button-close')).toBeVisible();
    const repair = page.getByTestId('dialog-table-mark-button-repair');
    await expect(repair).toBeEnabled();
    const before = await toXml(page);
    // Repair table: the mark goes within the budget, timed in the page from the click.
    const elapsed = await page.evaluate<number>(`((ref) => new Promise((resolve) => {
      const editor = document.querySelector('[data-testid="body-editor"]');
      const button = document.querySelector('[data-testid="dialog-table-mark-button-repair"]');
      const gone = () => {
        const table = document.querySelector('[data-testid="body-table"][data-node-id="' + ref + '"]');
        return !table || !table.querySelector('[data-testid="body-table-mark"]');
      };
      let start = 0;
      const timer = setTimeout(() => { observer.disconnect(); resolve(-1); }, 10000);
      const observer = new MutationObserver(() => {
        if (!gone()) return;
        const time = performance.now() - start;
        observer.disconnect();
        clearTimeout(timer);
        resolve(time);
      });
      observer.observe(editor, { subtree: true, childList: true, attributes: true });
      start = performance.now();
      button.click();
    }))(${JSON.stringify(ref)})`);
    expect(elapsed, 'the mark went').toBeGreaterThanOrEqual(0);
    // Recorded for docs/performance.md (feature 006, T186: quickstart §14, "Timed elsewhere").
    test.info().annotations.push({
      type: 'perf',
      description: `Repair table from the popover: the mark gone after ${elapsed.toFixed(1)} ms`,
    });
    expect(elapsed).toBeLessThanOrEqual(MARK_BUDGET_MS * PERF_FACTOR);
    await expect(popover).toHaveCount(0);
    const after = await toXml(page);
    expect(after).not.toBe(before);
    const repaired = (await documentOf(page)).bodies
      .flatMap((body) => [...walk(body)].map((step) => step.node))
      .find((node) => node.type === 'table' && node.attrs?.nodeId === ref)!;
    expect(shape(repaired)).toEqual(
      vectorShape(vectors.cases.find((one) => one.name === 'tooltip-example')!.expect.repaired!),
    );
    await expect(element).not.toHaveAttribute('data-irregular');
    // The tree followed (U38).
    let row = await treeRow(page, ref);
    expect(row).not.toBeNull();
    await expect(row!).not.toHaveAttribute('data-irregular');
    await expect(page.getByTestId(`tree-row-${ref}-mark`)).toHaveCount(0);

    // One Undo: the table, its mark, its tree mark and the command are back; one Redo: gone.
    await menu(page, 'edit', 'undo');
    await expect.poll(() => toXml(page)).toBe(before);
    await expect(element).toHaveAttribute('data-irregular', 'true');
    await expect(mark).toHaveCount(1);
    row = await treeRow(page, ref);
    await expect(row!).toHaveAttribute('data-irregular', 'true');
    await expect(page.getByTestId(`tree-row-${ref}-mark`)).toHaveCount(1);
    await caretIn(page, firstCell(model).attrs!.nodeId!, 1);
    await expect(await structureEntry(page, 'table.repair')).not.toHaveAttribute('aria-disabled');
    await closeMenus(page, 'menu-edit-popup');
    await menu(page, 'edit', 'redo');
    await expect.poll(() => toXml(page)).toBe(after);
    await expect(element).not.toHaveAttribute('data-irregular');
    await expect(mark).toHaveCount(0);
    row = await treeRow(page, ref);
    await expect(row!).not.toHaveAttribute('data-irregular');

    // A reopened popover closes on Escape and on a mousedown outside it, the caret kept.
    await menu(page, 'edit', 'undo');
    await expect(mark).toHaveCount(1);
    await caretIn(page, firstCell(model).attrs!.nodeId!, 1);
    const kept = await bodySelection(page);
    await mark.scrollIntoViewIfNeeded();
    await mark.click();
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    expect(await bodySelection(page)).toEqual(kept);
    await mark.click();
    await expect(popover).toBeVisible();
    const status = (await page.getByTestId('status-path').boundingBox())!;
    await page.mouse.move(status.x + status.width / 2, status.y + status.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(popover).toHaveCount(0);
    expect(await bodySelection(page)).toEqual(kept);

    // During a waiting script the mark stays and opens the popover, whose Repair table is
    // disabled with the run-lock reason, the focus on Close.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window.__mfbeTest?.scripts?.list() ?? []).some((one) => one.id === 'runs.longSilent'),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.evaluate(() => {
      void window.__mfbeTest!.scripts!.run('runs.longSilent');
    });
    await expect(page.getByTestId('script-run-banner')).toBeVisible();
    await expect(mark).toBeVisible();
    await mark.click();
    await expect(popover).toBeVisible();
    await expect(repair).toBeDisabled();
    await expect(repair).toHaveAttribute(
      'title',
      uiText(lang, 'commands.unavailable.runLock.script'),
    );
    await expect(page.getByTestId('dialog-table-mark-button-close')).toBeFocused();
    await page.getByTestId('dialog-table-mark-button-close').click();
    await expect(popover).toHaveCount(0);
    await page.getByTestId('script-run-cancel').click();
    await expect(page.getByTestId('script-run-banner')).toHaveCount(0, { timeout: 15_000 });
  });

  test('sc.10 (a) and (b): the mark follows an edit in the Source view and a script, both ways', async ({
    core,
    page,
  }) => {
    test.setTimeout(150_000);
    await openBook(core, page, TABLES);
    // (a) One <td> of the user story 8 scenario table deleted in the Source view.
    let us8 = await labelledTable(page, US8);
    await expect(tableElement(page, us8.ref)).not.toHaveAttribute('data-irregular');
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    const original = (await page.evaluate(() => window.__mfbeTest!.sourceMapping!.sourceText()))!;
    const label = original.indexOf(`<p>${US8}</p>`);
    const cut = original.indexOf('<td>r2c4</td>', label);
    expect(label).toBeGreaterThan(0);
    expect(cut).toBeGreaterThan(label);
    const replaceSource = async (text: string) => {
      await page.locator('.mfbe-source-editor .cm-content').focus();
      await page.keyboard.press(`${MOD}+a`);
      await page.keyboard.insertText(text);
      await expect
        .poll(() => page.evaluate(() => window.__mfbeTest!.sourceMapping!.sourceText()))
        .toBe(text);
    };
    await replaceSource(original.slice(0, cut) + original.slice(cut + '<td>r2c4</td>'.length));
    await page.getByTestId('view-body').click();
    await hooksReady(page);
    us8 = await labelledTable(page, US8);
    await expect(tableElement(page, us8.ref)).toHaveAttribute('data-irregular', 'true');
    await expect(tableElement(page, us8.ref).getByTestId('body-table-mark')).toHaveCount(1);
    // The cell restored: the mark goes.
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    await replaceSource(original);
    await page.getByTestId('view-body').click();
    await hooksReady(page);
    us8 = await labelledTable(page, US8);
    await expect(tableElement(page, us8.ref)).not.toHaveAttribute('data-irregular');
    await expect(tableElement(page, us8.ref).getByTestId('body-table-mark')).toHaveCount(0);

    // (b) `tables.toggleRegular` (07_Tables) in the user story 7 4 × 3 table: a short last row,
    // then a regular table again.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window.__mfbeTest?.scripts?.list() ?? []).some(
              (one) => one.id === 'tables.toggleRegular',
            ),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    let us7 = await labelledTable(page, US7);
    await caretIn(page, firstCell(us7.table).attrs!.nodeId!);
    await page.evaluate(() => window.__mfbeTest!.scripts!.run('tables.toggleRegular'));
    us7 = await labelledTable(page, US7);
    await expect(tableElement(page, us7.ref)).toHaveAttribute('data-irregular', 'true');
    await expect(tableElement(page, us7.ref).getByTestId('body-table-mark')).toHaveCount(1);
    await caretIn(page, firstCell(us7.table).attrs!.nodeId!);
    await page.evaluate(() => window.__mfbeTest!.scripts!.run('tables.toggleRegular'));
    us7 = await labelledTable(page, US7);
    await expect(tableElement(page, us7.ref)).not.toHaveAttribute('data-irregular');
    await expect(tableElement(page, us7.ref).getByTestId('body-table-mark')).toHaveCount(0);
  });

  test('sc.10 (c): the mark comes with the assistant’s change that leaves a short row and goes with the one that completes it', async ({
    core,
    page,
    standin,
  }) => {
    test.setTimeout(150_000);
    await standin.reset();
    await core.resetAiRequests();
    await core.setAiResolve([]);
    await core.rpc('settings.set', {
      patch: {
        session: { aiPanelVisible: true },
        ai: {
          mode: 'custom',
          custom: { address: `${standin.url}/v1`, key: '', model: 'standin-chat' },
        },
      },
    });
    await openBook(core, page, TABLES);
    await ensureAssistantOn(page);
    let us8 = await labelledTable(page, US8);
    // The table's path: the caret's path cut after `table[n]`.
    await caretIn(page, firstCell(us8.table).attrs!.nodeId!);
    await expect(page.getByTestId('status-path')).toHaveText(/table\[\d+\]\/tr\[1\]\/td\[1\]$/);
    const caretPath = (await page.getByTestId('status-path').textContent())!;
    const node = caretPath.slice(0, caretPath.lastIndexOf('/tr['));
    const row = (r: number) =>
      `<tr>${[1, 2, 3, 4]
        .map((c) => (r === 1 && c === 2 ? '<td id="us8-r1c2">r1c2</td>' : `<td>r${r}c${c}</td>`))
        .join('')}</tr>`;
    const full = `<table>${row(1)}${row(2)}${row(3)}</table>`;
    const short = full.replace('<td>r3c4</td>', '');
    const ask = async (xml: string, instruction: string) => {
      await standin.reset();
      await standin.scenarios([
        toolCall('c-table', 'replace_node', { node, content: { xml } }),
        { text: 'Done.' },
      ]);
      const request = await sendAndWait(page, instruction);
      expect(request.state, instruction).toBe('committed');
    };
    await ask(short, 'Remove the last cell of the table');
    us8 = await labelledTable(page, US8);
    await expect(tableElement(page, us8.ref)).toHaveAttribute('data-irregular', 'true');
    await expect(tableElement(page, us8.ref).getByTestId('body-table-mark')).toHaveCount(1);
    await ask(full, 'Put the last cell back');
    us8 = await labelledTable(page, US8);
    await expect(tableElement(page, us8.ref)).not.toHaveAttribute('data-irregular');
    await expect(tableElement(page, us8.ref).getByTestId('body-table-mark')).toHaveCount(0);
  });

  test('sc.11: Validate lists one table.irregular warning per irregular table, named as its mark; a double-click goes to the table in the Body view, to <table in a clean Source view and to the line and column of a dirty one; the warning never blocks Save As', async ({
    core,
    page,
  }) => {
    test.setTimeout(180_000);
    await openBook(core, page, TABLES);
    const lang = await pageLang(page);
    const doc = await documentOf(page);
    await page.getByTestId('body-editor').focus();
    await validate(page);
    const rows = warningRows(page);
    await expect(rows).toHaveCount(IRREGULAR.length);
    expect(IRREGULAR).toHaveLength(13);
    // Each row is its table's name; the node ids are the marked tables' and plural-forms'.
    const byRef = new Map<string, Locator>();
    for (let index = 0; index < IRREGULAR.length; index += 1) {
      const one = rows.nth(index);
      byRef.set((await one.getAttribute('data-node-id'))!, one);
    }
    const sourceBookRef = caseTable(doc, SOURCE_BOOK_CASE).attrs!.nodeId!;
    expect(
      (doc.description.srcTitleInfo?.annotation?.content ?? []).some(
        (node) => node.attrs?.nodeId === sourceBookRef,
      ),
    ).toBe(true);
    expect([...byRef.keys()].sort()).toEqual([...(await markedRefs(page)), sourceBookRef].sort());
    for (const one of IRREGULAR) {
      const ref = caseTable(doc, one.name).attrs!.nodeId!;
      await expect(byRef.get(ref)!.locator('.mfbe-validation-message'), one.name).toContainText(
        markName(lang, one.expect.params),
      );
    }
    await expect(
      byRef.get(caseTable(doc, 'short-row').attrs!.nodeId!)!.locator('.mfbe-validation-message'),
    ).toContainText(
      uiText(lang, 'validation.table.irregularNamed', {
        id: 't2',
        problems: problemsText(lang, params('short-row')),
      }),
    );
    // No warning for a regular table: every other row is of another code.
    await expect(
      page.locator('[data-testid^="validation-issue-"][data-code="table.irregular"]'),
    ).toHaveCount(13);

    // Go to from the Body view: the caret at the start of the table's first cell.
    for (const one of SHOWN) {
      const { table, parent } = locateAfter(doc, `Case ${one.name} (`);
      const k = (parent.content ?? []).filter((node) => node.type === 'table').indexOf(table) + 1;
      await byRef.get(table.attrs!.nodeId!)!.dblclick();
      await expect(page.getByTestId('status-path'), one.name).toHaveText(
        new RegExp(`table\\[${k}\\]/tr\\[1\\]/t[dh]\\[1\\]$`),
      );
      expect((await bodySelection(page))?.head, one.name).toEqual({
        nodeId: firstCell(table).attrs!.nodeId,
        offset: 0,
      });
    }
    // plural-forms has no node in the Body view: its Go to reaches its Source line (U23).
    const sourceRow = byRef.get(sourceBookRef)!;
    const sourceLine = Number(await sourceRow.getAttribute('data-line'));
    expect(sourceLine).toBeGreaterThan(0);
    await sourceRow.dblclick();
    await expect(page.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    const text = (await page.evaluate(() => window.__mfbeTest!.sourceMapping!.sourceText()))!;
    const tableAt = (line: number) => {
      const start = lineStart(text, line);
      return start + text.slice(start).search(/\S/);
    };
    expect(text.slice(tableAt(sourceLine), tableAt(sourceLine) + 6)).toBe('<table');
    await expect
      .poll(() => page.evaluate(() => window.__mfbeTest!.sourceMapping!.sourceSelection()?.head))
      .toBe(tableAt(sourceLine));
    // From the clean Source view: the cursor on the `<` of `<table` on the row's line.
    for (const one of IRREGULAR) {
      const row = byRef.get(caseTable(doc, one.name).attrs!.nodeId!)!;
      const line = Number(await row.getAttribute('data-line'));
      expect(text.slice(tableAt(line), tableAt(line) + 6), one.name).toBe('<table');
      await row.dblclick();
      await expect
        .poll(() => page.evaluate(() => window.__mfbeTest!.sourceMapping!.sourceSelection()?.head))
        .toBe(tableAt(line));
    }

    // Save As after an edit: the warnings never ask (no dialog-validation-failed).
    await page.getByTestId('view-body').click();
    await hooksReady(page);
    const us8 = await labelledTable(page, US8);
    await page.getByTestId('body-editor').focus();
    await caretIn(page, firstCell(us8.table).attrs!.nodeId!, 4);
    await page.keyboard.type('!');
    await saveAs(core, page, path.join(dir, 'sc11.fb2'));
    await expect(page.getByTestId('dialog-validation-failed')).toHaveCount(0);

    // A dirty Source view: `<!-- Таблица --> ` typed before `<table id="t2">` on its line;
    // F8 gives that line and the UTF-16 column of the `<`, and the double-click goes there.
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    const clean = (await page.evaluate(() => window.__mfbeTest!.sourceMapping!.sourceText()))!;
    const at = clean.indexOf('<table id="t2">');
    expect(at).toBeGreaterThan(0);
    await page.locator('.mfbe-source-editor .cm-content').focus();
    await page.evaluate((offset) => window.__mfbeTest!.sourceMapping!.select(offset), at);
    const comment = '<!-- Таблица --> ';
    await page.keyboard.insertText(comment);
    await expect
      .poll(() => page.evaluate(() => window.__mfbeTest!.sourceMapping!.sourceText()))
      .toBe(clean.slice(0, at) + comment + clean.slice(at));
    const dirty = clean.slice(0, at) + comment + clean.slice(at);
    const line = dirty.slice(0, at).split('\n').length;
    const column = at + comment.length - lineStart(dirty, line) + 1;
    await validate(page);
    const named = page.locator('[data-testid^="validation-issue-"][data-code="table.irregular"]', {
      hasText: uiText(lang, 'validation.table.irregularNamed', {
        id: 't2',
        problems: problemsText(lang, params('short-row')),
      }),
    });
    await expect(named).toHaveCount(1);
    await expect(named).toHaveAttribute('data-line', String(line));
    await expect(named).toHaveAttribute('data-column', String(column));
    await named.dblclick();
    await expect
      .poll(() => page.evaluate(() => window.__mfbeTest!.sourceMapping!.sourceSelection()?.head))
      .toBe(lineStart(dirty, line) + column - 1);
  });
});

/* ------------------------------------------------------------------------ */
/* User story 10: the marks in the Description view's fields                */
/* ------------------------------------------------------------------------ */

test.describe('US10 (feature 006) - irregular tables are marked in the Description view’s fields', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.rpc('settings.set', {
      patch: { session: { aiPanelVisible: false }, other: { restorePosition: false } },
    });
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    await core
      .rpc('settings.set', {
        patch: { session: { aiPanelVisible: null }, other: { restorePosition: null }, ai: null },
      })
      .catch(() => {});
  });

  test('the book annotation’s mark names its problems; its popover repairs the table in one Description undo step, closes on Escape and on an outside mousedown with the caret kept, and offers no repair during a script; plural-forms is marked in the source book’s annotation', async ({
    core,
    page,
    standin,
  }) => {
    test.setTimeout(150_000);
    await standin.reset();
    await core.resetAiRequests();
    await core.setAiResolve([]);
    await core.rpc('settings.set', {
      patch: {
        session: { aiPanelVisible: true },
        ai: {
          mode: 'custom',
          custom: { address: `${standin.url}/v1`, key: '', model: 'standin-chat' },
        },
      },
    });
    await openBook(core, page, TABLES);
    await ensureAssistantOn(page);
    const lang = await pageLang(page);
    const doc = await documentOf(page);
    await page.getByTestId('view-description').click();
    const field = page.getByTestId('description-annotation');
    await expect(field).toHaveAttribute('contenteditable', 'true');
    const selection = () =>
      page.evaluate(() => window.__mfbeTest!.tables!.target()?.selection ?? null);

    // plural-forms, in the source book's annotation only (C58).
    const plural = params(SOURCE_BOOK_CASE);
    const pluralRef = caseTable(doc, SOURCE_BOOK_CASE).attrs!.nodeId!;
    const pluralMark = page
      .getByTestId('description-sti-annotation')
      .locator(`[data-testid="body-table"][data-node-id="${pluralRef}"]`)
      .getByTestId('body-table-mark');
    await expect(pluralMark).toHaveCount(1);
    await expect(pluralMark).toHaveAttribute('aria-label', markName(lang, plural));
    await expect(pluralMark).toHaveAttribute('title', markTooltip(lang, plural));

    // The book annotation's irregular table: its mark's name and tooltip.
    const name = 'overlap-from-two-rows-above';
    const p = params(name);
    const model = caseTable(doc, name);
    const ref = model.attrs!.nodeId!;
    const element = field.locator(`[data-testid="body-table"][data-node-id="${ref}"]`);
    const mark = element.getByTestId('body-table-mark');
    await expect(element).toHaveAttribute('data-irregular', 'true');
    await expect(mark).toHaveAttribute('aria-label', markName(lang, p));
    await expect(mark).toHaveAttribute('title', markTooltip(lang, p));

    // The caret in the field's first cell of that table; the popover lists the problems.
    const first = field.locator(`td[data-node-id="${firstCell(model).attrs!.nodeId!}"]`);
    await first.scrollIntoViewIfNeeded();
    await first.click();
    await expect
      .poll(async () => JSON.stringify(await selection()))
      .toContain(firstCell(model).attrs!.nodeId!);
    const caret = await selection();
    await page.evaluate(
      `document.querySelector('[data-testid="description-annotation"] [data-node-id="${ref}"]').scrollIntoView({ block: 'center' })`,
    );
    await painted(page);
    await mark.click();
    const popover = page.getByTestId('dialog-table-mark');
    await expect(popover).toBeVisible();
    expect(await selection()).toEqual(caret);
    await expect(page.getByTestId('dialog-table-mark-title')).toContainText(
      uiText(lang, 'dialog.tableMark.title'),
    );
    await expect(page.getByTestId('dialog-table-mark-problems').locator('li')).toHaveText(
      problemParts(lang, p),
    );

    // Repair table: the mark goes, the table is regular; one Undo brings both back.
    const before = await toXml(page);
    await page.getByTestId('dialog-table-mark-button-repair').click();
    await expect(popover).toHaveCount(0);
    await expect(mark).toHaveCount(0);
    await expect(element).not.toHaveAttribute('data-irregular');
    await expect
      .poll(() => page.evaluate((id) => window.__mfbeTest!.tables!.grid(id), ref))
      .toMatchObject({ shortRows: 0, overlaps: 0, pastEnd: 0 });
    await menu(page, 'edit', 'undo');
    await expect.poll(() => toXml(page)).toBe(before);
    await expect(element).toHaveAttribute('data-irregular', 'true');
    await expect(mark).toHaveCount(1);

    // A reopened popover closes on Escape and on a mousedown outside it, the caret kept.
    await first.scrollIntoViewIfNeeded();
    await first.click();
    await expect
      .poll(async () => JSON.stringify(await selection()))
      .toContain(firstCell(model).attrs!.nodeId!);
    const kept = await selection();
    await mark.scrollIntoViewIfNeeded();
    await mark.click();
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    expect(await selection()).toEqual(kept);
    await mark.click();
    await expect(popover).toBeVisible();
    const status = (await page.getByTestId('statusbar').boundingBox())!;
    await page.mouse.move(status.x + status.width / 2, status.y + status.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(popover).toHaveCount(0);
    expect(await selection()).toEqual(kept);

    // While a request to the assistant waits - the run lock a request in the Description view
    // holds -, the mark opens the popover, whose Repair table is disabled with the lock's reason,
    // the focus on Close.
    await standin.reset();
    await standin.scenarios([{ text: 'Later.', delayMs: 6000 }] as never);
    await page.getByTestId('ai-input').fill('wait a little');
    await page.getByTestId('ai-input').press('Enter');
    await expect(page.getByTestId('script-run-banner')).toBeVisible();
    await expect(field).toHaveAttribute('contenteditable', 'false');
    await mark.scrollIntoViewIfNeeded();
    await mark.click();
    await expect(popover).toBeVisible();
    const repair = page.getByTestId('dialog-table-mark-button-repair');
    await expect(repair).toBeDisabled();
    await expect(repair).toHaveAttribute('title', uiText(lang, 'commands.unavailable.runLock.ai'));
    await expect(page.getByTestId('dialog-table-mark-button-close')).toBeFocused();
    await page.getByTestId('dialog-table-mark-button-close').click();
    await expect(popover).toHaveCount(0);
    await expect(page.getByTestId('script-run-banner')).toHaveCount(0, { timeout: 30_000 });
    expect(await toXml(page)).toBe(before);
  });
});
