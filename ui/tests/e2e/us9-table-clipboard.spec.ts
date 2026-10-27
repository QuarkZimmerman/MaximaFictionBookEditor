/**
 * Feature 006, User Story 9 - tables from and to other programs (T138, T139; FR-004 for pastes,
 * FR-012, FR-046, FR-059, FR-060; US9 sc.6, sc.7; SC-012; decisions 4, 5, 7; C39 to C46; R5.9;
 * U22, U28, U30, U32; data-model §8.2 to §8.9; `contracts/resource-formats.md` §20; quickstart
 * §9 manual step 7 and "Automated", §12; research R5.14).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode. Most tests write a small valid book (the `book()` pattern of
 * `us7-images.spec.ts`): its first section holds one labelled paragraph per clipboard fixture,
 * a labelled 2 × 2 target table and a few labelled paragraphs - every paragraph of the book
 * starts with "§", so the blocks a paste adds after a label are the siblings up to the next
 * "§" -, its second section a title and a paragraph. `tables.fb2` serves the paste into the
 * user story 4 paste target (T014).
 *
 * The nine fixtures of `tests/fixtures/clipboard/` (T018) are read from disk with their
 * `<name>.expected.json` and pasted by a synthetic `paste` event carrying their `text/html` and
 * a `text/plain` on `body-editor` (the pattern of `us2-body-editing.spec.ts`). The blocks a
 * paste adds are read twice and compared with `blocks`: from the Body DOM (`p.fb-p` paragraphs;
 * tables with their rows, `th.fb-th` / `td.fb-td` cells, `colspan` and `rowspan` above 1,
 * `align`, `valign` and the sorted mark types of the `strong`, `em`, `s`, `sub`, `sup`, `code`
 * and `a` elements in a cell) and from the document's FB2 text (`__mfbeTest.scripts.toXml()`).
 * A paste of text and tables at the end of a paragraph keeps today's handling of paragraphs
 * (FR-059): its first paragraph joins the paragraph at the caret, as every multi-paragraph
 * paste does (`mixed.html`).
 *
 * After every paste one Edit → Undo gives back the whole document XML byte for byte and one
 * Edit → Redo the paste's result (`undoRedo`; U22).
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import {
  expect,
  fileNew,
  fixtureBook,
  recordOutside,
  test,
  waitForBook,
  type CoreHandle,
} from './fixtures/core';
import { MOD } from './fixtures/keys';

/* ------------------------------------------------------------------------ */
/* Fixtures and the model JSON                                              */
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

declare const window: {
  __mfbeTest?: {
    scripts?: {
      document(): DocJson;
      toXml(): Promise<string>;
      select(nodeId: string, from?: number, to?: number): boolean;
    };
    sourceMapping?: {
      bodySelection(): { anchor: ModelPoint; head: ModelPoint } | null;
      select(anchor: number, head?: number): boolean;
      sourceText(): string | null;
    };
    tables?: {
      grid(tableRef: string): TableSummary | null;
    };
  };
};

/** A cell of `<name>.expected.json` (`tests/fixtures/clipboard/README.md`). */
interface ExpectedCell {
  k: 'td' | 'th';
  t: string;
  cs?: number;
  rs?: number;
  al?: string;
  va?: string;
  m?: string[];
}

type ExpectedBlock =
  { p: { text: string; marks?: string[] } } | { table: { rows: ExpectedCell[][] } };

interface Expected {
  blocks: ExpectedBlock[];
  tsv: string;
}

const FIXTURES = [
  'word-win',
  'writer',
  'calc',
  'excel-win',
  'gdocs',
  'gsheets',
  'firefox-web',
  'irregular-web',
  'mixed',
] as const;

type Fixture = (typeof FIXTURES)[number] | 'web-source';

const CLIPBOARD_DIR = path.resolve(path.dirname(fixtureBook('x')), '..', 'clipboard');
const TINY_PNG = path.resolve(path.dirname(fixtureBook('x')), '..', 'images', 'tiny.png');

function html(name: Fixture): string {
  return readFileSync(path.join(CLIPBOARD_DIR, `${name}.html`), 'utf8');
}

function expected(name: Fixture): Expected {
  return JSON.parse(
    readFileSync(path.join(CLIPBOARD_DIR, `${name}.expected.json`), 'utf8'),
  ) as Expected;
}

/** The expected tables of a fixture, in order. */
function expectedTables(name: Fixture): ExpectedCell[][][] {
  return expected(name).blocks.flatMap((block) => ('table' in block ? [block.table.rows] : []));
}

/** The label paragraph of a fixture in the book of `clipboardBook`. */
function labelOf(name: Fixture): string {
  return `§ Paste of ${name}:`;
}

const TARGET_LABEL = '§ The target table:';
const AFTER_TARGET = '§ After the target table.';
const SELECTED = '§ Selected text here.';
const PLAIN_LABEL = '§ Plain text here:';
const COPY_TARGET = '§ Copy-out target.';
const SECOND_TITLE = 'Second section';
const SECOND_TEXT = 'Text of the second section.';

/**
 * A valid book (the `book()` pattern): the first section holds one labelled paragraph per
 * fixture, the 2 × 2 target table (`t11` … `t22`) after its label, a paragraph after it, a
 * paragraph for a selection, a label and an empty paragraph for plain text, and a copy-out
 * target; the second section a title and a paragraph.
 */
function clipboardBook(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us9-clipboard-'));
  const file = path.join(dir, 'clipboard.fb2');
  const labels = [...FIXTURES, 'web-source' as const]
    .map((name) => `<p>${labelOf(name)}</p>`)
    .join('\n');
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Clipboard</book-title>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>maker</nickname></author>
<date value="2026-01-01">2026</date>
<id>us9-clipboard-0001</id>
<version>1.0</version>
</document-info>
</description>
<body>
<section>
${labels}
<p>${TARGET_LABEL}</p>
<table><tr><td>t11</td><td>t12</td></tr><tr><td>t21</td><td>t22</td></tr></table>
<p>${AFTER_TARGET}</p>
<p>${SELECTED}</p>
<p>${PLAIN_LABEL}</p>
<p/>
<p>${COPY_TARGET}</p>
</section>
<section>
<title><p>${SECOND_TITLE}</p></title>
<p>${SECOND_TEXT}</p>
</section>
</body>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

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

/** The node id of the first paragraph whose text starts with `text`. */
function paragraphId(doc: DocJson, text: string): string {
  for (const body of doc.bodies) {
    for (const { node } of walk(body)) {
      if (node.type === 'p' && textOf(node).startsWith(text)) return node.attrs!.nodeId!;
    }
  }
  throw new Error(`no paragraph "${text}"`);
}

/** The model table right after the paragraph whose text starts with `label`. */
function tableAfter(doc: DocJson, label: string, skip = 0): Json {
  for (const body of doc.bodies) {
    for (const { node, siblings, index } of walk(body)) {
      if (node.type === 'p' && textOf(node).startsWith(label)) {
        let seen = 0;
        for (let at = index + 1; at < siblings.length; at += 1) {
          const next = siblings[at]!;
          if (next.type === 'p' && textOf(next).startsWith('§')) break;
          if (next.type === 'table') {
            if (seen === skip) return next;
            seen += 1;
          }
        }
      }
    }
  }
  throw new Error(`no table after the paragraph "${label}"`);
}

/** The model cells of a table, row by row. */
function cellRows(table: Json): Json[][] {
  return (table.content ?? [])
    .filter((row) => row.type === 'tr')
    .map((row) => (row.content ?? []).filter((cell) => cell.type === 'td' || cell.type === 'th'));
}

/* ------------------------------------------------------------------------ */
/* Reading the blocks a paste added                                         */
/* ------------------------------------------------------------------------ */

/**
 * Browser-side readers (the e2e tsconfig has no DOM lib, hence strings). `cellOf` and `blockOf`
 * turn a Body element or an FB2 element into the shape of `<name>.expected.json`.
 */
const READERS = `
  const MARKS = { strong: 'strong', em: 'emphasis', emphasis: 'emphasis', s: 'strikethrough',
    strikethrough: 'strikethrough', sub: 'sub', sup: 'sup', code: 'code', a: 'link' };
  const name = (element) => element.localName.toLowerCase();
  const marksOf = (element) => {
    const found = new Set();
    for (const inner of element.getElementsByTagName('*')) {
      const mark = MARKS[name(inner)];
      if (mark) found.add(mark);
    }
    return [...found].sort();
  };
  const cellOf = (cell, body) => {
    const kind = name(cell);
    const out = { k: body && !cell.classList.contains('fb-' + kind) ? 'no-fb-class' : kind,
      t: cell.textContent };
    const span = (attr) => {
      const value = cell.getAttribute(attr);
      return value === null ? undefined : Number(value);
    };
    const cs = span('colspan');
    const rs = span('rowspan');
    if (cs !== undefined && cs > 1) out.cs = cs;
    if (rs !== undefined && rs > 1) out.rs = rs;
    const al = cell.getAttribute('align');
    const va = cell.getAttribute('valign');
    if (al !== null) out.al = al;
    if (va !== null) out.va = va;
    const marks = marksOf(cell);
    if (marks.length > 0) out.m = marks;
    return out;
  };
  const rowsOf = (table, body) => {
    const rows = [];
    for (const group of table.children) {
      const rowElements = name(group) === 'tr' ? [group]
        : name(group) === 'tbody' ? [...group.children] : [];
      for (const row of rowElements) {
        if (name(row) !== 'tr') continue;
        rows.push([...row.children].filter((cell) => name(cell) === 'td' || name(cell) === 'th')
          .map((cell) => cellOf(cell, body)));
      }
    }
    return rows;
  };
  const blockOf = (element, body) => {
    if (name(element) === 'table') return { table: { rows: rowsOf(element, body) } };
    const marks = marksOf(element);
    return { p: marks.length > 0 ? { text: element.textContent, marks }
      : { text: element.textContent } };
  };
  const isBlock = (element) => name(element) === 'p' || name(element) === 'table';
  const after = (label) => {
    const blocks = [];
    for (let node = label.nextElementSibling; node; node = node.nextElementSibling) {
      if (!isBlock(node)) continue;
      if (name(node) === 'p' && node.textContent.startsWith('§')) break;
      blocks.push(node);
    }
    return blocks;
  };
`;

/** The blocks after the label paragraph `labelId` in the Body DOM, and the label's text. */
async function domBlocksAfter(
  page: Page,
  labelId: string,
): Promise<{ label: string; blocks: ExpectedBlock[] }> {
  return page.evaluate<{ label: string; blocks: ExpectedBlock[] }>(`(() => {
    ${READERS}
    const editor = document.querySelector('[data-testid="body-editor"]');
    const label = editor.querySelector('p[data-node-id=${JSON.stringify(labelId)}]');
    return { label: label.textContent, blocks: after(label).map((node) => blockOf(node, true)) };
  })()`);
}

/** The blocks after the paragraph that starts with `label` in the FB2 text `xml`. */
async function xmlBlocksAfter(
  page: Page,
  xml: string,
  label: string,
): Promise<{ label: string; blocks: ExpectedBlock[] }> {
  return page.evaluate<{ label: string; blocks: ExpectedBlock[] }>(`(() => {
    ${READERS}
    const doc = new DOMParser().parseFromString(${JSON.stringify(xml)}, 'application/xml');
    const label = [...doc.getElementsByTagName('*')].find((element) =>
      name(element) === 'p' && element.textContent.startsWith(${JSON.stringify(label)}));
    return { label: label.textContent, blocks: after(label).map((node) => blockOf(node, false)) };
  })()`);
}

/** The rows of a Body table element, in the shape of `expected.json`. */
async function domRows(table: Locator): Promise<ExpectedCell[][]> {
  await expect(table).toHaveCount(1);
  const ref = await table.getAttribute('data-node-id');
  return table.page().evaluate<ExpectedCell[][]>(`(() => {
    ${READERS}
    return rowsOf(document.querySelector('[data-testid="body-table"][data-node-id=${JSON.stringify(ref)}]'), true);
  })()`);
}

/**
 * The blocks of a fixture as a paste after its label gives them: as `blocks`, or - for a paste
 * whose first block is a paragraph that joins the label (`mixed.html`) - the rest, and the
 * label's text with that paragraph's.
 */
function pasteResult(name: Fixture): { label: string; blocks: ExpectedBlock[] } {
  const { blocks } = expected(name);
  // A single table - with at most its caption before it and blank paragraphs around it - goes
  // to the FR-004 point after the label; text and tables together keep today's handling of
  // paragraphs, so their first paragraph joins the label.
  const tables = blocks.filter((block) => 'table' in block).length;
  const at = blocks.findIndex((block) => 'table' in block);
  const blank = (block: ExpectedBlock) => 'p' in block && !/[^\s\u00a0]/.test(block.p.text);
  const single =
    tables === 1 &&
    blocks.every((block, index) => 'table' in block || index === at - 1 || blank(block));
  const first = blocks[0]!;
  if (!single && 'p' in first && tables > 0) {
    return { label: `${labelOf(name)}${first.p.text}`, blocks: blocks.slice(1) };
  }
  return { label: labelOf(name), blocks };
}

/* ------------------------------------------------------------------------ */
/* Page helpers                                                             */
/* ------------------------------------------------------------------------ */

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/** Runs `name` from *Edit → Table structure*: `menu-edit-tableStructure-<name>`. */
async function structure(page: Page, name: string): Promise<void> {
  await page.getByTestId('menu-edit').click();
  await page.getByTestId('menu-edit-tableStructure').click();
  await expect(page.getByTestId('menu-edit-tableStructure-popup')).toBeVisible();
  const entry = page.getByTestId(`menu-edit-tableStructure-${name}`);
  await expect(entry).not.toHaveAttribute('aria-disabled');
  await entry.click();
}

/** A book through File → Open and the queued native dialog; the hooks ready. */
async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
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

/** The caret at the end of the paragraph that starts with `text`. */
async function caretAtEnd(page: Page, text: string): Promise<string> {
  const doc = await documentOf(page);
  const id = paragraphId(doc, text);
  let length = 0;
  for (const body of doc.bodies) {
    for (const { node } of walk(body)) {
      if (node.attrs?.nodeId === id) length = textOf(node).length;
    }
  }
  await caretIn(page, id, length);
  return id;
}

/** The editor holds the focus again (after a menu), its selection kept. */
async function focusEditor(page: Page): Promise<void> {
  await page.getByTestId('body-editor').focus();
  await expect(page.getByTestId('body-editor')).toBeFocused();
}

/** A synthetic paste event on `body-editor` carrying these flavours (and a PNG file). */
async function pasteEvent(
  page: Page,
  flavours: { html?: string; text?: string; png?: boolean },
): Promise<void> {
  const png = flavours.png ? readFileSync(TINY_PNG).toString('base64') : null;
  const args = { html: flavours.html ?? null, text: flavours.text ?? null, png };
  await page.evaluate(`((args) => {
    const data = new DataTransfer();
    if (args.html !== null) data.setData('text/html', args.html);
    if (args.text !== null) data.setData('text/plain', args.text);
    if (args.png !== null) {
      const bytes = Uint8Array.from(atob(args.png), (c) => c.charCodeAt(0));
      data.items.add(new File([bytes], 'tiny.png', { type: 'image/png' }));
    }
    const target = document.querySelector('[data-testid="body-editor"]');
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  })(${JSON.stringify(args)})`);
}

/** A fixture pasted by a synthetic event with its HTML and a plain-text flavour. */
async function pasteFixture(page: Page, name: Fixture, extra: { png?: boolean } = {}) {
  await pasteEvent(page, { html: html(name), text: expected(name).tsv, ...extra });
}

/**
 * Edit → Undo gives back `before`, the whole document XML, byte for byte, and Edit → Redo the
 * step's result `after` (U22).
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

/** The `body-table` element of a model table. */
function tableElement(page: Page, table: Json): Locator {
  return page.locator(`[data-testid="body-table"][data-node-id="${table.attrs!.nodeId!}"]`);
}

/** The grid summary of a table: regular, and no mark shown. */
async function regular(page: Page, table: Json): Promise<void> {
  const summary = await page.evaluate(
    (ref) => window.__mfbeTest!.tables!.grid(ref),
    table.attrs!.nodeId!,
  );
  expect(summary, `the grid of ${table.attrs!.nodeId!}`).toMatchObject({
    shortRows: 0,
    overlaps: 0,
    pastEnd: 0,
  });
  await expect(tableElement(page, table).locator('[data-testid="body-table-mark"]')).toHaveCount(0);
}

/** Save As to `file` through the queued native dialog. */
async function saveAs(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.saveFile', { path: file, encoding: 'utf-8' });
  await menu(page, 'file', 'saveAs');
  const prompt = page.getByTestId('dialog-validation-failed');
  await expect
    .poll(
      async () =>
        (await prompt.count()) > 0 ||
        /saved|found/i.test(await page.getByTestId('status-message').innerText()),
    )
    .toBe(true);
  if ((await prompt.count()) > 0)
    await page.getByTestId('dialog-validation-failed-button-yes').click();
  await waitForBook(page, file);
}

/** The block of the target table between two cells: a click and a Shift+click. */
async function shiftBlock(from: Locator, to: Locator): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const box = (await from.boundingBox())!;
  await from.click({ position: { x: box.width - 3, y: box.height / 2 } });
  await to.click({ modifiers: ['Shift'] });
  await expect(to).toHaveClass(/\bmfbe-cell-selected\b/);
}

/** The target table's cell whose text is `text`. */
function targetCell(page: Page, target: Json, text: string): Locator {
  const cell = cellRows(target)
    .flat()
    .find((one) => textOf(one) === text)!;
  return page.locator(`:is(td.fb-td, th.fb-th)[data-node-id="${cell.attrs!.nodeId!}"]`);
}

/* ------------------------------------------------------------------------ */
/* T138: tables pasted from other programs                                  */
/* ------------------------------------------------------------------------ */

test.describe('US9 (feature 006) - tables pasted from other programs', () => {
  test.beforeEach(async ({ core, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    // The AI panel hidden for the page load, so the views have their full width.
    await core.rpc('settings.set', { patch: { session: { aiPanelVisible: false } } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    await core
      .rpc('settings.set', { patch: { session: { aiPanelVisible: true } } })
      .catch(() => {});
  });

  test('sc.6 and SC-012: each fixture pasted after its paragraph gives exactly its blocks - regular FB2 tables with their header cells, spans, alignment and formatting -, one Undo and one Redo each; saved, reopened and validated, no error and no irregular table', async ({
    core,
    page,
  }) => {
    test.setTimeout(process.env.CI ? 360_000 : 180_000);
    const file = clipboardBook();
    await openBook(core, page, file);
    let before = await toXml(page);
    for (const name of FIXTURES) {
      const labelId = await caretAtEnd(page, labelOf(name));
      await pasteFixture(page, name);
      const after = await changedFrom(page, before);
      const want = pasteResult(name);
      expect(await domBlocksAfter(page, labelId), `${name}: the Body view`).toEqual(want);
      expect(await xmlBlocksAfter(page, after, labelOf(name)), `${name}: the FB2 text`).toEqual(
        want,
      );
      // Regular, without a mark: a table from another program never arrives as a repair
      // candidate (C42; analyze decision 4).
      const doc = await documentOf(page);
      for (let index = 0; index < expectedTables(name).length; index += 1) {
        await regular(page, tableAfter(doc, labelOf(name), index));
      }
      await undoRedo(page, before, after);
      before = after;
    }

    // Saved, reopened and validated: no error and no `table.irregular`; the tables are there.
    const saved = path.join(path.dirname(file), 'clipboard-saved.fb2');
    await saveAs(core, page, saved);
    await fileNew(page);
    await core.enqueueDialog('dialog.openFile', { paths: [saved] });
    await menu(page, 'file', 'open');
    await waitForBook(page, saved);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    const tables = FIXTURES.reduce((sum, name) => sum + expectedTables(name).length, 0);
    await expect(page.locator('[data-testid="body-table"]')).toHaveCount(tables + 1);
    await page.getByTestId('body-editor').focus();
    await page.keyboard.press('F8');
    await expect(page.getByTestId('validation-panel')).toBeVisible();
    await expect(
      page.locator('[data-testid="validation-empty"], [data-testid^="validation-issue-"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid^="validation-issue-"][data-severity="error"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid^="validation-issue-"][data-code="table.irregular"]'),
    ).toHaveCount(0);
    const reopened = await toXml(page);
    for (const name of FIXTURES) {
      expect(await xmlBlocksAfter(page, reopened, labelOf(name)), `${name}: reopened`).toEqual(
        pasteResult(name),
      );
    }
  });

  test('decision 5: mixed.html pasted into a cell of the user story 4 paste target joins that cell as one inline run; the table is not split', async ({
    core,
    page,
  }) => {
    await openBook(core, page, fixtureBook('tables.fb2'));
    const label = 'US4 sc.6, sc.8 (the paste target)';
    const doc = await documentOf(page);
    let target: Json | null = null;
    for (const body of doc.bodies) {
      for (const { node, siblings, index } of walk(body)) {
        if (node.type === 'p' && textOf(node) === label) target = siblings[index + 1]!;
      }
    }
    const cell = cellRows(target!)[1]![1]!;
    const before = await toXml(page);
    const tablesBefore = await page.locator('[data-testid="body-table"]').count();
    await caretIn(page, cell.attrs!.nodeId!, 'r2c2'.length);
    await pasteFixture(page, 'mixed');
    const after = await changedFrom(page, before);
    // The parts in order, single spaces between them; the tables give their cells' text in
    // reading order, with their formatting.
    const joined =
      'Opening paragraph with bold text. Key Value alpha 1 Middle paragraph with a link. x y z Closing paragraph.';
    const element = page.locator(`td.fb-td[data-node-id="${cell.attrs!.nodeId!}"]`);
    await expect(element).toHaveText(`r2c2${joined}`);
    await expect(element.locator('strong')).toHaveText('bold');
    await expect(element.locator('a')).toHaveText('link');
    await expect(element.locator('em')).toHaveText('y');
    const table = tableElement(page, target!);
    await expect(table.locator('tr')).toHaveCount(3);
    await expect(table.locator('td.fb-td, th.fb-th')).toHaveCount(9);
    await expect(page.locator('[data-testid="body-table"]')).toHaveCount(tablesBefore);
    await regular(page, target!);
    await undoRedo(page, before, after);
  });

  test('FR-012, C44, U30: a foreign table pasted into a cell overwrites and grows the target from there, its caption before the table; over a block it anchors at the block’s top-left; over the selected table it takes its place', async ({
    core,
    page,
  }) => {
    test.setTimeout(process.env.CI ? 180_000 : 90_000);
    await openBook(core, page, clipboardBook());
    const fixture = await toXml(page);
    const doc = await documentOf(page);
    const target = tableAfter(doc, TARGET_LABEL);
    const element = tableElement(page, target);
    const rows = expectedTables('firefox-web')[0]!;
    const caption = { p: { text: 'Inner planets', marks: ['emphasis'] } };
    const empty: ExpectedCell = { k: 'td', t: '' };
    const td = (t: string): ExpectedCell => ({ k: 'td', t });

    // The caret in t21: rows 2 to 6 and columns 1 to 3 take the pasted cells; the table grows
    // by four rows and a column.
    await caretIn(page, cellRows(target)[1]![0]!.attrs!.nodeId!, 1);
    await pasteFixture(page, 'firefox-web');
    const inCell = await changedFrom(page, fixture);
    expect(await domRows(element)).toEqual([[td('t11'), td('t12'), empty], ...rows]);
    const label = await domBlocksAfter(page, paragraphId(doc, TARGET_LABEL));
    expect(label.blocks[0]).toEqual(caption);
    expect(label.blocks[1]).toEqual({ table: { rows: [[td('t11'), td('t12'), empty], ...rows] } });
    await regular(page, target);
    await undoRedo(page, fixture, inCell);
    await undoTo(page, fixture);

    // Over the block t12-t22: anchored at its top-left position, row 1, column 2.
    await shiftBlock(targetCell(page, target, 't12'), targetCell(page, target, 't22'));
    await focusEditor(page);
    await pasteFixture(page, 'firefox-web');
    const overBlock = await changedFrom(page, fixture);
    const [r0, r1, r2, r3, r4] = rows;
    expect(await domRows(element)).toEqual([
      [td('t11'), ...r0!],
      [td('t21'), ...r1!],
      [empty, ...r2!],
      [empty, ...r3!],
      [empty, ...r4!],
    ]);
    await regular(page, target);
    await undoRedo(page, fixture, overBlock);
    await undoTo(page, fixture);

    // The target selected with Select table: the pasted table takes its place, its caption
    // before it.
    await caretIn(page, cellRows(target)[0]![0]!.attrs!.nodeId!, 1);
    await structure(page, 'select');
    await expect(element).toHaveClass(/\bfb-selected\b/);
    await focusEditor(page);
    await pasteFixture(page, 'firefox-web');
    const replaced = await changedFrom(page, fixture);
    await expect(element).toHaveCount(0);
    const placed = await domBlocksAfter(page, paragraphId(doc, TARGET_LABEL));
    expect(placed.blocks).toEqual([caption, { table: { rows } }]);
    await undoRedo(page, fixture, replaced);
  });

  test('C41, FR-004 (b): mixed.html in a section’s title is flattened into title lines in its order; calc.html there stands at the first point of the section’s content', async ({
    core,
    page,
  }) => {
    await openBook(core, page, clipboardBook());
    const fixture = await toXml(page);
    const titleLine = paragraphId(await documentOf(page), SECOND_TITLE);
    await caretIn(page, titleLine, SECOND_TITLE.length);
    await pasteFixture(page, 'mixed');
    const lines = await changedFrom(page, fixture);
    const section = (await documentOf(page)).bodies[0]!.content!.filter(
      (child) => child.type === 'section',
    )[1]!;
    const title = section.content![0]!;
    expect(title.type).toBe('title');
    expect(title.content!.map((line) => textOf(line))).toEqual([
      `${SECOND_TITLE}Opening paragraph with bold text.`,
      'Key',
      'Value',
      'alpha',
      '1',
      'Middle paragraph with a link.',
      'x',
      'y',
      'z',
      'Closing paragraph.',
    ]);
    expect(section.content!.map((child) => child.type)).toEqual(['title', 'p']);
    await undoRedo(page, fixture, lines);
    await undoTo(page, fixture);

    await caretIn(page, titleLine, 3);
    await pasteFixture(page, 'calc');
    const placed = await changedFrom(page, fixture);
    const flat = placed.replace(/>[ \t\r\n]+</g, '><');
    expect(flat).toContain(`<title><p>${SECOND_TITLE}</p></title><table>`);
    expect(flat).toContain(`</table><p>${SECOND_TEXT}</p></section>`);
    const calc = (await documentOf(page)).bodies[0]!.content!.filter(
      (child) => child.type === 'section',
    )[1]!.content![1]!;
    expect(calc.type).toBe('table');
    expect(await domRows(tableElement(page, calc))).toEqual(expectedTables('calc')[0]);
    await undoRedo(page, fixture, placed);
  });

  test('decision 4: a selection is replaced first and the table stands at the FR-004 point of the resulting caret; one Undo takes both', async ({
    core,
    page,
  }) => {
    await openBook(core, page, clipboardBook());
    const fixture = await toXml(page);
    const id = paragraphId(await documentOf(page), SELECTED);
    const selected = await page.evaluate(
      (nodeId) => window.__mfbeTest!.scripts!.select(nodeId, 0, 3),
      id,
    );
    expect(selected).toBe(true);
    await pasteFixture(page, 'word-win');
    const after = await changedFrom(page, fixture);
    const rest = SELECTED.slice(3);
    // The three characters are gone; offset 0 of a non-empty paragraph: the table before it,
    // the no-break-space paragraph kept with it (C45).
    const flat = after.replace(/>[ \t\r\n]+</g, '><');
    expect(flat).not.toContain(`<p>${SELECTED}</p>`);
    expect(flat).toContain(`<p>${AFTER_TARGET}</p><table>`);
    expect(flat).toMatch(
      new RegExp(`</table><p>(\u00a0|&#160;|&#xA0;|&nbsp;)</p><p>${rest}</p>`, 'i'),
    );
    await undoRedo(page, fixture, after);
  });

  test('R5.9: excel-win.html with a PNG beside it on the clipboard gives a table and no picture; nothing is uploaded', async ({
    core,
    page,
  }) => {
    await openBook(core, page, clipboardBook());
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/binary\b/.test(request.url()))
        posts.push(request.url());
    });
    const fixture = await toXml(page);
    const labelId = await caretAtEnd(page, labelOf('excel-win'));
    await pasteFixture(page, 'excel-win', { png: true });
    const after = await changedFrom(page, fixture);
    expect(await domBlocksAfter(page, labelId)).toEqual(pasteResult('excel-win'));
    await expect(page.locator('[data-testid="body-inline-image"]')).toHaveCount(0);
    await expect(page.locator('figure.fb-image')).toHaveCount(0);
    await undoRedo(page, fixture, after);
    expect(posts).toEqual([]);
  });

  test('U28: pasted HTML with external pictures and style sheets makes no request and brings no picture', async ({
    core,
    page,
    context,
  }) => {
    await openBook(core, page, clipboardBook());
    const origin = new URL(page.url()).origin;
    const outside = await recordOutside(context);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    let before = await toXml(page);
    for (const name of ['gdocs', 'firefox-web'] as const) {
      await caretAtEnd(page, labelOf(name));
      await pasteFixture(page, name);
      before = await changedFrom(page, before);
    }
    await expect(page.locator('[data-testid="body-inline-image"]')).toHaveCount(0);
    // Let any request the paste might have started arrive.
    await page.evaluate('new Promise((resolve) => setTimeout(resolve, 500))');
    const external = [
      'https://lh7-rt.googleusercontent.com/docsz/AD_4nXexample-picture-in-a-cell?key=fixture',
      'https://upload.example.org/thumb/planets/16px-planet.png',
      'https://example.org/static/site.css',
    ];
    for (const url of external) expect(requests, url).not.toContain(url);
    expect(requests.filter((url) => !url.startsWith(origin) && !/^(data|blob):/.test(url))).toEqual(
      [],
    );
    expect(outside).toEqual([]);
  });

  test('tab-separated plain text stays text: two paragraphs, no table', async ({ core, page }) => {
    await openBook(core, page, clipboardBook());
    const fixture = await toXml(page);
    const doc = await documentOf(page);
    const label = paragraphId(doc, PLAIN_LABEL);
    let empty = '';
    for (const body of doc.bodies) {
      for (const { node, siblings, index } of walk(body)) {
        if (node.attrs?.nodeId === label) empty = siblings[index + 1]!.attrs!.nodeId!;
      }
    }
    await caretIn(page, empty, 0);
    await pasteEvent(page, { text: 'a\tb\nc\td' });
    const after = await changedFrom(page, fixture);
    const section = (await documentOf(page)).bodies[0]!.content!.find(
      (child) => child.type === 'section',
    )!;
    const texts = section.content!.map((child) =>
      child.type === 'p' ? textOf(child) : child.type,
    );
    const at = texts.indexOf(PLAIN_LABEL);
    expect(texts.slice(at, at + 4)).toEqual([PLAIN_LABEL, 'a\tb', 'c\td', COPY_TARGET]);
    expect(texts.filter((one) => one === 'table')).toHaveLength(1);
    await undoRedo(page, fixture, after);
  });
});

/* ------------------------------------------------------------------------ */
/* T139: the live capture and copy out                                      */
/* ------------------------------------------------------------------------ */

/**
 * The tab-separated text of an expected grid (`contracts/resource-formats.md` §20, U32): one
 * line per grid row, the cells joined by tabs, a merged cell's text at its top-left position
 * and an empty field for each other position it covers, the lines joined by `\n` with none
 * after the last.
 */
function gridTsv(rows: ExpectedCell[][]): string {
  const covered: boolean[][] = rows.map(() => []);
  const fields: string[][] = rows.map(() => []);
  let width = 0;
  rows.forEach((cells, r) => {
    let c = 0;
    for (const cell of cells) {
      while (covered[r]![c]) c += 1;
      const colspan = cell.cs ?? 1;
      const rowspan = cell.rs ?? 1;
      for (let dr = 0; dr < rowspan && r + dr < rows.length; dr += 1) {
        for (let dc = 0; dc < colspan; dc += 1) covered[r + dr]![c + dc] = true;
      }
      fields[r]![c] = cell.t;
      c += colspan;
      width = Math.max(width, c);
    }
  });
  return rows
    .map((_, r) => Array.from({ length: width }, (_, c) => fields[r]![c] ?? '').join('\t'))
    .join('\n');
}

/** What a synthetic `copy` event on `body-editor` leaves in its own `DataTransfer`. */
interface Copied {
  plain: string;
  html: string;
  json: string;
  /** The HTML's first table: its class and `border`, and whether any element has a node id. */
  table: { className: string; border: string | null } | null;
  nodeIds: number;
}

async function copyEvent(page: Page): Promise<Copied> {
  return page.evaluate<Copied>(`(() => {
    const data = new DataTransfer();
    const event = new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true });
    document.querySelector('[data-testid="body-editor"]').dispatchEvent(event);
    const html = data.getData('text/html');
    const dom = new DOMParser().parseFromString(html, 'text/html');
    const table = dom.querySelector('table');
    return {
      plain: data.getData('text/plain'),
      html,
      json: data.getData('application/x-mfbe-fb2+json'),
      table: table ? { className: table.className, border: table.getAttribute('border') } : null,
      nodeIds: dom.querySelectorAll('[data-node-id]').length,
    };
  })()`);
}

test.describe('US9 (feature 006) - the live capture and copy out', () => {
  test.beforeEach(async ({ core, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.rpc('settings.set', { patch: { session: { aiPanelVisible: false } } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    await core
      .rpc('settings.set', { patch: { session: { aiPanelVisible: true } } })
      .catch(() => {});
  });

  test('sc.6 and SC-012: a table copied live from a web page in a second page pastes as an FB2 table with its header cells, spans and formatting', async ({
    core,
    page,
    context,
  }) => {
    await openBook(core, page, clipboardBook());
    const fixture = await toXml(page);
    // The page of the live capture, in a second page of the same browser context: its table
    // selected with a DOM range and copied with the keyboard; the two pages share the
    // clipboard (vR5:110).
    const source = await context.newPage();
    await source.goto(pathToFileURL(path.join(CLIPBOARD_DIR, 'web-source.html')).href);
    await source.bringToFront();
    await source.evaluate(`(() => {
      const range = document.createRange();
      range.selectNode(document.querySelector('[data-testid="web-source-table"]'));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    })()`);
    await source.keyboard.press(`${MOD}+c`);
    await expect
      .poll(() => source.evaluate<string>('navigator.clipboard.readText()'))
      .toContain('Fruit and colour');
    await page.bringToFront();
    const labelId = await caretAtEnd(page, labelOf('web-source'));
    await focusEditor(page);
    await page.keyboard.press(`${MOD}+v`);
    const after = await changedFrom(page, fixture);
    expect(await domBlocksAfter(page, labelId)).toEqual(pasteResult('web-source'));
    expect(await xmlBlocksAfter(page, after, labelOf('web-source'))).toEqual(
      pasteResult('web-source'),
    );
    await regular(page, tableAfter(await documentOf(page), labelOf('web-source')));
    await undoRedo(page, fixture, after);
    await source.close();
  });

  test('sc.7 and SC-012: every table the fixtures give, selected whole and as a block, reaches the clipboard as tab-separated text, as an HTML table that pastes back with the same grid, and in the editor’s own flavour', async ({
    core,
    page,
  }) => {
    test.setTimeout(process.env.CI ? 480_000 : 240_000);
    await openBook(core, page, clipboardBook());
    let pasted = await toXml(page);
    for (const name of FIXTURES) {
      await caretAtEnd(page, labelOf(name));
      await pasteFixture(page, name);
      pasted = await changedFrom(page, pasted);
    }
    // The fixtures without a paragraph of their own: their table's text is their `tsv`.
    for (const name of [
      'writer',
      'calc',
      'excel-win',
      'gdocs',
      'gsheets',
      'irregular-web',
    ] as const) {
      expect(gridTsv(expectedTables(name)[0]!), name).toBe(expected(name).tsv);
    }
    for (const name of FIXTURES) {
      const tables = expectedTables(name);
      for (let index = 0; index < tables.length; index += 1) {
        const rows = tables[index]!;
        const text = gridTsv(rows);
        const what = `${name} table ${index + 1}`;
        const doc = await documentOf(page);
        const model = tableAfter(doc, labelOf(name), index);
        const element = tableElement(page, model);
        const cells = cellRows(model).flat();

        // Select table and a synthetic copy event.
        await caretIn(page, cells[0]!.attrs!.nodeId!, 0);
        await structure(page, 'select');
        await expect(element).toHaveClass(/\bfb-selected\b/);
        await focusEditor(page);
        const whole = await copyEvent(page);
        expect(whole.plain, what).toBe(text);
        expect(whole.table, what).toEqual({ className: 'fb-table', border: '1' });
        expect(whole.nodeIds, what).toBe(0);
        expect(JSON.parse(whole.json), what).toEqual({
          format: 'mfbe-fb2',
          version: 1,
          slice: expect.anything(),
        });
        // A real copy of the selected table, read back from the system clipboard.
        await page.evaluate("navigator.clipboard.writeText('')");
        await page.keyboard.press(`${MOD}+c`);
        await expect
          .poll(() => page.evaluate<string>('navigator.clipboard.readText()'), { message: what })
          .toBe(text);

        // The HTML alone, pasted after a paragraph: a table with the same grid.
        const copyTarget = await caretAtEnd(page, COPY_TARGET);
        const before = await toXml(page);
        await pasteEvent(page, { html: whole.html });
        await changedFrom(page, before);
        const back = await domBlocksAfter(page, copyTarget);
        expect(back.blocks, `${what}: pasted back`).toEqual([{ table: { rows } }]);
        await undoTo(page, before);

        // A block from the first cell to the last (a click and a Shift+click): the same text
        // and an HTML table.
        const first = page.locator(`:is(td, th)[data-node-id="${cells[0]!.attrs!.nodeId!}"]`);
        const last = page.locator(
          `:is(td, th)[data-node-id="${cells[cells.length - 1]!.attrs!.nodeId!}"]`,
        );
        await shiftBlock(first, last);
        await focusEditor(page);
        const block = await copyEvent(page);
        expect(block.plain, `${what}: block`).toBe(text);
        expect(block.table, `${what}: block`).toEqual({ className: 'fb-table', border: '1' });
        expect(block.nodeIds, `${what}: block`).toBe(0);
        expect(JSON.parse(block.json), `${what}: block`).toMatchObject({
          format: 'mfbe-fb2',
          version: 1,
        });
      }
    }
    expect(await toXml(page)).toBe(pasted);
  });

  test('Edit → Paste of calc.html written with the asynchronous clipboard gives the same grid as Ctrl+V; Undo and Redo', async ({
    core,
    page,
  }) => {
    await openBook(core, page, clipboardBook());
    const fixture = await toXml(page);
    const args = JSON.stringify({ html: html('calc'), text: expected('calc').tsv });
    await page.evaluate(`((args) => navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([args.html], { type: 'text/html' }),
      'text/plain': new Blob([args.text], { type: 'text/plain' }),
    })]))(${args})`);
    const labelId = await caretAtEnd(page, labelOf('calc'));
    await focusEditor(page);
    await page.keyboard.press(`${MOD}+v`);
    const keyed = await changedFrom(page, fixture);
    const byKey = await domBlocksAfter(page, labelId);
    expect(byKey).toEqual(pasteResult('calc'));
    await undoTo(page, fixture);

    await caretAtEnd(page, labelOf('calc'));
    await menu(page, 'edit', 'paste');
    const after = await changedFrom(page, fixture);
    expect(await domBlocksAfter(page, labelId)).toEqual(byKey);
    expect(after).toBe(keyed);
    await undoRedo(page, fixture, after);
  });

  test('the Source view: a table copied in the Body view pastes into a paragraph’s text there as its tab-separated text', async ({
    core,
    page,
  }) => {
    await openBook(core, page, clipboardBook());
    const target = tableAfter(await documentOf(page), TARGET_LABEL);
    await caretIn(page, cellRows(target)[0]![0]!.attrs!.nodeId!, 1);
    await structure(page, 'select');
    await expect(tableElement(page, target)).toHaveClass(/\bfb-selected\b/);
    await focusEditor(page);
    await page.keyboard.press(`${MOD}+c`);
    const text = 't11\tt12\nt21\tt22';
    await expect.poll(() => page.evaluate<string>('navigator.clipboard.readText()')).toBe(text);
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    const source = (await page.evaluate(() => window.__mfbeTest!.sourceMapping!.sourceText()))!;
    const at = source.indexOf(SECOND_TEXT) + SECOND_TEXT.length;
    expect(at).toBeGreaterThan(SECOND_TEXT.length);
    expect(
      await page.evaluate((offset) => window.__mfbeTest!.sourceMapping!.select(offset), at),
    ).toBe(true);
    await page.locator('[data-testid="source-view"] .cm-content').focus();
    await page.keyboard.press(`${MOD}+v`);
    await expect
      .poll(() => page.evaluate(() => window.__mfbeTest!.sourceMapping!.sourceText()))
      .toBe(`${source.slice(0, at)}${text}${source.slice(at)}`);
  });
});
