/**
 * Feature 004, User Story 7 - The selection and the caret travel between Body and Source
 * (T056; spec FR-070 to FR-073, SC-007).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`);
 * skipped in core-less mode. The scenarios:
 *
 *  1.-2. the 50-position corpus of `fixtures/mapping-positions.json` on `mapping-corpus.fb2`:
 *     each caret or selection is placed in the Body view (`__mfbeTest.scripts.selectRange`),
 *     Body -> Source puts the CodeMirror selection at the expected offsets (named by substrings
 *     of the serialised text), direction kept, the head's line scrolled into view; Source ->
 *     Body puts the caret after the same character and selects the same text again (SC-007:
 *     50 of 50 exactly);
 *  3. a Source caret inside a start tag goes to the element's start, inside an end tag to its
 *     end, in the whitespace between elements to the next element; a caret on <book-title>, the
 *     XML declaration or inside a <binary> placeholder goes to the start of the first body;
 *  4. a caret inside the annotation element lands in the annotation block, and back;
 *  5. an edited Source maps through the edited text (a paragraph inserted before the caret's);
 *     a paragraph deleted in Source sends the caret to the paragraph now at that place; a
 *     malformed text still refuses the switch (001 FR-021);
 *  6. `descriptor.fbd` (no body): a description element maps to the annotation block;
 *  7. a detour through the Description view leaves each view at its own position (FR-070).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import {
  expect,
  fixtureBook,
  test,
  waitForBook,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import { MOD } from './fixtures/keys';

interface SourceNeedle {
  after?: string;
  before?: string;
}

interface CorpusPosition {
  name: string;
  anchor: { path: string; offset: number };
  head?: { path: string; offset: number };
  source: { anchor: SourceNeedle; head?: SourceNeedle };
}

interface Corpus {
  book: string;
  positions: CorpusPosition[];
}

interface ModelPoint {
  nodeId: string;
  offset: number;
}

interface Points {
  anchor: ModelPoint;
  head: ModelPoint;
}

interface Offsets {
  anchor: number;
  head: number;
}

interface ModelNode {
  type: string;
  attrs?: { nodeId?: string };
  content?: ModelNode[];
}

interface ModelDocument {
  bodies: ModelNode[];
  description: {
    titleInfo: { annotation?: ModelNode };
    documentInfo: { history?: ModelNode };
  };
}

const CORPUS: Corpus = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/mapping-positions.json', import.meta.url)),
    'utf8',
  ),
) as Corpus;

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

async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await expect(page.getByTestId('body-editor')).toBeVisible();
}

/** The Document JSON the UI holds (`__mfbeTest.scripts.document()`). */
function model(page: Page): Promise<ModelDocument> {
  return page.evaluate<ModelDocument>('window.__mfbeTest.scripts.document()');
}

/** The serialised text of the open document as the Source view shows it. */
function sourceText(page: Page): Promise<string> {
  return page.evaluate<string>('window.__mfbeTest.scripts.toXml()');
}

function bodySelection(page: Page): Promise<Points | null> {
  return page.evaluate<Points | null>('window.__mfbeTest.sourceMapping.bodySelection()');
}

function sourceSelection(page: Page): Promise<Offsets | null> {
  return page.evaluate<Offsets | null>('window.__mfbeTest.sourceMapping.sourceSelection()');
}

function selectedText(page: Page): Promise<string | null> {
  return page.getByTestId('body-view').getAttribute('data-selected-text');
}

async function showSource(page: Page): Promise<void> {
  await page.getByTestId('view-source').click();
  await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
}

async function showBody(page: Page): Promise<void> {
  await page.getByTestId('view-body').click();
  await expect(page.getByTestId('body-editor')).toBeVisible();
}

/** The node id at a structural path of the model (the corpus names Body positions by path). */
function nodeIdAt(doc: ModelDocument, path: string): string {
  const segments = path.split('/');
  let current: ModelNode | undefined;
  let rest: string[];
  if (segments[0] === 'title-info') {
    current = doc.description.titleInfo.annotation;
    rest = segments.slice(2);
  } else if (segments[0] === 'document-info') {
    current = doc.description.documentInfo.history;
    rest = segments.slice(2);
  } else {
    const match = /^body\[(\d+)\]$/.exec(segments[0] ?? '');
    current = match ? doc.bodies[Number(match[1]) - 1] : undefined;
    rest = segments.slice(1);
  }
  for (const segment of rest) {
    const match = /^([a-z-]+)\[(\d+)\]$/.exec(segment);
    if (!match || !current) throw new Error(`bad path ${path}`);
    const [, type, index] = match;
    const candidates = (current.content ?? []).filter((child) => child.type === type);
    current = candidates[Number(index) - 1];
  }
  const id = current?.attrs?.nodeId;
  if (!id) throw new Error(`no node at ${path}`);
  return id;
}

/** The Source offset a needle names; the needle must occur exactly once. */
function offsetOf(text: string, needle: SourceNeedle, what: string): number {
  const probe = needle.after ?? needle.before ?? '';
  const first = text.indexOf(probe);
  expect(first, `${what}: "${probe}" is in the Source text`).toBeGreaterThanOrEqual(0);
  expect(text.indexOf(probe, first + 1), `${what}: "${probe}" occurs once`).toBe(-1);
  return needle.after !== undefined ? first + probe.length : first;
}

/** Puts the Source caret at `offset` (a selection when `head` is given) through the editor. */
async function setSourceSelection(page: Page, anchor: number, head = anchor): Promise<void> {
  const placed = await page.evaluate<boolean>(
    `window.__mfbeTest.sourceMapping.select(${anchor}, ${head})`,
  );
  if (!placed) throw new Error('the Source editor is not ready');
}

async function mountedBody(page: Page) {
  await expect(page.getByTestId('body-editor')).toBeVisible();
  await expect(page.getByTestId('status-path')).not.toHaveText('');
}

/* ------------------------------------------------------------------------ */
/* The corpus                                                               */
/* ------------------------------------------------------------------------ */

async function roundTrip(page: Page, position: CorpusPosition, doc: ModelDocument, text: string) {
  const what = position.name;
  const anchor: ModelPoint = {
    nodeId: nodeIdAt(doc, position.anchor.path),
    offset: position.anchor.offset,
  };
  const head: ModelPoint = position.head
    ? { nodeId: nodeIdAt(doc, position.head.path), offset: position.head.offset }
    : anchor;
  const placed = await page.evaluate<boolean>(
    `window.__mfbeTest.scripts.selectRange(${JSON.stringify(anchor)}, ${JSON.stringify(head)})`,
  );
  expect(placed, `${what}: the Body selection could be placed`).toBe(true);
  await expect
    .poll(() => bodySelection(page), { message: `${what}: Body selection placed` })
    .toEqual({
      anchor,
      head,
    });
  const textBefore = await selectedText(page);
  const pathBefore = await page.getByTestId('status-path').textContent();

  // Body -> Source: the expected offsets, direction kept, the head's line visible.
  const expected: Offsets = {
    anchor: offsetOf(text, position.source.anchor, `${what} (anchor)`),
    head: position.source.head ? offsetOf(text, position.source.head, `${what} (head)`) : 0,
  };
  if (!position.source.head) expected.head = expected.anchor;
  await page.getByTestId('view-source').click();
  await expect
    .poll(() => sourceSelection(page), {
      message: `${what}: Source selection after Body -> Source`,
    })
    .toEqual(expected);
  await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
  await expect(page.locator('.mfbe-source-editor .cm-activeLine').first()).toBeInViewport();

  // Source -> Body: the same points, the same text selected, the same path.
  await page.getByTestId('view-body').click();
  await expect
    .poll(() => bodySelection(page), { message: `${what}: Body selection after Source -> Body` })
    .toEqual({ anchor, head });
  expect(await selectedText(page), `${what}: the selected text`).toBe(textBefore);
  await expect(page.getByTestId('status-path')).toHaveText(pathBefore ?? '');
}

test.describe('US7 (004) - the selection and the caret travel between Body and Source', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.* yet');
  });

  const halves = [CORPUS.positions.slice(0, 25), CORPUS.positions.slice(25)];
  for (let index = 0; index < halves.length; index += 1) {
    const half = halves[index]!;
    test(`${index + 1}. corpus positions ${index * 25 + 1}-${index * 25 + half.length} land exactly in both directions`, async ({
      core,
      page,
    }) => {
      const file = fixtureBook(CORPUS.book);
      await openBook(core, page, file);
      await mountedBody(page);
      const doc = await model(page);
      const text = await sourceText(page);
      // The first Source visit serialises the book; the corpus then switches back and forth.
      await showSource(page);
      await showBody(page);
      for (const position of half) {
        await roundTrip(page, position, doc, text);
      }
      expect(CORPUS.positions).toHaveLength(50);
    });
  }

  test('3. a Source caret in markup or whitespace goes to the element, one without a Body place to the first body', async ({
    core,
    page,
  }) => {
    const file = fixtureBook(CORPUS.book);
    await openBook(core, page, file);
    await mountedBody(page);
    const doc = await model(page);
    const text = await sourceText(page);
    const p1 = nodeIdAt(doc, 'body[1]/section[1]/p[1]');
    const p2 = nodeIdAt(doc, 'body[1]/section[1]/p[2]');
    const p3 = nodeIdAt(doc, 'body[1]/section[1]/p[3]');
    const bookTitleP = nodeIdAt(doc, 'body[1]/title[1]/p[1]');
    const caret = (nodeId: string, offset: number): Points => ({
      anchor: { nodeId, offset },
      head: { nodeId, offset },
    });
    const cases: { name: string; offset: number; expected: Points; path: string }[] = [
      {
        name: 'inside a start tag -> the element start',
        offset: text.indexOf('<p>Третий') + 1,
        expected: caret(p3, 0),
        path: 'body[1]/section[1]/p[3]',
      },
      {
        name: 'inside an attribute of a start tag -> the element start',
        offset: text.indexOf('<a l:href="#note1"') + 10,
        expected: caret(nodeIdAt(doc, 'body[1]/section[1]/p[5]'), 16),
        path: 'body[1]/section[1]/p[5]',
      },
      {
        name: 'inside an end tag -> the element end',
        offset: text.indexOf('</p>', text.indexOf('Первый абзац первой главы.')) + 2,
        expected: caret(p1, 26),
        path: 'body[1]/section[1]/p[1]',
      },
      {
        name: 'whitespace between elements -> the next element',
        offset: text.indexOf('<p>Второй абзац: Иван') - 1,
        expected: caret(p2, 0),
        path: 'body[1]/section[1]/p[2]',
      },
      {
        name: 'after the last element of a section -> its end',
        offset: text.indexOf('</section>') - 1,
        expected: caret(nodeIdAt(doc, 'body[1]/section[1]/cite[1]/text-author[1]'), 12),
        path: 'body[1]/section[1]/cite[1]/text-author[1]',
      },
      {
        name: '<book-title> -> the start of the first body',
        offset: text.indexOf('<book-title>') + 14,
        expected: caret(bookTitleP, 0),
        path: 'body[1]/title[1]/p[1]',
      },
      {
        name: 'the XML declaration -> the start of the first body',
        offset: 3,
        expected: caret(bookTitleP, 0),
        path: 'body[1]/title[1]/p[1]',
      },
      {
        name: 'inside a <binary> placeholder -> the start of the first body',
        offset: text.indexOf('<binary id="dot.png"') + 30,
        expected: caret(bookTitleP, 0),
        path: 'body[1]/title[1]/p[1]',
      },
      {
        name: 'a selection that begins in the middle of a tag is extended to the element',
        offset: -1,
        expected: { anchor: { nodeId: p3, offset: 0 }, head: { nodeId: p3, offset: 6 } },
        path: 'body[1]/section[1]/p[3]',
      },
    ];
    await showSource(page);
    for (const c of cases) {
      await showSource(page);
      if (c.offset >= 0) await setSourceSelection(page, c.offset);
      else
        await setSourceSelection(page, text.indexOf('<p>Третий') + 1, text.indexOf('Третий') + 6);
      await page.getByTestId('view-body').click();
      await expect.poll(() => bodySelection(page), { message: c.name }).toEqual(c.expected);
      await expect(page.getByTestId('status-path')).toHaveText(c.path);
    }
    // Back in Source after a mapped switch, the selection is where the Body selection was: the
    // extended range {p3, 0}..{p3, 6} of the last case, "Третий" selected.
    await showSource(page);
    await expect
      .poll(() => sourceSelection(page))
      .toEqual({
        anchor: text.indexOf('Третий абзац'),
        head: text.indexOf('Третий абзац') + 'Третий'.length,
      });
  });

  test('4. a caret in the annotation block lands inside the annotation element, and back', async ({
    core,
    page,
  }) => {
    const file = fixtureBook(CORPUS.book);
    await openBook(core, page, file);
    await mountedBody(page);
    const doc = await model(page);
    const text = await sourceText(page);
    const annoP2 = nodeIdAt(doc, 'title-info/annotation[1]/p[2]');
    // Click into the annotation block's second paragraph.
    await page.locator('[data-testid="body-block-annotation"] p.fb-p').nth(1).click();
    await expect(page.getByTestId('status-path')).toHaveText(
      /^title-info\/annotation\[1\]\/p\[2\]/,
    );
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    const selection = await sourceSelection(page);
    const annotationStart = text.indexOf('<annotation>');
    const annotationEnd = text.indexOf('</annotation>');
    expect(selection).not.toBeNull();
    expect(selection!.head).toBeGreaterThan(annotationStart);
    expect(selection!.head).toBeLessThan(annotationEnd);
    expect(selection!.anchor).toBe(selection!.head);
    // And back: a caret inside the annotation's text goes to the block's paragraph.
    await setSourceSelection(page, text.indexOf('курсивом</emphasis>') + 4);
    await page.getByTestId('view-body').click();
    await expect
      .poll(() => bodySelection(page))
      .toEqual({
        anchor: { nodeId: annoP2, offset: 29 },
        head: { nodeId: annoP2, offset: 29 },
      });
    await expect(page.getByTestId('status-path')).toHaveText('title-info/annotation[1]/p[2]');
    // The <annotation> tag itself: the start of the block.
    await showSource(page);
    await setSourceSelection(page, annotationStart + 3);
    await page.getByTestId('view-body').click();
    await expect(page.getByTestId('status-path')).toHaveText('title-info/annotation[1]/p[1]');
    await expect
      .poll(() => bodySelection(page))
      .toEqual({
        anchor: { nodeId: nodeIdAt(doc, 'title-info/annotation[1]/p[1]'), offset: 0 },
        head: { nodeId: nodeIdAt(doc, 'title-info/annotation[1]/p[1]'), offset: 0 },
      });
  });

  test('5. an edited Source maps through the edited text; a vanished paragraph; a malformed text is refused', async ({
    core,
    page,
  }) => {
    const file = fixtureBook(CORPUS.book);
    await openBook(core, page, file);
    await mountedBody(page);
    await showSource(page);
    const text = await page.evaluate<string>('window.__mfbeTest.sourceMapping.sourceText()');

    // A paragraph typed before the first one: the caret in the third paragraph's text maps
    // through the edited text - the paragraph is p[4] after the parse.
    const insertAt = text.indexOf('<p>Первый абзац');
    await setSourceSelection(page, insertAt);
    await page.keyboard.insertText('<p>Новый абзац.</p>\n\t\t\t');
    const edited = await page.evaluate<string>('window.__mfbeTest.sourceMapping.sourceText()');
    expect(edited).toContain('<p>Новый абзац.</p>\n\t\t\t<p>Первый абзац');
    await setSourceSelection(page, edited.indexOf('Третий абз') + 'Третий абз'.length);
    await page.getByTestId('view-body').click();
    await mountedBody(page);
    await expect(page.getByTestId('status-path')).toHaveText('body[1]/section[1]/p[4]');
    const doc = await model(page);
    await expect
      .poll(() => bodySelection(page))
      .toEqual({
        anchor: { nodeId: nodeIdAt(doc, 'body[1]/section[1]/p[4]'), offset: 10 },
        head: { nodeId: nodeIdAt(doc, 'body[1]/section[1]/p[4]'), offset: 10 },
      });
    await expect(page).toHaveTitle(/^mapping-corpus\.fb2\* - /);

    // The paragraph the caret sat in is deleted: the caret's offset now lies before the
    // paragraph that follows, which is the one the Body caret goes to.
    await showSource(page);
    const current = await page.evaluate<string>('window.__mfbeTest.sourceMapping.sourceText()');
    const lineStart = current.indexOf('\t\t\t<p>Второй абзац: Иван');
    const lineEnd = current.indexOf('\n', lineStart) + 1;
    await setSourceSelection(page, lineStart, lineEnd);
    await page.keyboard.press('Delete');
    const afterDelete = await page.evaluate<string>('window.__mfbeTest.sourceMapping.sourceText()');
    expect(afterDelete).not.toContain('Второй абзац: Иван');
    await expect.poll(() => sourceSelection(page)).toEqual({ anchor: lineStart, head: lineStart });
    await page.getByTestId('view-body').click();
    await mountedBody(page);
    // p[1] new, p[2] first, (second deleted), p[3] third: the caret lands on the third paragraph.
    await expect(page.getByTestId('status-path')).toHaveText('body[1]/section[1]/p[3]');
    const reparsed = await model(page);
    await expect
      .poll(() => bodySelection(page))
      .toEqual({
        anchor: { nodeId: nodeIdAt(reparsed, 'body[1]/section[1]/p[3]'), offset: 0 },
        head: { nodeId: nodeIdAt(reparsed, 'body[1]/section[1]/p[3]'), offset: 0 },
      });

    // A malformed text keeps the user in the Source view (001 FR-021).
    await showSource(page);
    const broken = await page.evaluate<string>('window.__mfbeTest.sourceMapping.sourceText()');
    const gt = broken.indexOf('</section>') + '</section'.length;
    await setSourceSelection(page, gt, gt + 1);
    await page.keyboard.press('Delete');
    await page.getByTestId('view-body').click();
    await expect(page.getByTestId('dialog-bad-xml')).toBeVisible();
    await page.getByTestId('dialog-bad-xml-button-ok').click();
    await expect(page.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('source-parse-error')).toBeVisible();
    // Restored, the switch works again and maps through the restored text.
    await page.keyboard.insertText('>');
    await setSourceSelection(page, broken.indexOf('Последний абзац') + 9);
    await page.getByTestId('view-body').click();
    await mountedBody(page);
    await expect(page.getByTestId('status-path')).toHaveText('body[1]/section[2]/p[2]');
  });

  test('6. a document without a body: a description element maps to the annotation block', async ({
    core,
    page,
  }) => {
    const file = fixtureBook('descriptor.fbd');
    await openBook(core, page, file);
    await expect(page.getByTestId('body-block-annotation')).toBeVisible();
    await showSource(page);
    const text = await page.evaluate<string>('window.__mfbeTest.sourceMapping.sourceText()');
    await setSourceSelection(page, text.indexOf('<book-title>') + 14);
    await page.getByTestId('view-body').click();
    await expect(page.getByTestId('status-path')).toHaveText('title-info/annotation[1]/p[1]');
    await expect.poll(() => bodySelection(page).then((s) => s?.head.offset)).toBe(0);
    // And the annotation's own text maps into the block.
    await showSource(page);
    await setSourceSelection(page, text.indexOf('без тела') + 3);
    await page.getByTestId('view-body').click();
    await expect(page.getByTestId('status-path')).toHaveText('title-info/annotation[1]/p[1]');
    await expect
      .poll(() => bodySelection(page).then((s) => s?.head.offset))
      .toBe('Файл-описание без'.length);
  });

  test('7. a detour through the Description view leaves each view at its own position', async ({
    core,
    page,
  }) => {
    const file = fixtureBook(CORPUS.book);
    await openBook(core, page, file);
    await mountedBody(page);
    const doc = await model(page);
    const text = await sourceText(page);
    const p3 = nodeIdAt(doc, 'body[1]/section[1]/p[3]');
    const p7 = nodeIdAt(doc, 'body[1]/section[1]/p[7]');
    // Source visited once, caret left in the seventh paragraph.
    await showSource(page);
    const sourceCaret = text.indexOf('«ёлочки»');
    await setSourceSelection(page, sourceCaret);
    await showBody(page);
    await expect.poll(() => bodySelection(page).then((s) => s?.head.nodeId)).toBe(p7);
    // Body caret in the third paragraph, then Description, then Source: the Source caret stays.
    await page.evaluate(`window.__mfbeTest.scripts.select(${JSON.stringify(p3)}, 10, 10)`);
    await expect
      .poll(() => bodySelection(page).then((s) => s?.head))
      .toEqual({ nodeId: p3, offset: 10 });
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('view-description')).toHaveAttribute('aria-selected', 'true');
    await showSource(page);
    await expect
      .poll(() => sourceSelection(page))
      .toEqual({ anchor: sourceCaret, head: sourceCaret });
    // Source -> Description -> Body: the Body caret stays in the third paragraph.
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('view-description')).toHaveAttribute('aria-selected', 'true');
    await showBody(page);
    await expect
      .poll(() => bodySelection(page).then((s) => s?.head))
      .toEqual({ nodeId: p3, offset: 10 });
    // A direct switch maps again.
    await page.getByTestId('view-source').click();
    await expect
      .poll(() => sourceSelection(page))
      .toEqual({
        anchor: text.indexOf('Третий абз') + 'Третий абз'.length,
        head: text.indexOf('Третий абз') + 'Третий абз'.length,
      });
    // Ctrl/Cmd+A in Source selects the whole text: neither end has a Body counterpart (the
    // prolog, the end after </FictionBook>), so both go to the document's start (FR-071).
    await page.locator('.mfbe-source-editor .cm-content').click();
    await page.keyboard.press(`${MOD}+a`);
    await page.getByTestId('view-body').click();
    await mountedBody(page);
    const whole = await bodySelection(page);
    expect(whole?.anchor).toEqual({ nodeId: nodeIdAt(doc, 'body[1]/title[1]/p[1]'), offset: 0 });
    expect(whole?.head).toEqual({ nodeId: nodeIdAt(doc, 'body[1]/title[1]/p[1]'), offset: 0 });
  });
});
