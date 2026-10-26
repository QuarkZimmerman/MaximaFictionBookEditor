/**
 * Timed journey of the table commands (feature 006, T186; SC-005; the spec's edge case "Large
 * tables ... A command on a large table never slows down typing elsewhere afterwards"; C21, C50;
 * U20; research R1.9, R4.8, R8.16; quickstart §14; tagged `@perf`, so CI runs it apart from the
 * journeys on one worker).
 *
 * The book is the SC-005 book of `tests/fixtures/gen-large-book.py` (T020), written into a
 * temporary folder: the 10 MB text book with a 300 x 10 table in section 1, a 1000 x 20 table in
 * section 3 and the census's largest real shapes, 628 x 4 in section 4 and 298 x 14 in section 5,
 * a few merged 2 x 2 cells in each. Every cell holds `r<row>c<column>`; a merged cell the text of
 * its top-left position. The Commands toolbar shows its original layout followed by the 25 table
 * buttons (`session.toolbarLayouts.commands`), so every table button's availability is evaluated
 * on every revision (C21; U20), and each command starts with an in-page click on its
 * `toolbar-table.<name>` button (*Table...* with the dialog's OK). A command is timed in the page
 * from that click to the first animation frame after the table's DOM shows the result,
 * `requestAnimationFrame` alone, as `switchTimed` of `perf-large-book.spec.ts` times a view
 * switch; Undo between the runs, outside the time.
 *
 * The places avoid the generator's merged cells (seed 1: 300 x 10 r13c5, r38c9, r207c3, r248c3;
 * 1000 x 20 r185c5, r579c11, r626c3, r720c15, r721c4, r722c10, r924c8, r973c7; 628 x 4 r320c2,
 * r473c2; 298 x 14 r89c11, r165c5, r216c11, r230c11): the caret at the table's place, a 3 x 2
 * block from there for the block commands, one merged cell for *Split cell*. A column move needs
 * a column whose borders no merged cell crosses (else `merged-crosses-border`, the button
 * disabled), so the two column moves run at the nearest such column of the place's row where the
 * place's column is crossed - and on the 628 x 4 table, whose middle columns 2 and 3 are joined by
 * both merged cells, *Move column left* at column 4 and *Move column right* at column 1.
 *
 * Measured, per table: the 24 table commands, `insert.table` from the dialog's OK, the paste of a
 * copied 10 x 5 block (of the 300 x 10 table) into the place's cell and the paste of the table's
 * own copy after a paragraph of section 2 - each paste's three flavours captured from the `copy`
 * event of the block or of *Select table* and replayed as a synthetic `paste` event (C50) -, and
 * *Repair table* last, on the table made irregular by the fixture script `tables.toggleRegular`
 * (T019); then typing in a paragraph of section 2. On 300 x 10, 628 x 4 and 298 x 14 five runs
 * each, the median under 100 ms x `MFBE_PERF_FACTOR`; on 1000 x 20 three runs each, every run
 * under 1 s; typing after the commands, the median of 11 keystrokes under 100 ms; typing in a cell
 * of the 1000 x 20 table, the median of 11 under 100 ms x `MFBE_PERF_FACTOR`; File > Open of the
 * book until the Body view is editable within 3 s; the Source view's "Add > Table available"
 * step, from the cursor put between two elements of the ready Source view until
 * `toolbar-insert.table` is enabled, under 3 s x `MFBE_PERF_FACTOR` (a project number, research
 * R4.8). Recorded, not asserted (quickstart open point 7): the keystroke in a paragraph of
 * section 3, which pays the write-back of the window that holds the 1000 x 20 table (R1.9), and
 * the text-form `doc.validate` of the book with the 300 x 10 table irregular against the same
 * text with it regular (`contracts/rpc-api.md` open point 1).
 *
 * Every median and recorded figure is attached as a `perf` annotation and written to
 * `tests/bench/results/table-commands.json` (git-ignored; CI's `bench-results` artifact, the
 * release workflow's job summary). Needs the real core and `python3`; skipped otherwise.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle, type RpcCallError } from './fixtures/core';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const GENERATOR = path.join(REPO_ROOT, 'tests', 'fixtures', 'gen-large-book.py');
/** The script group of T019: `tables.toggleRegular` toggles a short last row (FR-049). */
const TABLE_SCRIPTS = path.join(REPO_ROOT, 'tests', 'scripts', 'fixtures', '07_Tables');
const RESULTS_FILE = path.join(REPO_ROOT, 'tests', 'bench', 'results', 'table-commands.json');

/** SC-005's book (data-model §16.4; quickstart §14). */
const BOOK_OPTIONS = [
  '--size-mb',
  '10',
  '--table',
  '300x10@1:4',
  '--table',
  '1000x20@3:8',
  '--table',
  '628x4@4:2',
  '--table',
  '298x14@5:4',
];

/** The constitution's opening budget (docs/performance.md). */
const EDITABLE_BUDGET_MS = 3000;
/** SC-005: the editor's interaction budget, x `MFBE_PERF_FACTOR`. */
const INTERACTION_BUDGET_MS = 100;
/** SC-005: every command on the 1000 x 20 table. */
const LARGE_TABLE_BUDGET_MS = 1000;
/** Typing after a table command (the constitution's interaction latency). */
const KEYSTROKE_BUDGET_MS = 100;
/** Research R4.8: "Add > Table available" in the Source view, a project number. */
const SOURCE_AVAILABLE_BUDGET_MS = 3000;
/**
 * The budget the assistant's validations are held to (docs/performance.md): a text-form
 * validation above it x `MFBE_PERF_FACTOR` calls for rpc-api.md's fallback (open point 1).
 */
const VALIDATION_BUDGET_MS = 1000;
/** Hosted CI runners against a 2020-era laptop (docs/performance.md). */
const PERF_FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 2) || 2;
/** Keystrokes per typing measurement. */
const KEYSTROKES = 11;
/**
 * The journeys' own time-outs, from the development host's Release-core run (12-18 s per table
 * of the 100 ms tier, 22 s for the 1000 x 20 table, 7 s for the Source view) with room for the
 * hosted runners, 2-3 times slower, and the macOS leg of the Docs build replay; the first CI
 * run's durations confirm them (research.md, open point 8, as the long journeys of T187).
 */
const TABLE_TIMEOUT_MS = 5 * 60_000;
const LARGE_TABLE_TIMEOUT_MS = 8 * 60_000;
const SOURCE_TIMEOUT_MS = 3 * 60_000;

/**
 * The Commands toolbar's original layout (`IDR_MAINFRAME TOOLBAR`, "-" a separator) and the 25
 * buttons it offers beyond it (feature 006, FR-041), all shown.
 */
const COMMANDS_LAYOUT = [
  'file.new',
  'file.open',
  'file.save',
  '-',
  'file.validate',
  '-',
  'view.description',
  'view.body',
  'view.source',
  'ai.toggle',
  '-',
  'insert.binary',
  'insert.image',
  'insert.inlineImage',
  '-',
  'edit.find',
  'edit.findNext',
  '-',
  'edit.cut',
  'edit.copy',
  'edit.paste',
  '-',
  'edit.undo',
  'edit.redo',
  '-',
  'style.strong',
  'style.emphasis',
  'style.sup',
  'style.sub',
  'style.strikethrough',
  'style.code',
  '-',
  'style.link',
  'style.footnote',
  'style.removeLink',
  'edit.gotoFootnote',
  '-',
  'style.normal',
  'style.subtitle',
  'style.textAuthor',
  '-',
  'tools.spellcheck',
  '-',
  'insert.table',
  'table.insertRowAbove',
  'table.insertRowBelow',
  'table.deleteRow',
  'table.insertColumnLeft',
  'table.insertColumnRight',
  'table.deleteColumn',
  'table.mergeCells',
  'table.splitCell',
  'table.toggleHeaderCell',
  'table.makeHeaderCells',
  'table.makeNormalCells',
  'table.toggleHeaderRow',
  'table.toggleHeaderColumn',
  'table.repair',
  'table.select',
  'table.delete',
  'table.moveRowUp',
  'table.moveRowDown',
  'table.moveColumnLeft',
  'table.moveColumnRight',
  'table.duplicateRow',
  'table.duplicateColumn',
  'table.paragraphBefore',
  'table.paragraphAfter',
];

/** The 24 table commands in FR-039's order, *Repair table* (timed last) left out. */
const COMMANDS = [
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
] as const;

type Command = (typeof COMMANDS)[number];

/** The commands that act on a block of cells. */
const BLOCK_COMMANDS: ReadonlySet<Command> = new Set([
  'mergeCells',
  'makeHeaderCells',
  'makeNormalCells',
]);

type TableKey = 'table300' | 'table628' | 'table298' | 'table1000';

/** A position of a table, from 1, as the generator writes `r<row>c<column>`. */
interface Position {
  row: number;
  column: number;
}

interface TableCase {
  key: TableKey;
  label: string;
  /** The section (from 1) the table stands in, right after the title. */
  section: number;
  rows: number;
  columns: number;
  /** The caret's cell; the block commands' 3 x 2 block starts here; the block paste's target. */
  place: Position;
  /** The columns of the place's row where *Move column left* / *right* run. */
  columnMoves: { left: number; right: number };
  /** A merged 2 x 2 cell of the generator (its top-left position), for *Split cell*. */
  merged: Position;
  /** Runs per command. */
  runs: number;
  /** The median of the runs (100 ms tier) or every run (1 s tier) under this many ms. */
  budgetMs: number;
  tier: 'median' | 'every';
}

const TABLES: Record<TableKey, TableCase> = {
  table300: {
    key: 'table300',
    label: '300 x 10',
    section: 1,
    rows: 300,
    columns: 10,
    place: { row: 150, column: 5 },
    // r13c5 joins columns 5 and 6: column 7 is the nearest whose borders no cell crosses.
    columnMoves: { left: 7, right: 7 },
    merged: { row: 207, column: 3 },
    runs: 5,
    budgetMs: INTERACTION_BUDGET_MS * PERF_FACTOR,
    tier: 'median',
  },
  table628: {
    key: 'table628',
    label: '628 x 4',
    section: 4,
    rows: 628,
    columns: 4,
    place: { row: 314, column: 2 },
    // r320c2 and r473c2 join columns 2 and 3: column 4 has no right and column 1 no left neighbour.
    columnMoves: { left: 4, right: 1 },
    merged: { row: 320, column: 2 },
    runs: 5,
    budgetMs: INTERACTION_BUDGET_MS * PERF_FACTOR,
    tier: 'median',
  },
  table298: {
    key: 'table298',
    label: '298 x 14',
    section: 5,
    rows: 298,
    columns: 14,
    place: { row: 150, column: 7 },
    columnMoves: { left: 7, right: 7 },
    merged: { row: 165, column: 5 },
    runs: 5,
    budgetMs: INTERACTION_BUDGET_MS * PERF_FACTOR,
    tier: 'median',
  },
  table1000: {
    key: 'table1000',
    label: '1000 x 20',
    section: 3,
    rows: 1000,
    columns: 20,
    place: { row: 500, column: 10 },
    // r722c10 joins columns 10 and 11: column 13 is the nearest whose borders no cell crosses.
    columnMoves: { left: 13, right: 13 },
    merged: { row: 579, column: 11 },
    runs: 3,
    budgetMs: LARGE_TABLE_BUDGET_MS,
    tier: 'every',
  },
};

/** The block every table's block paste takes: rows 100-109, columns 1-5 of the 300 x 10 table. */
const BLOCK_SOURCE: { from: Position; to: Position } = {
  from: { row: 100, column: 1 },
  to: { row: 109, column: 5 },
};

/** The paragraphs of section 2 (from 1): the table pastes follow one, the typing goes into another. */
const PASTE_PARAGRAPH = 3;
const TYPING_PARAGRAPH = 6;

/* ------------------------------------------------------------------------ */
/* The page side (the e2e tsconfig has no DOM lib, hence strings)            */
/* ------------------------------------------------------------------------ */

/**
 * `window.__perfTables`: the probes and the timed actions. A probe is a cheap string of what a
 * command changes - for a table (by node id): whether it is selected, irregular or there at all,
 * its row count, the header row's cell count and its text at the subject column, the subject
 * row's cell count, header cells, first cell and cell at the subject column, and the node ids of
 * its neighbours; for a node: the node id of its next sibling. A timed action starts the clock,
 * acts, waits frame by frame until the probe differs from before and then for one more animation
 * frame, as `switchTimed` does.
 */
const INSTALL_HELPERS = `(() => {
  if (window.__perfTables) return;
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  const tableOf = (ref) =>
    document.querySelector('[data-testid="body-table"][data-node-id="' + ref + '"]');
  const text = (cell) => (cell ? cell.textContent : null);
  const idOf = (element) => (element ? element.getAttribute('data-node-id') : null);
  const probe = (p) => {
    if (p.kind === 'next') {
      const node = document.querySelector('[data-node-id="' + p.id + '"]');
      return JSON.stringify([!!node, idOf(node && node.nextElementSibling)]);
    }
    const table = tableOf(p.ref);
    if (!table) return 'gone';
    const rows = table.rows;
    const header = rows[0];
    const row = rows[p.row];
    return JSON.stringify([
      table.classList.contains('fb-selected'),
      table.hasAttribute('data-irregular'),
      rows.length,
      header ? header.cells.length : -1,
      header ? text(header.cells[p.col]) : null,
      row ? row.cells.length : -1,
      row ? row.querySelectorAll('th').length : -1,
      row ? text(row.cells[0]) : null,
      row ? text(row.cells[p.col]) : null,
      idOf(table.previousElementSibling),
      idOf(table.nextElementSibling),
    ]);
  };
  const settle = async (p, before, start) => {
    while (probe(p) === before) {
      if (performance.now() - start > 30000) return { ms: -1, error: 'nothing changed in 30 s' };
      await frame();
    }
    await frame();
    return { ms: performance.now() - start };
  };
  window.__perfTables = {
    clips: {},
    probe,
    /** The node id of the cell at (row, column) from 1: the cell of its row holding r<row>c<column>. */
    cell(ref, row, column) {
      const table = tableOf(ref);
      const tr = table && table.rows[row - 1];
      if (!tr) return null;
      const wanted = 'r' + row + 'c' + column;
      for (const cell of tr.cells) if (cell.textContent === wanted) return idOf(cell);
      return null;
    },
    async click(selector, p) {
      const button = document.querySelector(selector);
      if (!button) return { ms: -1, error: 'no ' + selector };
      if (button.disabled) return { ms: -1, error: selector + ' disabled: ' + button.title };
      const before = probe(p);
      const start = performance.now();
      button.click();
      return settle(p, before, start);
    },
    /** What a synthetic copy event leaves in its DataTransfer, kept as the clip "name". */
    copy(name) {
      const data = new DataTransfer();
      const event = new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true });
      document.querySelector('[data-testid="body-editor"]').dispatchEvent(event);
      const clip = {
        plain: data.getData('text/plain'),
        html: data.getData('text/html'),
        json: data.getData('application/x-mfbe-fb2+json'),
      };
      this.clips[name] = clip;
      return {
        lines: clip.plain === '' ? 0 : clip.plain.split('\\n').length,
        fields: clip.plain === '' ? 0 : clip.plain.split('\\n')[0].split('\\t').length,
        html: clip.html.length,
        json: clip.json.length,
      };
    },
    /** The clip "name" replayed as a synthetic paste event on the editor, timed. */
    async paste(name, p) {
      const clip = this.clips[name];
      const data = new DataTransfer();
      data.setData('text/plain', clip.plain);
      data.setData('text/html', clip.html);
      data.setData('application/x-mfbe-fb2+json', clip.json);
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      const editor = document.querySelector('[data-testid="body-editor"]');
      const before = probe(p);
      const start = performance.now();
      editor.dispatchEvent(event);
      return settle(p, before, start);
    },
    /** Edit > Undo from its toolbar button, until the probe is back at "expected". */
    async undo(p, expected) {
      const button = document.querySelector('[data-testid="toolbar-edit.undo"]');
      if (!button || button.disabled) return 'Undo is unavailable';
      const start = performance.now();
      button.click();
      while (probe(p) !== expected) {
        if (performance.now() - start > 60000) return 'not restored: ' + probe(p);
        await frame();
      }
      return null;
    },
    /** Puts the Source cursor at "offset" and waits until toolbar-insert.table is enabled. */
    async sourceTableAvailable(offset) {
      const button = () => document.querySelector('[data-testid="toolbar-insert.table"]');
      const enabledBefore = !!button() && !button().disabled;
      const start = performance.now();
      if (!window.__mfbeTest.sourceMapping.select(offset)) return { ms: -1, enabledBefore };
      while (!button() || button().disabled) {
        if (performance.now() - start > 60000) return { ms: -1, enabledBefore };
        await frame();
      }
      await frame();
      return { ms: performance.now() - start, enabledBefore };
    },
  };
})()`;

/** In-page keystroke timing, as `typeAndMeasure` of `perf-large-book.spec.ts`. */
const TYPE_AND_MEASURE = `(async () => {
  const start = performance.now();
  document.execCommand('insertText', false, 'x');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  return performance.now() - start;
})()`;

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

interface TableProbe {
  kind: 'table';
  ref: string;
  /** The subject row and column, from 0. */
  row: number;
  col: number;
}

interface NextProbe {
  kind: 'next';
  id: string;
}

type Probe = TableProbe | NextProbe;

interface Timed {
  ms: number;
  error?: string;
}

/** The results file: every section the journeys measured. */
interface Results {
  perfFactor: number;
  table300?: Record<string, number>;
  table628?: Record<string, number>;
  table298?: Record<string, number>;
  table1000?: Record<string, number>;
  pastes?: Partial<Record<TableKey, Record<string, number>>>;
  typing?: Record<string, number>;
  recorded?: Record<string, number | string>;
}

function median(samples: number[]): number {
  return [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/**
 * Merges `partial` into the results file. The first journey of the file starts it afresh; each
 * journey adds its sections, so a retried journey in a new worker keeps the others' figures.
 */
function recordResults(partial: Omit<Results, 'perfFactor'>): void {
  mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
  let current: Results = { perfFactor: PERF_FACTOR };
  if (existsSync(RESULTS_FILE)) {
    try {
      current = JSON.parse(readFileSync(RESULTS_FILE, 'utf8')) as Results;
    } catch {
      // A broken file is started afresh.
    }
  }
  const merged: Results = {
    ...current,
    ...partial,
    perfFactor: PERF_FACTOR,
    pastes: { ...current.pastes, ...partial.pastes },
    typing: { ...current.typing, ...partial.typing },
    recorded: { ...current.recorded, ...partial.recorded },
  };
  writeFileSync(RESULTS_FILE, `${JSON.stringify(merged, null, 2)}\n`);
}

function annotate(description: string): void {
  test.info().annotations.push({ type: 'perf', description });
}

/** The skips of a journey without a core, python3 or the generator, as `perf-large-book`. */
async function requirements(core: CoreHandle, book: string): Promise<void> {
  test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  test.skip(!book || !existsSync(book), 'python3 / the generator are not available');
  const supportsDocuments = await core
    .rpc('doc.recent')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
  test.skip(!supportsDocuments, 'the core does not implement doc.* yet');
}

/**
 * The application with every table button on the Commands toolbar and the table dialog's first
 * values, the fixture scripts in the data folder; then File > Open of the book, timed until the
 * Body view is editable (constitution budget, 3 s). Returns that time.
 */
async function openBook(core: CoreHandle, page: Page, book: string): Promise<number> {
  const target = path.join(core.dataDir!, 'scripts', '07_Tables');
  if (!existsSync(target)) cpSync(TABLE_SCRIPTS, target, { recursive: true });
  await core.rpc('scripts.reload');
  await core.rpc('settings.set', {
    patch: { session: { toolbarLayouts: { commands: COMMANDS_LAYOUT }, tableDialog: null } },
  });
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await expect(page.getByTestId('toolbar-table.repair')).toBeAttached();
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  const started = Date.now();
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book, EDITABLE_BUDGET_MS * 4);
  const editor = page.getByTestId('body-editor');
  await expect(editor).toHaveAttribute('contenteditable', 'true', {
    timeout: EDITABLE_BUDGET_MS * 4,
  });
  await expect(editor.locator('.fb-section p.fb-p').first()).toBeVisible();
  const editableAfterMs = Date.now() - started;
  annotate(`editable after ${editableAfterMs} ms`);
  expect
    .soft(editableAfterMs, 'time until the Body view is editable')
    .toBeLessThan(EDITABLE_BUDGET_MS);
  await expect
    .poll(() =>
      page.evaluate<boolean>(
        `typeof window.__mfbeTest?.tables?.grid === 'function' &&
         typeof window.__mfbeTest?.scripts?.selectRange === 'function' &&
         window.__mfbeTest.scripts.list().some((s) => s.id === 'tables.toggleRegular')`,
      ),
    )
    .toBe(true);
  await page.evaluate(INSTALL_HELPERS);
  return editableAfterMs;
}

/** The node ids the journeys start from, read from the opened model. */
interface BookIds {
  docId: string;
  /** The table of each of the first five sections that holds one, by section (from 1). */
  tables: Record<number, string>;
  /** The first paragraph of each of the first five sections, by section (from 1). */
  firstParagraph: Record<number, string>;
  /** The paragraphs of section 2, in order. */
  section2: string[];
  /** The paragraphs of section 3, in order. */
  section3: string[];
}

/** Read in the page: the model of the 10 MB book is not sent to the test. */
async function bookIds(page: Page): Promise<BookIds> {
  return page.evaluate<BookIds>(`(() => {
    const doc = window.__mfbeTest.scripts.document();
    const sections = doc.bodies[0].content.filter((node) => node.type === 'section');
    const paragraphs = (section) =>
      section.content.filter((node) => node.type === 'p').map((node) => node.attrs.nodeId);
    const tables = {};
    const firstParagraph = {};
    sections.slice(0, 5).forEach((section, index) => {
      const table = section.content.find((node) => node.type === 'table');
      if (table) tables[index + 1] = table.attrs.nodeId;
      firstParagraph[index + 1] = paragraphs(section)[0];
    });
    return {
      docId: doc.docId,
      tables,
      firstParagraph,
      section2: paragraphs(sections[1]),
      section3: paragraphs(sections[2]),
    };
  })()`);
}

/** The node id of the cell at `at` of the mounted table `ref`. */
async function cellId(page: Page, ref: string, at: Position): Promise<string> {
  const id = await page.evaluate<string | null>(
    `window.__perfTables.cell(${JSON.stringify(ref)}, ${at.row}, ${at.column})`,
  );
  expect(id, `cell r${at.row}c${at.column} of the table ${ref}`).toBeTruthy();
  return id!;
}

/** The caret at the end of the text block `nodeId` (the window moves there first). */
async function caretAt(page: Page, nodeId: string): Promise<void> {
  expect(
    await page.evaluate<boolean>(
      `window.__mfbeTest.scripts.select(${JSON.stringify(nodeId)}, 1e9, 1e9)`,
    ),
    `the caret in ${nodeId}`,
  ).toBe(true);
}

/**
 * The table `ref` of section `section` mounted - when the Body view's window holds another
 * section, the caret in the section's first paragraph moves it there - and the caret in its
 * cell `at`.
 */
async function caretInTable(
  page: Page,
  ref: string,
  section: number,
  at: Position,
  ids: BookIds,
): Promise<void> {
  const mounted = () =>
    page.evaluate<boolean>(
      `!!window.__perfTables.cell(${JSON.stringify(ref)}, ${at.row}, ${at.column})`,
    );
  if (!(await mounted())) {
    await caretAt(page, ids.firstParagraph[section]!);
    await expect.poll(mounted, { timeout: 60_000 }).toBe(true);
  }
  await caretAt(page, await cellId(page, ref, at));
}

/** The block of cells from `from` to `to` of the mounted table `ref`. */
async function selectBlock(page: Page, ref: string, from: Position, to: Position): Promise<void> {
  const anchor = await cellId(page, ref, from);
  const head = await cellId(page, ref, to);
  expect(
    await page.evaluate<boolean>(
      `window.__mfbeTest.scripts.selectRange(${JSON.stringify({ nodeId: anchor, offset: 0 })}, ${JSON.stringify({ nodeId: head, offset: 0 })})`,
    ),
  ).toBe(true);
  const cells = (to.row - from.row + 1) * (to.column - from.column + 1);
  await expect
    .poll(() =>
      page.evaluate<number>(
        `(() => { const t = window.__mfbeTest.tables.target(); return t && t.selection.type === 'cells' ? t.selection.cells.length : 0; })()`,
      ),
    )
    .toBe(cells);
}

function probeString(page: Page, probe: Probe): Promise<string> {
  return page.evaluate<string>(`window.__perfTables.probe(${JSON.stringify(probe)})`);
}

async function undoTo(page: Page, probe: Probe, expected: string, what: string): Promise<void> {
  const problem = await page.evaluate<string | null>(
    `window.__perfTables.undo(${JSON.stringify(probe)}, ${JSON.stringify(expected)})`,
  );
  expect(problem, `${what}: Undo`).toBeNull();
}

/** Waits until the button is enabled (the toolbar renders after the selection changed). */
async function enabled(page: Page, testId: string, what: string): Promise<void> {
  await expect(page.getByTestId(testId), what).toBeEnabled();
}

function checkTimed(timed: Timed, what: string): number {
  expect(timed.error ?? null, what).toBeNull();
  expect(timed.ms, what).toBeGreaterThan(0);
  return timed.ms;
}

/** The irregularity of the table `ref` (`__mfbeTest.tables.grid`). */
async function irregular(page: Page, ref: string): Promise<boolean> {
  return page.evaluate<boolean>(`(() => {
    const g = window.__mfbeTest.tables.grid(${JSON.stringify(ref)});
    return !!g && g.shortRows + g.overlaps + g.pastEnd > 0;
  })()`);
}

/** Median of 11 keystrokes at the end of the text block `nodeId`. */
async function typing(page: Page, nodeId: string): Promise<number[]> {
  await caretAt(page, nodeId);
  const before = await page.evaluate<string>(
    `document.querySelector('[data-node-id="${nodeId}"]').textContent`,
  );
  const samples: number[] = [];
  for (let i = 0; i < KEYSTROKES; i += 1)
    samples.push(await page.evaluate<number>(TYPE_AND_MEASURE));
  await expect
    .poll(() =>
      page.evaluate<string>(`document.querySelector('[data-node-id="${nodeId}"]').textContent`),
    )
    .toBe(`${before}${'x'.repeat(KEYSTROKES)}`);
  return samples;
}

/* ------------------------------------------------------------------------ */
/* The commands on one table                                                */
/* ------------------------------------------------------------------------ */

interface TableFigures {
  /** Per command: the median of the runs (100 ms tier) or the slowest run (1 s tier). */
  commands: Record<string, number>;
  pastes: Record<string, number>;
  runs: Record<string, number[]>;
}

/**
 * Times one action `t.runs` times on the table `t`: before each run `setup` (the selection and
 * any preparation), then the timed action, then - outside the time - Undo until the probe shows
 * the state after the setup again, and for `twice` a second Undo, of the preparation, until it
 * shows the state before the setup (`none`: an action that changes the selection only). The
 * median of the runs (100 ms tier) or the slowest run (1 s tier) is held to the budget.
 */
async function timeRuns(
  page: Page,
  t: TableCase,
  name: string,
  figures: TableFigures,
  options: {
    setup: () => Promise<void>;
    act: () => Promise<Timed>;
    probe: Probe;
    undo: 'none' | 'once' | 'twice';
  },
): Promise<void> {
  const samples: number[] = [];
  for (let run = 0; run < t.runs; run += 1) {
    const what = `${t.label}: ${name}, run ${run + 1}`;
    const original = await probeString(page, options.probe);
    await options.setup();
    const prepared = await probeString(page, options.probe);
    samples.push(checkTimed(await options.act(), what));
    if (options.undo === 'none') continue;
    await undoTo(page, options.probe, prepared, what);
    if (options.undo === 'twice') {
      await undoTo(page, options.probe, original, `${what} (the preparation)`);
    }
  }
  figures.runs[name] = samples.map(round);
  const value = t.tier === 'median' ? median(samples) : Math.max(...samples);
  const list = samples.map((s) => s.toFixed(0)).join(', ');
  annotate(
    `${t.label}: ${name} ${t.tier === 'median' ? 'median' : 'slowest'} ${value.toFixed(1)} ms (${list})`,
  );
  expect.soft(value, `${t.label}: ${name} (${list} ms)`).toBeLessThan(t.budgetMs);
  if (name.startsWith('paste.')) figures.pastes[name.slice('paste.'.length)] = round(value);
  else figures.commands[name] = round(value);
}

/**
 * Every command, `insert.table`, the two pastes and *Repair table* on the table `t`; the clips
 * of the block (from the 300 x 10 table) and of the table itself are taken first.
 */
async function timeTable(page: Page, t: TableCase, ids: BookIds): Promise<TableFigures> {
  const ref = ids.tables[t.section]!;
  const figures: TableFigures = { commands: {}, pastes: {}, runs: {} };
  const place = { kind: 'table', ref, row: t.place.row - 1, col: t.place.column - 1 } as const;

  // The block clip: rows 100-109, columns 1-5 of the 300 x 10 table, from a copy event.
  const ref300 = ids.tables[TABLES.table300.section]!;
  await caretInTable(page, ref300, TABLES.table300.section, BLOCK_SOURCE.from, ids);
  await selectBlock(page, ref300, BLOCK_SOURCE.from, BLOCK_SOURCE.to);
  const block = await page.evaluate<{ lines: number; fields: number; json: number }>(
    `window.__perfTables.copy('block')`,
  );
  expect(block).toMatchObject({ lines: 10, fields: 5 });
  expect(block.json).toBeGreaterThan(0);

  // The table's own clip: Select table and a copy event.
  await caretInTable(page, ref, t.section, t.place, ids);
  await enabled(page, 'toolbar-table.select', `${t.label}: Select table`);
  await page.evaluate(`document.querySelector('[data-testid="toolbar-table.select"]').click()`);
  await expect(page.locator(`[data-testid="body-table"][data-node-id="${ref}"]`)).toHaveClass(
    /\bfb-selected\b/,
  );
  const own = await page.evaluate<{ lines: number; fields: number; json: number }>(
    `window.__perfTables.copy('table')`,
  );
  expect(own.lines, `${t.label}: the copied table's rows`).toBe(t.rows);
  expect(own.json).toBeGreaterThan(0);

  const caret = async () => caretInTable(page, ref, t.section, t.place, ids);
  const blockAtPlace = async () => {
    await caret();
    await selectBlock(page, ref, t.place, { row: t.place.row + 2, column: t.place.column + 1 });
  };

  for (const command of COMMANDS) {
    const testId = `toolbar-table.${command}`;
    let probe: TableProbe = place;
    let setup = caret;
    let undo: 'none' | 'once' | 'twice' = 'once';
    if (BLOCK_COMMANDS.has(command)) setup = blockAtPlace;
    if (command === 'makeNormalCells') {
      // Normal cells need header cells: the block made header cells first (one more Undo).
      setup = async () => {
        await blockAtPlace();
        await enabled(page, 'toolbar-table.makeHeaderCells', `${t.label}: makeHeaderCells`);
        checkTimed(
          await page.evaluate<Timed>(
            `window.__perfTables.click('[data-testid="toolbar-table.makeHeaderCells"]', ${JSON.stringify(place)})`,
          ),
          `${t.label}: makeHeaderCells before makeNormalCells`,
        );
        await selectBlock(page, ref, t.place, { row: t.place.row + 2, column: t.place.column + 1 });
      };
      undo = 'twice';
    }
    if (command === 'splitCell') {
      probe = { kind: 'table', ref, row: t.merged.row - 1, col: t.merged.column - 1 };
      setup = async () => caretInTable(page, ref, t.section, t.merged, ids);
    }
    if (command === 'moveColumnLeft' || command === 'moveColumnRight') {
      const column = command === 'moveColumnLeft' ? t.columnMoves.left : t.columnMoves.right;
      probe = { kind: 'table', ref, row: t.place.row - 1, col: column - 1 };
      setup = async () => caretInTable(page, ref, t.section, { row: t.place.row, column }, ids);
    }
    if (command === 'select') undo = 'none';
    const finalSetup = setup;
    const finalProbe = probe;
    await test.step(`${t.label}: ${command}`, async () => {
      await timeRuns(page, t, command, figures, {
        setup: async () => {
          await finalSetup();
          await enabled(page, testId, `${t.label}: ${command}`);
        },
        act: () =>
          page.evaluate<Timed>(
            `window.__perfTables.click('[data-testid="${testId}"]', ${JSON.stringify(finalProbe)})`,
          ),
        probe: finalProbe,
        undo,
      });
    });
  }

  // Table... from the dialog's OK: the new table right after the caret's table (FR-004).
  await test.step(`${t.label}: insert.table`, async () => {
    await timeRuns(page, t, 'insert.table', figures, {
      setup: async () => {
        await caret();
        await enabled(page, 'toolbar-insert.table', `${t.label}: insert.table`);
        await page.evaluate(
          `document.querySelector('[data-testid="toolbar-insert.table"]').click()`,
        );
        await expect(page.getByTestId('dialog-table')).toBeVisible();
      },
      act: () =>
        page.evaluate<Timed>(
          `window.__perfTables.click('[data-testid="dialog-table-button-ok"]', ${JSON.stringify(place)})`,
        ),
      probe: place,
      undo: 'once',
    });
    await expect(page.getByTestId('dialog-table')).toHaveCount(0);
  });

  // The 10 x 5 block pasted into the place's cell (the paste-block plan; FR-012).
  await test.step(`${t.label}: paste of a block into a cell`, async () => {
    await timeRuns(page, t, 'paste.block', figures, {
      setup: caret,
      act: () =>
        page.evaluate<Timed>(`window.__perfTables.paste('block', ${JSON.stringify(place)})`),
      probe: place,
      undo: 'once',
    });
  });

  // Repair table, last, on the table made irregular by the fixture script (one undo step).
  await test.step(`${t.label}: repair`, async () => {
    await caret();
    const run = await page.evaluate<{ status: string }>(
      `window.__mfbeTest.scripts.run('tables.toggleRegular')`,
    );
    expect(run.status).toBe('done');
    await expect.poll(() => irregular(page, ref)).toBe(true);
    await expect(page.locator(`[data-testid="body-table"][data-node-id="${ref}"]`)).toHaveAttribute(
      'data-irregular',
      'true',
    );
    await timeRuns(page, t, 'repair', figures, {
      setup: async () => {
        await caret();
        await enabled(page, 'toolbar-table.repair', `${t.label}: repair`);
      },
      act: () =>
        page.evaluate<Timed>(
          `window.__perfTables.click('[data-testid="toolbar-table.repair"]', ${JSON.stringify(place)})`,
        ),
      probe: place,
      undo: 'once',
    });
    // The script's run undone: the table regular again.
    await page.evaluate(`document.querySelector('[data-testid="toolbar-edit.undo"]').click()`);
    await expect.poll(() => irregular(page, ref), { timeout: 60_000 }).toBe(false);
  });

  // The table's own copy pasted after a paragraph of section 2 (a new table at the FR-004 point).
  await test.step(`${t.label}: paste of the table after a paragraph of section 2`, async () => {
    const paragraph = ids.section2[PASTE_PARAGRAPH - 1]!;
    const after: NextProbe = { kind: 'next', id: paragraph };
    await timeRuns(page, t, 'paste.table', figures, {
      setup: async () => caretAt(page, paragraph),
      act: () =>
        page.evaluate<Timed>(`window.__perfTables.paste('table', ${JSON.stringify(after)})`),
      probe: after,
      undo: 'once',
    });
  });
  return figures;
}

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('performance - table commands in the 10 MB book (SC-005)', { tag: '@perf' }, () => {
  let dir: string;
  let book: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-perf-tables-'));
    book = path.join(dir, 'tables-10mb.fb2');
    const result = spawnSync('python3', [GENERATOR, '--out', book, ...BOOK_OPTIONS], {
      encoding: 'utf8',
    });
    if (result.status !== 0) book = '';
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    // The worker's settings as found: the original Commands layout, the dialog's first values.
    await core
      .rpc('settings.set', {
        patch: { session: { toolbarLayouts: { commands: null }, tableDialog: null } },
      })
      .catch(() => {});
  });

  for (const key of ['table300', 'table628', 'table298'] as const) {
    const t = TABLES[key];
    test(`${t.label}: every command and paste within 100 ms x MFBE_PERF_FACTOR (median of ${t.runs}); typing elsewhere afterwards within 100 ms`, async ({
      core,
      page,
    }) => {
      await requirements(core, book);
      test.setTimeout(TABLE_TIMEOUT_MS);
      if (key === 'table300') rmSync(RESULTS_FILE, { force: true });
      const openMs = await openBook(core, page, book);
      const ids = await bookIds(page);
      const figures = await timeTable(page, t, ids);
      const keystrokes = await typing(page, ids.section2[TYPING_PARAGRAPH - 1]!);
      const typed = median(keystrokes);
      annotate(
        `typing in section 2 after the ${t.label} commands: median ${typed.toFixed(1)} ms (${keystrokes.map((s) => s.toFixed(0)).join(', ')})`,
      );
      expect
        .soft(
          typed,
          `typing after the ${t.label} commands (${keystrokes.map((s) => s.toFixed(0)).join(', ')} ms)`,
        )
        .toBeLessThan(KEYSTROKE_BUDGET_MS);
      recordResults({
        [key]: figures.commands,
        pastes: { [key]: figures.pastes },
        typing: { [`section2After_${key}`]: round(typed) },
        recorded: { [`open_${key}`]: openMs },
      });
    });
  }

  test('1000 x 20: every command and paste within 1 s; typing in its cell within 100 ms x MFBE_PERF_FACTOR; typing elsewhere afterwards within 100 ms', async ({
    core,
    page,
  }) => {
    await requirements(core, book);
    test.setTimeout(LARGE_TABLE_TIMEOUT_MS);
    const t = TABLES.table1000;
    const openMs = await openBook(core, page, book);
    const ids = await bookIds(page);
    const figures = await timeTable(page, t, ids);
    const ref = ids.tables[t.section]!;

    // Typing in a cell of the 1000 x 20 table with every table button on the toolbar (U20).
    await caretInTable(page, ref, t.section, t.place, ids);
    const cell = await cellId(page, ref, t.place);
    const inCell = await typing(page, cell);
    const cellMedian = median(inCell);
    annotate(
      `typing in a cell of the 1000 x 20 table: median ${cellMedian.toFixed(1)} ms (${inCell.map((s) => s.toFixed(0)).join(', ')})`,
    );
    expect
      .soft(
        cellMedian,
        `typing in a cell of the 1000 x 20 table (${inCell.map((s) => s.toFixed(0)).join(', ')} ms)`,
      )
      .toBeLessThan(INTERACTION_BUDGET_MS * PERF_FACTOR);

    // Recorded: a keystroke in a paragraph of section 3 pays the window's write-back (R1.9).
    const inSection3 = await typing(page, ids.section3[TYPING_PARAGRAPH - 1]!);
    const section3Median = median(inSection3);
    annotate(
      `typing in a paragraph of section 3 (the window of the 1000 x 20 table; recorded): median ${section3Median.toFixed(1)} ms (${inSection3.map((s) => s.toFixed(0)).join(', ')})`,
    );

    const keystrokes = await typing(page, ids.section2[TYPING_PARAGRAPH - 1]!);
    const typed = median(keystrokes);
    annotate(
      `typing in section 2 after the 1000 x 20 commands: median ${typed.toFixed(1)} ms (${keystrokes.map((s) => s.toFixed(0)).join(', ')})`,
    );
    expect
      .soft(
        typed,
        `typing after the 1000 x 20 commands (${keystrokes.map((s) => s.toFixed(0)).join(', ')} ms)`,
      )
      .toBeLessThan(KEYSTROKE_BUDGET_MS);
    recordResults({
      table1000: figures.commands,
      pastes: { table1000: figures.pastes },
      typing: { section2After_table1000: round(typed), cellOf_table1000: round(cellMedian) },
      recorded: {
        open_table1000: openMs,
        keystrokeSection3: round(section3Median),
        writeBackSection3: round(section3Median - typed),
      },
    });
  });

  test('the Source view: Add > Table available within 3 s x MFBE_PERF_FACTOR; the text-form validation of an irregular table recorded', async ({
    core,
    page,
  }) => {
    await requirements(core, book);
    test.setTimeout(SOURCE_TIMEOUT_MS);
    const openMs = await openBook(core, page, book);
    const ids = await bookIds(page);
    const t = TABLES.table300;
    const ref = ids.tables[t.section]!;

    // The text form of doc.validate: the book's text with the 300 x 10 table regular, then
    // irregular (the fixture script's short row); positions are read for table.irregular.
    const regularText = await page.evaluate<string>('window.__mfbeTest.scripts.toXml()');
    await caretInTable(page, ref, t.section, t.place, ids);
    const run = await page.evaluate<{ status: string }>(
      `window.__mfbeTest.scripts.run('tables.toggleRegular')`,
    );
    expect(run.status).toBe('done');
    await expect.poll(() => irregular(page, ref)).toBe(true);
    const irregularText = await page.evaluate<string>('window.__mfbeTest.scripts.toXml()');
    expect(irregularText).not.toBe(regularText);
    interface Report {
      errorCount: number;
      issues: { code: string; line?: number; column?: number }[];
    }
    const validate = async (text: string): Promise<{ ms: number; report: Report }> => {
      const started = performance.now();
      const report = await core.rpcJob<Report>('doc.validate', { docId: ids.docId, text }, 120_000);
      return { ms: performance.now() - started, report };
    };
    const regularTimes: number[] = [];
    const irregularTimes: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const regular = await validate(regularText);
      expect(regular.report.issues.filter((issue) => issue.code === 'table.irregular')).toEqual([]);
      regularTimes.push(regular.ms);
      const ragged = await validate(irregularText);
      const warnings = ragged.report.issues.filter((issue) => issue.code === 'table.irregular');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.line).toBeGreaterThan(0);
      expect(warnings[0]!.column).toBeGreaterThan(0);
      irregularTimes.push(ragged.ms);
    }
    const regularMs = median(regularTimes);
    const irregularMs = median(irregularTimes);
    annotate(
      `doc.validate {text} of the book (recorded): ${regularMs.toFixed(0)} ms with the 300 x 10 table regular (${regularTimes.map((s) => s.toFixed(0)).join(', ')}), ${irregularMs.toFixed(0)} ms irregular (${irregularTimes.map((s) => s.toFixed(0)).join(', ')}); the budget the assistant's validations are held to: ${VALIDATION_BUDGET_MS * PERF_FACTOR} ms`,
    );
    await page.evaluate(`document.querySelector('[data-testid="toolbar-edit.undo"]').click()`);
    await expect.poll(() => irregular(page, ref), { timeout: 60_000 }).toBe(false);

    // Add > Table in the Source view: the caret in a cell first (no table may stand there), then
    // the cursor between two paragraphs of section 100 as soon as the view is ready.
    await caretInTable(page, ref, t.section, t.place, ids);
    const switched = Date.now();
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready', {
      timeout: 60_000,
    });
    const readyMs = Date.now() - switched;
    const offset = await page.evaluate<number>(`(() => {
      const text = window.__mfbeTest.sourceMapping.sourceText();
      const section = text.indexOf('<section id="s100">');
      const title = text.indexOf('</title>', section);
      return text.indexOf('</p>', title + 8) + 4;
    })()`);
    expect(offset).toBeGreaterThan(4);
    const available = await page.evaluate<{ ms: number; enabledBefore: boolean }>(
      `window.__perfTables.sourceTableAvailable(${offset})`,
    );
    annotate(
      `Source view ready after ${readyMs} ms; Add > Table available ${available.ms.toFixed(0)} ms after the cursor was put between two elements (enabled before: ${available.enabledBefore})`,
    );
    expect(available.ms, 'Add > Table became available').toBeGreaterThan(0);
    expect
      .soft(available.ms, 'Add > Table available in the Source view')
      .toBeLessThan(SOURCE_AVAILABLE_BUDGET_MS * PERF_FACTOR);
    recordResults({
      recorded: {
        open_source: openMs,
        validateTextRegular: round(regularMs),
        validateTextIrregular: round(irregularMs),
        validateTextPositions: round(irregularMs - regularMs),
        sourceReady: readyMs,
        sourceAddTableAvailable: round(available.ms),
      },
    });
  });
});
