/**
 * Feature 006, User Story 9 - Whole tables and the text around them (T137; FR-005, FR-032,
 * FR-033, FR-043, FR-045; US9 sc.1 to sc.5; C24, C47; U22; SC-007; data-model §4.5
 * `table.select`, `table.delete`, `table.paragraphBefore` / `table.paragraphAfter`, §8.7, open
 * point 3; quickstart §9 manual steps 1 to 6 and "Automated"; research R2.11, vR2 X3).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode. Each test opens `tests/fixtures/books/tables.fb2` through File → Open and a
 * queued `dialog.openFile` (one test writes a small book of its own), with the clipboard
 * permissions granted, and works on the tables of its containers (T012, T014):
 *  - the user story 9 sections of "Scenario tables": a titled and an untitled section whose only
 *    content is a table, a section whose table ends it, a section whose table starts its text
 *    and is followed by a paragraph, a section with a paragraph, a table and a paragraph;
 *  - the "Places" section's section annotation that holds only a table, and its cite whose table
 *    stands before a text-author line;
 *  - the Body view's annotation and history blocks (feature 004), each holding a regular table
 *    first.
 *
 * After **every** step that changes the document, Edit → Undo gives back the whole document XML
 * byte for byte and Edit → Redo the step's result (`undoRedo`; SC-007, U22). The caret's place
 * is read through `status-path` and the Body selection of the source mapping hook.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { pageText } from './fixtures/i18n';
import { MOD } from './fixtures/keys';

/* ------------------------------------------------------------------------ */
/* The page's hooks and the model JSON                                      */
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
}

interface ModelPoint {
  nodeId: string;
  offset: number;
}

interface TableSummary {
  rows: number;
  columns: number;
  shortRows: number;
  overlaps: number;
  pastEnd: number;
}

interface ComputedStyle {
  outlineStyle: string;
  outlineWidth: string;
}

declare const window: {
  __mfbeTest?: {
    scripts?: {
      document(): DocJson;
      toXml(): Promise<string>;
      select(nodeId: string, from?: number, to?: number): boolean;
    };
    sourceMapping?: {
      bodySelection(): { anchor: ModelPoint; head: ModelPoint } | null;
    };
    tables?: {
      grid(tableRef: string): TableSummary | null;
    };
  };
};

declare function getComputedStyle(element: unknown): ComputedStyle;

const TABLES = fixtureBook('tables.fb2');

/** The section titles of the containers (`tables.fb2`, T012 and T014). */
const TITLED = 'US9 sc.1, sc.3, sc.4: a titled section whose only content is a table';
const ENDS = 'US9 sc.3, sc.4: a table that ends its section';
const STARTS = "US9 sc.3 to sc.5: a table that starts the section's text";
const BETWEEN = 'US9 sc.2, sc.5: a paragraph, a table and a paragraph';
const ANNOTATION = 'A table alone in a section annotation';
const CITE = 'A table in a cite';

/** The containers of sc.1 (T137). */
type Place =
  | 'titled'
  | 'untitled'
  | 'ends'
  | 'starts'
  | 'between'
  | 'annotation'
  | 'cite'
  | 'annotationBlock'
  | 'historyBlock';

const PLACES: readonly Place[] = [
  'titled',
  'untitled',
  'ends',
  'starts',
  'between',
  'annotation',
  'cite',
  'annotationBlock',
  'historyBlock',
];

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

/** Every node of the bodies, in document order, with its parent's children. */
function* walk(node: Json): Generator<{ node: Json; siblings: Json[]; index: number }> {
  const children = node.content ?? [];
  for (let index = 0; index < children.length; index += 1) {
    yield { node: children[index]!, siblings: children, index };
    yield* walk(children[index]!);
  }
}

/** The section whose title reads `title`, with its siblings. */
function sectionTitled(
  doc: DocJson,
  title: string,
): { node: Json; siblings: Json[]; index: number } {
  for (const body of doc.bodies) {
    for (const found of walk(body)) {
      const first = found.node.content?.[0];
      if (found.node.type === 'section' && first?.type === 'title' && textOf(first) === title) {
        return found;
      }
    }
  }
  throw new Error(`no section titled "${title}"`);
}

/** The section of a place, or null for the Body view's blocks. */
function sectionOf(doc: DocJson, place: Place): Json | null {
  switch (place) {
    case 'titled':
      return sectionTitled(doc, TITLED).node;
    case 'untitled': {
      const { siblings, index } = sectionTitled(doc, TITLED);
      return siblings[index + 1]!;
    }
    case 'ends':
      return sectionTitled(doc, ENDS).node;
    case 'starts':
      return sectionTitled(doc, STARTS).node;
    case 'between':
      return sectionTitled(doc, BETWEEN).node;
    case 'annotation':
      return sectionTitled(doc, ANNOTATION).node;
    case 'cite':
      return sectionTitled(doc, CITE).node;
    default:
      return null;
  }
}

/** The direct container of a place's table in the model: a section, an annotation or a cite. */
function containerOf(doc: DocJson, place: Place): Json {
  const section = sectionOf(doc, place);
  if (!section) throw new Error(`${place} has no model container`);
  if (place === 'annotation') return section.content!.find((child) => child.type === 'annotation')!;
  if (place === 'cite') return section.content!.find((child) => child.type === 'cite')!;
  return section;
}

/** The node id of the paragraph of `container` whose text is `text`. */
function paragraphIn(container: Json, text: string): string {
  for (const { node } of walk(container)) {
    if (node.type === 'p' && textOf(node) === text) return node.attrs!.nodeId!;
  }
  throw new Error(`no paragraph "${text}"`);
}

/** A table of the Body view: its node id, element and cells' node ids in reading order. */
interface PlacedTable {
  place: Place;
  ref: string;
  element: Locator;
  cells: string[];
}

/** The `[data-testid=body-table]` of a place, found by its `data-node-id`. */
async function tableIn(page: Page, place: Place): Promise<PlacedTable> {
  let ref: string;
  if (place === 'annotationBlock' || place === 'historyBlock') {
    const block = place === 'annotationBlock' ? 'body-block-annotation' : 'body-block-history';
    const first = page.getByTestId(block).locator('[data-testid="body-table"]').first();
    ref = (await first.getAttribute('data-node-id'))!;
  } else {
    const container = containerOf(await documentOf(page), place);
    ref = container.content!.find((child) => child.type === 'table')!.attrs!.nodeId!;
  }
  const element = page.locator(`[data-testid="body-table"][data-node-id="${ref}"]`);
  await expect(element, `the table of ${place} in the Body view`).toHaveCount(1);
  const cells = await element
    .locator('td.fb-td, th.fb-th')
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        (node as unknown as { getAttribute(name: string): string }).getAttribute('data-node-id'),
      ),
    );
  return { place, ref, element, cells };
}

/** The tab-separated text of the 2 × 2 and 2 × 3 tables of the fixture (`r<row>c<column>`). */
function tsv(rows: number, columns: number): string {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: columns }, (_, c) => `r${r + 1}c${c + 1}`).join('\t'),
  ).join('\n');
}

/** The fixture's table of a place as tab-separated text. */
function placeTsv(place: Place): string {
  return place === 'annotationBlock' || place === 'historyBlock' ? tsv(2, 3) : tsv(2, 2);
}

/* ------------------------------------------------------------------------ */
/* Page helpers                                                             */
/* ------------------------------------------------------------------------ */

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/**
 * The test ids of user story 9's four entries in *Add → Table structure*, written out: the
 * evidence of their rows in `docs/parity-matrix.md` (`tools/parity-check.mjs`).
 */
const US9_ENTRIES: Readonly<Record<string, string>> = {
  select: 'menu-add-tableStructure-select',
  delete: 'menu-add-tableStructure-delete',
  paragraphBefore: 'menu-add-tableStructure-paragraphBefore',
  paragraphAfter: 'menu-add-tableStructure-paragraphAfter',
};

/** The test id of the entry of *Add → Table structure* for the command `name`. */
function entryId(name: string): string {
  return US9_ENTRIES[name] ?? `menu-add-tableStructure-${name}`;
}

/** The entry of *Add → Table structure* for the command `name`, its submenu open. */
async function structureEntry(page: Page, name: string): Promise<Locator> {
  await page.getByTestId('menu-add').click();
  await page.getByTestId('menu-add-tableStructure').click();
  await expect(page.getByTestId('menu-add-tableStructure-popup')).toBeVisible();
  return page.getByTestId(entryId(name));
}

/** Runs `name` from *Add → Table structure*: `menu-add-tableStructure-<name>`. */
async function structure(page: Page, name: string): Promise<void> {
  const entry = await structureEntry(page, name);
  await expect(entry).not.toHaveAttribute('aria-disabled');
  await entry.click();
}

/** Closes the open menus. */
async function closeMenus(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu-add-popup')).toHaveCount(0);
}

/** `tables.fb2` (or another book) through File → Open and the queued native dialog. */
async function openBook(core: CoreHandle, page: Page, file = TABLES): Promise<void> {
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await menu(page, 'file', 'open');
  await waitForBook(page, file);
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

/** The caret at `offset` of the text block (or cell) with the node id `nodeId`. */
async function caretIn(page: Page, nodeId: string, offset = 0): Promise<void> {
  const placed = await page.evaluate(([id, at]) => window.__mfbeTest!.scripts!.select(id, at, at), [
    nodeId,
    offset,
  ] as const);
  expect(placed, `the caret in ${nodeId}`).toBe(true);
}

/** The editor holds the focus again (after a menu), its selection kept. */
async function focusEditor(page: Page): Promise<void> {
  await page.getByTestId('body-editor').focus();
  await expect(page.getByTestId('body-editor')).toBeFocused();
}

/** The Body selection's head as a model point. */
async function headOf(page: Page): Promise<ModelPoint | undefined> {
  return page.evaluate(() => window.__mfbeTest!.sourceMapping!.bodySelection()?.head);
}

/** `status-path` once the caret stands at `offset` of `nodeId`. */
async function pathAt(page: Page, nodeId: string, offset = 0): Promise<string> {
  await caretIn(page, nodeId, offset);
  await expect.poll(() => headOf(page)).toEqual({ nodeId, offset });
  return (await page.getByTestId('status-path').innerText()).trim();
}

/**
 * Edit → Undo gives back `before`, the whole document XML, byte for byte, and Edit → Redo the
 * step's result `after` (SC-007, U22).
 */
async function undoRedo(page: Page, before: string, after: string): Promise<void> {
  await menu(page, 'edit', 'undo');
  await expect.poll(() => toXml(page), { message: 'one Undo restores the XML' }).toBe(before);
  await menu(page, 'edit', 'redo');
  await expect.poll(() => toXml(page), { message: 'one Redo applies it again' }).toBe(after);
}

/** One more Edit → Undo, back to `xml`. */
async function undoTo(page: Page, xml: string): Promise<void> {
  await menu(page, 'edit', 'undo');
  await expect.poll(() => toXml(page)).toBe(xml);
}

/** The XML once the document changed from `before`. */
async function changedFrom(page: Page, before: string): Promise<string> {
  await expect
    .poll(() => toXml(page), { message: 'the step changed the document' })
    .not.toBe(before);
  return toXml(page);
}

/** Whether Edit → Undo is unavailable: its `aria-disabled`, read with the Edit menu open. */
async function undoDisabled(page: Page): Promise<string | null> {
  await page.getByTestId('menu-edit').click();
  const entry = page.getByTestId('menu-edit-undo');
  await expect(entry).toBeVisible();
  const state = await entry.getAttribute('aria-disabled');
  await page.keyboard.press('Escape');
  await expect(entry).toHaveCount(0);
  return state;
}

/** *Select table* with the caret in the table's first cell: the table carries `fb-selected`. */
async function selectTable(page: Page, table: PlacedTable): Promise<void> {
  await caretIn(page, table.cells[0]!, 1);
  await structure(page, 'select');
  await expect(table.element).toHaveClass(/\bfb-selected\b/);
  await focusEditor(page);
}

/** The table of a place is gone from the Body view. */
async function gone(page: Page, table: PlacedTable): Promise<void> {
  await expect(page.locator(`[data-testid="body-table"][data-node-id="${table.ref}"]`)).toHaveCount(
    0,
  );
}

/**
 * The children of a place's container, as `type` or `p:<text>`; in the Body view's blocks their
 * paragraphs and tables (the block's caption is a decoration, not content).
 */
async function shapeOf(page: Page, place: Place): Promise<string[]> {
  if (place === 'annotationBlock' || place === 'historyBlock') {
    const block = place === 'annotationBlock' ? 'body-block-annotation' : 'body-block-history';
    return page
      .getByTestId(block)
      .locator(':scope > p.fb-p, :scope > table')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const element = node as unknown as { textContent: string | null; tagName: string };
          return element.tagName === 'TABLE' ? 'table' : `p:${element.textContent ?? ''}`;
        }),
      );
  }
  const container = containerOf(await documentOf(page), place);
  return (container.content ?? []).map((child) =>
    child.type === 'p' ? `p:${textOf(child)}` : child.type,
  );
}

/** What stays of a place's container once its table went, and the empty paragraph it may get. */
const AFTER_DELETE: Record<Place, string[]> = {
  // A section's content needs a block: an empty p takes the table's place (C24).
  titled: ['title', 'p:'],
  untitled: ['p:'],
  ends: ['title', 'p:The table below ends the section.'],
  starts: ['title', 'p:A paragraph after the table.'],
  between: ['title', 'p:A paragraph before the table.', 'p:A paragraph after the table.'],
  // `annotationType` allows no child: no p (brief §8).
  annotation: [],
  // The text-author line stays.
  cite: ["p:The cite's paragraph.", 'text-author'],
  annotationBlock: [],
  historyBlock: [],
};

/** A valid book of the `book()` pattern whose history holds only a 2 × 2 table. */
function historyBook(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us9-'));
  const file = path.join(dir, 'history-table.fb2');
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>History table</book-title>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>maker</nickname></author>
<date value="2026-01-01">2026</date>
<id>us9-history-0001</id>
<version>1.0</version>
<history><table><tr><td>h1</td><td>h2</td></tr><tr><td>h3</td><td>h4</td></tr></table></history>
</document-info>
</description>
<body>
<section><p>Only text.</p></section>
</body>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('US9 (feature 006) - whole tables and the text around them', () => {
  const errors: string[] = [];

  test.beforeEach(async ({ core, page, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    // The AI panel hidden for the page load, so the views have their full width.
    await core.rpc('settings.set', { patch: { session: { aiPanelVisible: false } } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    errors.length = 0;
    page.on('pageerror', (error) => errors.push(error.message));
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    await core
      .rpc('settings.set', { patch: { session: { aiPanelVisible: true } } })
      .catch(() => {});
    // No step throws (ProseMirror's deleteSelection does on a section's only table, vR2 X3).
    expect(errors).toEqual([]);
  });

  test('sc.1: Select table outlines the table in every container, changes nothing and records no undo step; the cell, row and column commands say why they are unavailable; Copy gives the tab-separated text', async ({
    core,
    page,
  }) => {
    test.setTimeout(process.env.CI ? 240_000 : 120_000);
    await openBook(core, page);
    const fixture = await toXml(page);
    expect(await undoDisabled(page)).toBe('true');
    const title = 'Insert row below: the whole table is selected; place the caret in a cell';
    for (const place of PLACES) {
      const table = await tableIn(page, place);
      await selectTable(page, table);
      // The 2 px accent outline of a selected table (T037).
      const outline = await table.element.evaluate((element) => {
        const style = getComputedStyle(element);
        return { style: style.outlineStyle, width: style.outlineWidth };
      });
      expect(outline, place).toEqual({ style: 'solid', width: '2px' });
      expect(await toXml(page), place).toBe(fixture);
      expect(await undoDisabled(page), place).toBe('true');
      // With the table selected, a row command says why it is unavailable (data-model open
      // point 3); the whole-table commands stay enabled.
      await expect(table.element).toHaveClass(/\bfb-selected\b/);
      const entry = await structureEntry(page, 'insertRowBelow');
      await expect(entry).toHaveAttribute('aria-disabled', 'true');
      await expect(entry).toHaveAttribute('title', title);
      await expect(entry).toHaveAttribute('aria-description', title);
      for (const name of ['select', 'delete', 'paragraphBefore', 'paragraphAfter']) {
        await expect(page.getByTestId(entryId(name)), name).not.toHaveAttribute('aria-disabled');
      }
      await closeMenus(page);
      await focusEditor(page);
      // Copy leaves the document as it is; the clipboard's text is the table's tab-separated
      // text (FR-060).
      await page.evaluate("navigator.clipboard.writeText('')");
      await page.keyboard.press(`${MOD}+c`);
      await expect
        .poll(() => page.evaluate<string>('navigator.clipboard.readText()'), { message: place })
        .toBe(placeTsv(place));
      expect(await toXml(page), place).toBe(fixture);
    }
  });

  test('sc.1 and C24: Cut, Delete, Backspace and typing over a selected table in every container, each one undo step; an empty paragraph only where the container needs a block', async ({
    core,
    page,
  }) => {
    test.setTimeout(process.env.CI ? 360_000 : 180_000);
    await openBook(core, page);
    const fixture = await toXml(page);
    for (const place of PLACES) {
      const table = await tableIn(page, place);
      const before = await shapeOf(page, place);
      const expected =
        place === 'annotationBlock' || place === 'historyBlock'
          ? before.filter((_, index) => index !== before.indexOf('table'))
          : AFTER_DELETE[place];

      // Cut: the table goes to the clipboard and leaves the document.
      await selectTable(page, table);
      await page.keyboard.press(`${MOD}+x`);
      const cut = await changedFrom(page, fixture);
      await gone(page, table);
      expect(await shapeOf(page, place), `${place}: cut`).toEqual(expected);
      await expect
        .poll(() => page.evaluate<string>('navigator.clipboard.readText()'))
        .toBe(placeTsv(place));
      await undoRedo(page, fixture, cut);
      await undoTo(page, fixture);

      // Delete, and after Undo, Backspace.
      for (const key of ['Delete', 'Backspace']) {
        await selectTable(page, table);
        await page.keyboard.press(key);
        const deleted = await changedFrom(page, fixture);
        await gone(page, table);
        expect(await shapeOf(page, place), `${place}: ${key}`).toEqual(expected);
        // The same transform as the cut's (C24).
        expect(deleted, `${place}: ${key} gives the cut's document`).toBe(cut);
        await undoRedo(page, fixture, deleted);
        await undoTo(page, fixture);
      }

      // Typing over the selected table: a paragraph holding the text takes its place, the caret
      // after it; one Undo gives the table back (data-model §4.5 `table.select`).
      await selectTable(page, table);
      await page.keyboard.type('x');
      const typed = await changedFrom(page, fixture);
      await gone(page, table);
      const at = before.indexOf('table');
      const replaced = [...before];
      replaced[at] = 'p:x';
      expect(await shapeOf(page, place), `${place}: typed`).toEqual(replaced);
      const head = await headOf(page);
      expect(head?.offset, place).toBe(1);
      await expect(page.getByTestId('status-path')).toHaveText(/\/p\[\d+\]$/);
      await undoRedo(page, fixture, typed);
      await undoTo(page, fixture);
    }
  });

  test('C24: Delete on the only table of the history block leaves an empty paragraph there', async ({
    core,
    page,
  }) => {
    const file = historyBook();
    await openBook(core, page, file);
    const block = page.getByTestId('body-block-history');
    await expect(block.locator('[data-testid="body-table"]')).toHaveCount(1);
    const table = await tableIn(page, 'historyBlock');
    const before = await toXml(page);
    await selectTable(page, table);
    await page.keyboard.press('Delete');
    const after = await changedFrom(page, before);
    await gone(page, table);
    // `history_block` takes (…)+: an empty paragraph, with the caret in it.
    expect(await shapeOf(page, 'historyBlock')).toEqual(['p:']);
    await expect(page.getByTestId('status-path')).toHaveText(
      /^document-info\/history\[1\]\/p\[1\]$/,
    );
    // The table left the FB2 text too (a history of one empty paragraph is written as none,
    // as today).
    expect(after).not.toContain('<td>h1</td>');
    expect(after).not.toContain('<table>');
    await undoRedo(page, before, after);
  });

  test('sc.3: Delete table puts the caret into the empty paragraph that takes the table’s place, else at the start of the element that followed, else at the end of the one before, else at the nearest text position', async ({
    core,
    page,
  }) => {
    test.setTimeout(process.env.CI ? 180_000 : 90_000);
    await openBook(core, page);
    const fixture = await toXml(page);
    const doc = await documentOf(page);
    const followers: { place: Place; next: string; offset: (text: string) => number }[] = [
      // A paragraph follows: the caret at its start.
      {
        place: 'between',
        next: paragraphIn(containerOf(doc, 'between'), 'A paragraph after the table.'),
        offset: () => 0,
      },
      {
        place: 'starts',
        next: paragraphIn(containerOf(doc, 'starts'), 'A paragraph after the table.'),
        offset: () => 0,
      },
      // The table ends its section: the end of the element before it.
      {
        place: 'ends',
        next: paragraphIn(containerOf(doc, 'ends'), 'The table below ends the section.'),
        offset: (text) => text.length,
      },
    ];
    for (const { place, next, offset } of followers) {
      const table = await tableIn(page, place);
      const text = 'The table below ends the section.';
      const at = offset(text);
      const expectedPath = await pathAt(page, next, at);
      await caretIn(page, table.cells[table.cells.length - 1]!, 2);
      await structure(page, 'delete');
      const after = await changedFrom(page, fixture);
      await gone(page, table);
      await expect.poll(() => headOf(page), place).toEqual({ nodeId: next, offset: at });
      await expect(page.getByTestId('status-path')).toHaveText(expectedPath);
      await undoRedo(page, fixture, after);
      await undoTo(page, fixture);
    }

    // A section's only table, untitled and titled: the caret in the empty paragraph that takes
    // its place - not at the end of the title before it (analyze decision 5).
    for (const place of ['untitled', 'titled'] as const) {
      const table = await tableIn(page, place);
      await caretIn(page, table.cells[0]!, 1);
      await structure(page, 'delete');
      const after = await changedFrom(page, fixture);
      await gone(page, table);
      const section = containerOf(await documentOf(page), place);
      const empty = section.content!.find((child) => child.type === 'p')!;
      expect(textOf(empty), place).toBe('');
      await expect
        .poll(() => headOf(page), place)
        .toEqual({
          nodeId: empty.attrs!.nodeId!,
          offset: 0,
        });
      await expect(page.getByTestId('status-path')).toHaveText(/\/p\[1\]$/);
      await undoRedo(page, fixture, after);
      await undoTo(page, fixture);
    }

    // The section annotation's only table leaves no paragraph: the nearest text position after
    // it, the first text block after that annotation.
    const annotationTable = await tableIn(page, 'annotation');
    const textAfter = paragraphIn(
      sectionOf(doc, 'annotation')!,
      "The section's text after its annotation.",
    );
    const expectedPath = await pathAt(page, textAfter, 0);
    await caretIn(page, annotationTable.cells[0]!, 1);
    await structure(page, 'delete');
    const after = await changedFrom(page, fixture);
    await gone(page, annotationTable);
    expect(await shapeOf(page, 'annotation')).toEqual([]);
    await expect.poll(() => headOf(page)).toEqual({ nodeId: textAfter, offset: 0 });
    await expect(page.getByTestId('status-path')).toHaveText(expectedPath);
    await undoRedo(page, fixture, after);
  });

  test('sc.2: a copied table pastes at the FR-004 point without the ids the book uses, at the first point of a section from its title, is refused in the body’s title; a cut table keeps its ids; an irregular copy keeps its grid and its mark', async ({
    core,
    page,
  }) => {
    test.setTimeout(process.env.CI ? 240_000 : 120_000);
    await openBook(core, page);
    const fixture = await toXml(page);
    const doc = await documentOf(page);
    // The table the links of "Cells and formatting" target: `id="t-linked"`, one row.
    let linked: Json | null = null;
    for (const body of doc.bodies) {
      for (const { node } of walk(body)) {
        if (node.type === 'table' && node.attrs?.id === 't-linked') linked = node;
      }
    }
    const linkedRef = linked!.attrs!.nodeId!;
    const linkedCell = linked!.content![0]!.content![0]!.attrs!.nodeId!;
    const element = page.locator(`[data-testid="body-table"][data-node-id="${linkedRef}"]`);
    await caretIn(page, linkedCell, 1);
    await structure(page, 'select');
    await expect(element).toHaveClass(/\bfb-selected\b/);
    await focusEditor(page);
    await page.keyboard.press(`${MOD}+c`);
    await expect
      .poll(() => page.evaluate<string>('navigator.clipboard.readText()'))
      .toBe('r1c1\tr1c2');

    // The caret at the end of a paragraph of another section; Edit → Paste: the copy right after
    // it (FR-004 (a)), without the id the book still uses (C47), the caret in its first cell.
    const between = containerOf(doc, 'between');
    const label = 'A paragraph before the table.';
    const paragraph = paragraphIn(between, label);
    await caretIn(page, paragraph, label.length);
    await menu(page, 'edit', 'paste');
    const pasted = await changedFrom(page, fixture);
    const copy = '<table><tr><td>r1c1</td><td>r1c2</td></tr></table>';
    const flat = (xml: string) => xml.replace(/>\s+</g, '><');
    expect(flat(pasted)).toContain(`<p>${label}</p>${copy}<table>`);
    expect(flat(pasted)).toContain('<table id="t-linked">');
    const copied = containerOf(await documentOf(page), 'between').content![2]!;
    expect(copied.type).toBe('table');
    const firstCell = copied.content![0]!.content![0]!.attrs!.nodeId!;
    await expect.poll(() => headOf(page)).toEqual({ nodeId: firstCell, offset: 0 });
    await expect(page.getByTestId('status-path')).toHaveText(/\/tr\[1\]\/td\[1\]$/);
    await undoRedo(page, fixture, pasted);
    await undoTo(page, fixture);

    // The caret in a section's title: the first point of that section's content, after its
    // heading part (FR-004 (b)).
    const endsSection = sectionOf(doc, 'ends')!;
    const endsTitle = endsSection.content![0]!.content![0]!.attrs!.nodeId!;
    await caretIn(page, endsTitle, 3);
    await focusEditor(page);
    await page.keyboard.press(`${MOD}+v`);
    const titled = await changedFrom(page, fixture);
    expect(flat(titled)).toContain(`<title><p>${ENDS}</p></title>${copy}<p>`);
    await undoRedo(page, fixture, titled);
    await undoTo(page, fixture);

    // The caret in the main body's own title: no table may stand there; the paste is refused
    // with the status-bar message, the XML stays and no undo step comes with it.
    const bodyTitle = doc.bodies[0]!.content!.find((child) => child.type === 'title')!;
    await caretIn(page, bodyTitle.content![0]!.attrs!.nodeId!, 2);
    await focusEditor(page);
    await page.keyboard.press(`${MOD}+v`);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'tables.msg.pasteNoPlace'),
    );
    expect(await toXml(page)).toBe(fixture);
    expect(await undoDisabled(page)).toBe('true');

    // Cut of the whole table moves its ids (data-model §8.7): pasted after the paragraph, it
    // keeps `id="t-linked"`.
    await caretIn(page, linkedCell, 1);
    await structure(page, 'select');
    await focusEditor(page);
    await page.keyboard.press(`${MOD}+x`);
    const cut = await changedFrom(page, fixture);
    expect(flat(cut)).not.toContain('<table id="t-linked">');
    await caretIn(page, paragraph, label.length);
    await focusEditor(page);
    await page.keyboard.press(`${MOD}+v`);
    const moved = await changedFrom(page, cut);
    expect(flat(moved)).toContain(
      `<p>${label}</p><table id="t-linked"><tr><td>r1c1</td><td>r1c2</td></tr></table><table>`,
    );
    await undoRedo(page, cut, moved);
    await undoTo(page, cut);
    await undoTo(page, fixture);

    // The irregular short-row table of "Vector tables" (`id="t2"`): its copy keeps its grid,
    // carries the mark and has no id, since the book still uses t2 (analyze decision 4; C47).
    let t2: Json | null = null;
    for (const body of doc.bodies) {
      for (const { node } of walk(body)) {
        if (node.type === 'table' && node.attrs?.id === 't2') t2 = node;
      }
    }
    const t2Cell = t2!.content![0]!.content![0]!.attrs!.nodeId!;
    const t2Element = page.locator(
      `[data-testid="body-table"][data-node-id="${t2!.attrs!.nodeId!}"]`,
    );
    await caretIn(page, t2Cell, 0);
    await structure(page, 'select');
    await expect(t2Element).toHaveClass(/\bfb-selected\b/);
    await focusEditor(page);
    await page.keyboard.press(`${MOD}+c`);
    await caretIn(page, paragraph, label.length);
    await focusEditor(page);
    await page.keyboard.press(`${MOD}+v`);
    const irregular = await changedFrom(page, fixture);
    const pastedT2 = containerOf(await documentOf(page), 'between').content![2]!;
    expect(pastedT2.type).toBe('table');
    expect(pastedT2.attrs?.id ?? null).toBeNull();
    const summary = await page.evaluate(
      (ref) => window.__mfbeTest!.tables!.grid(ref),
      pastedT2.attrs!.nodeId!,
    );
    expect(summary).toMatchObject({ rows: 3, columns: 3, shortRows: 1 });
    await expect(
      page
        .locator(`[data-testid="body-table"][data-node-id="${pastedT2.attrs!.nodeId!}"]`)
        .locator('[data-testid="body-table-mark"]'),
    ).toHaveCount(1);
    await undoRedo(page, fixture, irregular);
  });

  test('sc.4: Paragraph after table and Paragraph before table put an empty paragraph next to the table, the caret in it, in a section, on a section’s only table, in the history block and in a cite', async ({
    core,
    page,
  }) => {
    test.setTimeout(process.env.CI ? 240_000 : 120_000);
    await openBook(core, page);
    const fixture = await toXml(page);
    const cases: { place: Place; command: 'paragraphAfter' | 'paragraphBefore' }[] = [
      { place: 'ends', command: 'paragraphAfter' },
      { place: 'starts', command: 'paragraphBefore' },
      { place: 'titled', command: 'paragraphAfter' },
      { place: 'titled', command: 'paragraphBefore' },
      { place: 'untitled', command: 'paragraphBefore' },
      { place: 'historyBlock', command: 'paragraphAfter' },
      { place: 'historyBlock', command: 'paragraphBefore' },
      { place: 'cite', command: 'paragraphAfter' },
      { place: 'cite', command: 'paragraphBefore' },
    ];
    for (const { place, command } of cases) {
      const table = await tableIn(page, place);
      const before = await shapeOf(page, place);
      await caretIn(page, table.cells[1]!, 1);
      await structure(page, command);
      const after = await changedFrom(page, fixture);
      const at = before.indexOf('table');
      const expected = [...before];
      expected.splice(command === 'paragraphAfter' ? at + 1 : at, 0, 'p:');
      expect(await shapeOf(page, place), `${place}: ${command}`).toEqual(expected);
      // The table itself is untouched, the caret in the new paragraph.
      await expect(table.element).toHaveCount(1);
      const head = await headOf(page);
      expect(head?.offset, `${place}: ${command}`).toBe(0);
      await expect(page.getByTestId('status-path')).toHaveText(/\/p\[\d+\]$/);
      await expect(
        page.locator(`p[data-node-id="${head!.nodeId}"]`),
        `${place}: ${command}`,
      ).toHaveText('');
      // Directly before or after the table.
      const sibling = await table.element.evaluate((node, after) => {
        const element = node as unknown as {
          nextElementSibling: { getAttribute(name: string): string | null } | null;
          previousElementSibling: { getAttribute(name: string): string | null } | null;
        };
        const next = after ? element.nextElementSibling : element.previousElementSibling;
        return next?.getAttribute('data-node-id') ?? null;
      }, command === 'paragraphAfter');
      expect(sibling, `${place}: ${command}`).toBe(head!.nodeId);
      await undoRedo(page, fixture, after);
      await undoTo(page, fixture);
    }
  });

  test('sc.5: ArrowDown in the last row and ArrowUp in the first row leave the table into the adjacent paragraphs', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    const doc = await documentOf(page);
    const between = containerOf(doc, 'between');
    const before = paragraphIn(between, 'A paragraph before the table.');
    const after = paragraphIn(between, 'A paragraph after the table.');
    const table = await tableIn(page, 'between');
    const afterPath = await pathAt(page, after, 0);
    const beforePath = await pathAt(page, before, 0);
    // The caret in the table's last row: Down goes to the following paragraph.
    await caretIn(page, table.cells[3]!, 2);
    await focusEditor(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await headOf(page))?.nodeId).toBe(after);
    await expect(page.getByTestId('status-path')).toHaveText(afterPath);
    // In its first row: Up goes to the preceding one.
    await caretIn(page, table.cells[0]!, 2);
    await focusEditor(page);
    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await headOf(page))?.nodeId).toBe(before);
    await expect(page.getByTestId('status-path')).toHaveText(beforePath);
  });
});
