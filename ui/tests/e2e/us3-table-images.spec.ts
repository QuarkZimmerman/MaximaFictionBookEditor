/**
 * Feature 006, User Story 3 - Pictures in table cells: the story journey (T078; research R9 §7.7
 * and R9.5 "Story journey"; quickstart §3 "Automated: the story journey"; spec FR-023 for a
 * picture, FR-024 to FR-027, FR-029, FR-047, FR-067; US3 sc.1, sc.2, sc.3, sc.4, sc.7, sc.8;
 * decisions 3 and 20; contracts/document-model.md §2.6; SC-004, SC-007, SC-009; U22, U34).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode. Every test starts from the default image settings ("Insert clear image?" on,
 * the prompt of `core/src/settings/settings.cpp:540`), opens `tables-images.fb2` (T016) through
 * File → Open and waits until its pictures have settled. The 16 × 16, 400 × 300 and 4000 × 3000
 * files are written into a temporary folder from the book's own `<binary>` payloads, under names
 * the book does not use, so their binary ids are new.
 *
 * After every command Edit → Undo gives back the document XML of `__mfbeTest.scripts.toXml()`
 * byte for byte and Edit → Redo the command's result (SC-007, U22). A picture's binary belongs to
 * the core's binary store, not to the undo history: after Undo it stays listed in Binary
 * Objects, as it does for pictures outside cells (feature 001, US7), so the comparison after
 * Undo leaves the `<binary>` placeholders out and checks them on their own.
 *
 * Tests:
 *  1. sc.1, FR-024: Add → Inline image in a `td` and a `th` of c04 - the prompt, the file, the
 *     binary, the Source text, gates P1-P4 and W1; and with Fast Mode on;
 *  2. sc.2, FR-025: an image pasted into a cell of c03;
 *  3. sc.3, FR-025: three files dropped on a cell of c03, in their order, three undo steps;
 *  4. sc.4, FR-026: Add → Image and Add → Section image unavailable in a cell, with the reason;
 *  5. sc.7, FR-029: the selection outline of a picture in a cell; Href and Alt text in a cell,
 *     on an inline picture in a paragraph and on a block picture; Alt text only in the Body view;
 *  6. FR-067's editing path (vR9 N3): Superscript and Strong on a picture in a cell, saved and
 *     reopened, the raised picture inside its cell;
 *  7. sc.8, SC-004, FR-047, FR-067: Save As without edits keeps every table, c11's linked and
 *     v08's formatted pictures included; the copy validates; tables.fb2's linked and bold
 *     pictures in a paragraph and in cells come back too.
 * Step 8 of quickstart §3 (US10 sc.3, the Description field's c21) joins this file with US10.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { LINE_END } from './fixtures/keys';
import {
  checkLayout,
  describeFailures,
  MEASURE_TABLES,
  PICTURES_SETTLED,
  type Expected,
  type GateId,
  type TableMeasurement,
} from './fixtures/tableLayout';

/* ------------------------------------------------------------------------ */
/* The fixture and its pictures                                             */
/* ------------------------------------------------------------------------ */

const BOOK = fixtureBook('tables-images.fb2');
const TABLES_BOOK = fixtureBook('tables.fb2');
const EXPECTED = JSON.parse(
  readFileSync(fixtureBook('tables-images.expected.json'), 'utf8'),
) as Expected;
const SCOPE = '[data-testid="body-editor"]';

/** The files of the journey and the fixture binaries they are written from. */
const FILES = {
  'cell-16x16.png': { width: 16, height: 16, from: 'pic-16x16.png' },
  'cell-400x300.png': { width: 400, height: 300, from: 'pic-400x300.png' },
  'cell-4000x3000.png': { width: 4000, height: 3000, from: 'pic-4000x3000.png' },
} as const;
type FileName = keyof typeof FILES;

/** The expectations with the inserted binaries at the natural sizes of their sources. */
const WITH_INSERTED: Expected = {
  ...EXPECTED,
  pictures: {
    ...EXPECTED.pictures,
    ...Object.fromEntries(
      Object.entries(FILES).map(([name, file]) => [name, EXPECTED.pictures[file.from]!]),
    ),
  },
};

/** `{id, content-type, base64 payload}` of every `<binary>` (us7-images.spec.ts). */
function binariesOf(xml: string): { id: string; contentType: string; payload: string }[] {
  return [...xml.matchAll(/<binary\s+([^>]*)>([\s\S]*?)<\/binary>/g)].map((m) => {
    const attrs = m[1]!;
    return {
      id: /\bid="([^"]*)"/.exec(attrs)?.[1] ?? '',
      contentType: /content-type="([^"]*)"/.exec(attrs)?.[1] ?? '',
      payload: m[2]!.replace(/\s+/g, ''),
    };
  });
}

/** Writes the journey's three PNG files, each found by the size in its PNG header. */
function writePictureFiles(dir: string): Record<FileName, string> {
  const pngs = binariesOf(readFileSync(BOOK, 'utf8'))
    .filter((binary) => binary.contentType === 'image/png')
    .map((binary) => Buffer.from(binary.payload, 'base64'))
    .filter((bytes) => bytes.subarray(1, 4).toString('latin1') === 'PNG');
  const out = {} as Record<FileName, string>;
  for (const [name, file] of Object.entries(FILES) as [FileName, (typeof FILES)[FileName]][]) {
    const bytes = pngs.find(
      (png) => png.readUInt32BE(16) === file.width && png.readUInt32BE(20) === file.height,
    );
    if (!bytes) throw new Error(`the fixture holds no ${file.width} × ${file.height} PNG`);
    out[name] = path.join(dir, name);
    writeFileSync(out[name], bytes);
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* The page                                                                 */
/* ------------------------------------------------------------------------ */

declare const window: {
  __mfbeTest?: {
    scripts?: { document(): { docId: string }; toXml(): Promise<string> };
    sourceMapping?: { sourceText(): string | null; last: unknown };
  };
};

/** Id of the document the Body view shows, at once (null without one). */
function shownDocId(page: Page): Promise<string | null> {
  return page.evaluate<string | null>(
    `document.querySelector('[data-testid="body-view"]')?.getAttribute('data-doc-id') ?? null`,
  );
}

/**
 * File → Open of `file`; resolves once its document replaced the one shown before - a file just
 * saved under that name shows its title already, before the open has closed and replaced it.
 */
async function openViaDialog(core: CoreHandle, page: Page, file: string): Promise<void> {
  const before = await shownDocId(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await expect(page.getByTestId('body-view')).toBeVisible();
  await expect.poll(() => shownDocId(page)).not.toBe(before);
  await expect.poll(() => shownDocId(page)).not.toBeNull();
}

async function settle(page: Page, scope = SCOPE): Promise<void> {
  await page.evaluate(`(${PICTURES_SETTLED})(${JSON.stringify({ scope })})`);
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

function toXml(page: Page): Promise<string> {
  return page.evaluate(() => window.__mfbeTest!.scripts!.toXml());
}

async function sourceText(page: Page): Promise<string> {
  return (await page.evaluate(() => window.__mfbeTest!.sourceMapping!.sourceText())) ?? '';
}

/**
 * Back from the Source view to the Body view, once the Source cursor has been mapped back into
 * the Body editor (`doc.fromXml` and `doc.mapPositions`, asynchronous): a click made before that
 * lands would be undone by it.
 */
async function backToBody(page: Page): Promise<void> {
  const last = () =>
    page.evaluate(() => JSON.stringify(window.__mfbeTest!.sourceMapping!.last ?? null));
  const before = await last();
  await page.getByTestId('view-body').click();
  await expect(page.getByTestId('body-editor')).toBeVisible();
  await expect.poll(last).not.toBe(before);
}

function docIdOf(page: Page): Promise<string | null> {
  return page.getByTestId('body-view').getAttribute('data-doc-id');
}

/** A table of the fixture by its id, a key of `expected.tables`. */
function table(page: Page, id: string): Locator {
  expect(Object.keys(EXPECTED.tables), `${id} is a curated table`).toContain(id);
  return page.getByTestId('body-editor').locator(`table.fb-table[data-id="${id}"]`);
}

/** The cell at (row, column) of a table without spans. */
function cell(page: Page, id: string, row: number, col: number): Locator {
  return table(page, id)
    .locator(':scope > tbody > tr')
    .nth(row)
    .locator(':scope > td, :scope > th')
    .nth(col);
}

/** The first text cell of a table (one `pictureCells` does not list) of the given kind. */
async function textCell(page: Page, id: string, kind: 'td' | 'th', skip = 0): Promise<Locator> {
  const want = EXPECTED.tables[id]!;
  let left = skip;
  for (let row = 0; row < want.rows; row += 1) {
    for (let col = 0; col < want.cols; col += 1) {
      if (want.pictureCells.some((p) => p.row === row && p.col === col)) continue;
      const found = cell(page, id, row, col);
      const tag = await found.evaluate((el) => (el as unknown as { tagName: string }).tagName);
      if (tag.toLowerCase() !== kind) continue;
      if (left-- > 0) continue;
      return found;
    }
  }
  throw new Error(`${id} has no text ${kind}`);
}

/** Puts the caret at the end of a cell's text; the status path then names the cell. */
async function clickIntoCell(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await target.click({ position: { x: box.width - 3, y: Math.min(box.height / 2, 12) } });
  await page.keyboard.press(LINE_END);
  await expect(page.getByTestId('status-path')).toHaveText(/\/t[dh]\[\d+\]$/);
  await page.waitForTimeout(80);
}

/** Puts the caret at the end of a paragraph's text. */
async function clickIntoParagraph(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await target.click({ position: { x: 8, y: 8 } });
  await page.keyboard.press(LINE_END);
  await expect(page.getByTestId('status-path')).toHaveText(/\/p\[\d+\]$/);
  await page.waitForTimeout(80);
}

/** The "Control: the same table without its pictures" paragraph after a table. */
function controlParagraph(page: Page, id: string): Locator {
  return table(page, id).locator('xpath=following-sibling::p[1]');
}

const BINARY = /\s*<binary\b[^>]*>[\s\S]*?<\/binary>/g;

function withoutBinaries(xml: string): string {
  return xml.replace(BINARY, '');
}

function binaryPlaceholders(xml: string): string[] {
  return [...xml.matchAll(BINARY)].map((m) => m[0].trim());
}

/**
 * Runs `command` (which may run several steps, `steps` undo steps in all), then Undo `steps`
 * times and Redo `steps` times: Undo gives back the XML before the command byte for byte (the
 * binary store aside, see the header), Redo the command's result. Returns that result.
 */
async function undoRedo(page: Page, command: () => Promise<void>, steps = 1): Promise<string> {
  const before = await toXml(page);
  await command();
  await expect.poll(() => toXml(page)).not.toBe(before);
  const after = await toXml(page);
  for (let i = 0; i < steps; i += 1) await menu(page, 'edit', 'undo');
  await expect.poll(async () => withoutBinaries(await toXml(page))).toBe(withoutBinaries(before));
  expect(binaryPlaceholders(await toXml(page))).toEqual(binaryPlaceholders(after));
  for (let i = 0; i < steps; i += 1) await menu(page, 'edit', 'redo');
  await expect.poll(() => toXml(page)).toBe(after);
  return after;
}

/**
 * Selects a picture by one click, once a changed reference has loaded (or failed) and the
 * picture or its placeholder stops moving. A plain click on a picture that is selected already
 * keeps it selected - after a command, after Undo and Redo, and after the way back from the
 * Source view, whether that way back restored the selection or kept it.
 */
async function selectPicture(page: Page, target: Locator): Promise<void> {
  await settle(page);
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await expect(target).toHaveClass(/fb-selected/);
}

/** Add → Inline image (or Image) with the prompt answered No and the file chosen. */
async function addImageFromFile(
  core: CoreHandle,
  page: Page,
  item: 'inlineImage' | 'image',
  file: string,
): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await menu(page, 'add', item);
  await expect(page.getByTestId('dialog-insert-clear-image')).toBeVisible();
  await page.getByTestId('dialog-insert-clear-image-button-no').click();
}

function picture(scope: Locator, href: string): Locator {
  return scope.locator(`[data-testid="body-inline-image"][data-href="${href}"]`);
}

/** The XML of a table: from its start tag to its end tag. */
function tableXml(xml: string, id: string): string {
  const start = xml.indexOf(`<table id="${id}"`);
  expect(start, `<table id="${id}"> in the XML`).toBeGreaterThanOrEqual(0);
  return xml.slice(start, xml.indexOf('</table>', start) + '</table>'.length);
}

async function measure(page: Page, ids: string[], scope = SCOPE): Promise<TableMeasurement> {
  return page.evaluate<TableMeasurement>(
    `(${MEASURE_TABLES})(${JSON.stringify({ scope, ids, words: false })})`,
  );
}

async function expectGates(
  page: Page,
  ids: string[],
  gates: readonly GateId[],
  where: string,
): Promise<void> {
  await settle(page);
  const { failures } = checkLayout(await measure(page, ids), WITH_INSERTED, ids, { gates });
  expect(failures, describeFailures(where, failures)).toEqual([]);
}

/* ------------------------------------------------------------------------ */
/* Screenshots decoded in the page (no PNG library)                         */
/* ------------------------------------------------------------------------ */

/**
 * Of the pixels in the ring `ring` px wide just outside the box `inner` (in the screenshots'
 * CSS pixels), how many differ by more than `threshold` in some channel between two PNGs.
 */
const RING_CHANGE = `async (args) => {
  const decode = async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  };
  const a = await decode(args.before);
  const b = await decode(args.after);
  const s = a.width / args.width;
  const left = args.inner.left * s, right = args.inner.right * s;
  const top = args.inner.top * s, bottom = args.inner.bottom * s;
  const ring = args.ring * s;
  let total = 0;
  let changed = 0;
  for (let y = 0; y < Math.min(a.height, b.height); y += 1) {
    for (let x = 0; x < Math.min(a.width, b.width); x += 1) {
      const px = x + 0.5, py = y + 0.5;
      const outer = px >= left - ring && px < right + ring && py >= top - ring && py < bottom + ring;
      const inside = px >= left && px < right && py >= top && py < bottom;
      if (!outer || inside) continue;
      total += 1;
      const i = (y * a.width + x) * 4;
      const delta = Math.max(
        Math.abs(a.data[i] - b.data[i]),
        Math.abs(a.data[i + 1] - b.data[i + 1]),
        Math.abs(a.data[i + 2] - b.data[i + 2]),
      );
      if (delta > args.threshold) changed += 1;
    }
  }
  return { total, changed };
}`;

/* ------------------------------------------------------------------------ */
/* XML-level comparison in the page (data-model §13.4, as T032's walker)     */
/* ------------------------------------------------------------------------ */

/**
 * Compares the tables (`select: 'tables'`) or the text blocks that hold a picture inside a link
 * or formatting (`select: 'markedPictures'`: `p`, `td` and `th`) of two FB2 texts, pair by pair
 * in document order, under the walker's rules: elements by namespace URI and local name;
 * attributes as sets of (namespace URI, local name, value), `colspan` and `rowspan` by integer
 * value where the input reads as a whole number of 1 or more, exactly otherwise; the content of
 * `p`, `td` and `th` as one sequence of runs - text with its mark set (the enclosing inline
 * elements with their schema attributes; per kind in nesting order, an equal nested one
 * collapsed; one link, the outer) and inline atoms (pictures, other elements, comments) each with
 * theirs, adjacent text with equal sets joined; white space between structural elements,
 * attribute order, the declared encoding and namespace prefixes ignored. Resolves to
 * `{compared, difference}`, the first difference with the element's id and path, or null.
 */
const COMPARE_TABLES = `(args) => {
  const FB2 = 'http://www.gribuser.ru/xml/fictionbook/2.0';
  const XLINK = 'http://www.w3.org/1999/xlink';
  const XML = 'http://www.w3.org/XML/1998/namespace';
  const XMLNS = 'http://www.w3.org/2000/xmlns/';
  const FORMATTING = new Set(['strong', 'emphasis', 'strikethrough', 'sub', 'sup', 'code', 'style']);
  const MIXED = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th']);
  const parse = (text, which) => {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const error = doc.getElementsByTagName('parsererror')[0];
    if (error) throw new Error(which + ' is not well-formed: ' + error.textContent);
    return doc;
  };
  const isFb2 = (n) => n.nodeType === 1 && n.namespaceURI === FB2;
  const name = (n) => '{' + (n.namespaceURI || '') + '}' + n.localName;
  const whole = (text) => {
    const t = text.trim();
    if (!/^[+-]?\\d+$/.test(t)) return null;
    const v = Number(t);
    return Math.abs(v) <= 1e9 ? v : null;
  };
  const attrs = (el) => {
    const out = new Map();
    for (const a of Array.from(el.attributes)) {
      if (a.namespaceURI === XMLNS) continue;
      out.set('{' + (a.namespaceURI || '') + '}' + a.localName, a.value);
    }
    return out;
  };
  const show = (map) => Array.from(map.entries()).sort().map(([k, v]) => ' ' + k + '="' + v + '"').join('');
  const compareAttributes = (a, b, where) => {
    const as = attrs(a);
    const bs = attrs(b);
    if (isFb2(a) && (a.localName === 'td' || a.localName === 'th')) {
      for (const span of ['{}colspan', '{}rowspan']) {
        if (!as.has(span) || !bs.has(span)) continue;
        const value = whole(as.get(span));
        if (value !== null && value >= 1) {
          if (whole(bs.get(span)) !== value) return where + ': ' + span + ' "' + as.get(span) + '" became "' + bs.get(span) + '"';
          bs.set(span, as.get(span));
        }
      }
    }
    if (show(as) !== show(bs)) return where + ': attributes' + show(as) + ' became' + show(bs);
    return null;
  };
  const markKey = (el) => {
    let key = el.localName;
    if (el.localName === 'a') {
      const href = el.getAttributeNS(XLINK, 'href') ?? el.getAttribute('href') ?? '';
      key += ' href=' + href;
      const xlinkType = el.getAttributeNS(XLINK, 'type');
      if (xlinkType !== null) key += ' xlink:type=' + xlinkType;
      const type = el.getAttribute('type');
      if (type) key += ' type=' + type;
      return key;
    }
    if (el.localName === 'style') key += ' name=' + (el.getAttribute('name') ?? '');
    const lang = el.getAttributeNS(XML, 'lang');
    if (lang !== null) key += ' lang=' + lang;
    return key;
  };
  const markText = (kinds) => {
    const parts = [];
    for (const kind of Array.from(kinds.keys()).sort()) for (const mark of kinds.get(kind)) parts.push('[' + mark + ']');
    return parts.length ? parts.join('') : '[]';
  };
  const collect = (parent, kinds, runs) => {
    for (const c of Array.from(parent.childNodes)) {
      if (c.nodeType === 3 || c.nodeType === 4) {
        if (!c.data) continue;
        const key = markText(kinds);
        const last = runs[runs.length - 1];
        if (last && last.text && last.marks === key) last.chars += c.data;
        else runs.push({ text: true, chars: c.data, marks: key, atom: null });
      } else if (c.nodeType === 1 && isFb2(c) && (FORMATTING.has(c.localName) || c.localName === 'a')) {
        const kind = c.localName;
        const key = markKey(c);
        const open = kinds.get(kind) || [];
        const collapsed = kind === 'a' ? open.length > 0 : open.includes(key);
        if (!collapsed) {
          open.push(key);
          kinds.set(kind, open);
        }
        collect(c, kinds, runs);
        if (!collapsed) open.pop();
        if (!open.length) kinds.delete(kind);
      } else if (c.nodeType === 1 || c.nodeType === 8 || c.nodeType === 7) {
        runs.push({ text: false, chars: '', marks: markText(kinds), atom: c });
      }
    }
  };
  const excerpt = (s) => JSON.stringify(s.slice(0, 60));
  const subtree = (a, b, where) => {
    if (a.nodeType !== b.nodeType) return where + ': node kind changed';
    if (a.nodeType === 3 || a.nodeType === 4 || a.nodeType === 8 || a.nodeType === 7) {
      if (a.nodeName !== b.nodeName || a.data !== b.data) return where + ': ' + excerpt(a.data) + ' became ' + excerpt(b.data);
      return null;
    }
    if (a.nodeType !== 1) return null;
    if (name(a) !== name(b)) return where + ': element ' + name(a) + ' became ' + name(b);
    const d = compareAttributes(a, b, where);
    if (d) return d;
    const ca = Array.from(a.childNodes);
    const cb = Array.from(b.childNodes);
    if (ca.length !== cb.length) return where + ': the content of ' + a.localName + ' differs in length';
    for (let i = 0; i < ca.length; i += 1) {
      const e = subtree(ca[i], cb[i], where + '/node()[' + (i + 1) + ']');
      if (e) return e;
    }
    return null;
  };
  const mixed = (a, b, where) => {
    const ra = [];
    const rb = [];
    collect(a, new Map(), ra);
    collect(b, new Map(), rb);
    for (let i = 0; i < Math.max(ra.length, rb.length); i += 1) {
      const at = where + ' run ' + (i + 1);
      if (i >= ra.length || i >= rb.length) return at + ': ' + ra.length + ' runs became ' + rb.length;
      const x = ra[i];
      const y = rb[i];
      if (x.text !== y.text) return at + ': ' + (x.text ? 'text ' + excerpt(x.chars) : 'an atom') + ' became ' + (y.text ? 'text ' + excerpt(y.chars) : 'an atom');
      if (x.text && x.chars !== y.chars) return at + ': text ' + excerpt(x.chars) + ' became ' + excerpt(y.chars);
      if (x.marks !== y.marks) return at + ' (' + (x.text ? excerpt(x.chars) : 'an atom') + '): marks ' + x.marks + ' became ' + y.marks;
      if (!x.text) {
        const d = subtree(x.atom, y.atom, at);
        if (d) return d;
      }
    }
    return null;
  };
  const structural = (n) =>
    Array.from(n.childNodes).filter((c) => c.nodeType === 1 || c.nodeType === 8 || c.nodeType === 7 ||
      ((c.nodeType === 3 || c.nodeType === 4) && /\\S/.test(c.data)));
  const element = (a, b, where) => {
    if (name(a) !== name(b)) return where + ': element ' + name(a) + ' became ' + name(b);
    if (!isFb2(a)) return subtree(a, b, where);
    const d = compareAttributes(a, b, where);
    if (d) return d;
    if (MIXED.has(a.localName)) return mixed(a, b, where);
    const ca = structural(a);
    const cb = structural(b);
    if (ca.length !== cb.length) return where + ': ' + ca.length + ' children became ' + cb.length;
    const counters = {};
    for (let i = 0; i < ca.length; i += 1) {
      const x = ca[i];
      const y = cb[i];
      const n = x.nodeType === 1 ? x.localName : 'node()';
      counters[n] = (counters[n] || 0) + 1;
      const at = where + '/' + n + '[' + counters[n] + ']';
      let e;
      if (x.nodeType === 1 && y.nodeType === 1) e = element(x, y, at);
      else if ((x.nodeType === 3 || x.nodeType === 4) && (y.nodeType === 3 || y.nodeType === 4)) {
        e = x.data.trim() === y.data.trim() ? null : at + ': text ' + excerpt(x.data.trim()) + ' became ' + excerpt(y.data.trim());
      } else e = subtree(x, y, at);
      if (e) return e;
    }
    return null;
  };
  const markedPicture = (el) =>
    Array.from(el.getElementsByTagNameNS(FB2, 'image')).some((image) => {
      for (let p = image.parentElement; p && p !== el; p = p.parentElement) {
        if (isFb2(p) && (FORMATTING.has(p.localName) || p.localName === 'a')) return true;
      }
      return false;
    });
  const pick = (doc) => {
    if (args.select === 'tables') return Array.from(doc.getElementsByTagNameNS(FB2, 'table'));
    return Array.from(doc.getElementsByTagNameNS(FB2, '*')).filter(
      (el) => (el.localName === 'p' || el.localName === 'td' || el.localName === 'th') && markedPicture(el),
    );
  };
  const a = pick(parse(args.before, 'the original'));
  const b = pick(parse(args.after, 'the saved copy'));
  if (a.length !== b.length) return { compared: 0, difference: a.length + ' elements became ' + b.length };
  for (let i = 0; i < a.length; i += 1) {
    const label = a[i].localName + '[' + (i + 1) + ']' + (a[i].getAttribute('id') ? '#' + a[i].getAttribute('id') : '');
    const d = element(a[i], b[i], label);
    if (d) return { compared: i, difference: d };
  }
  return { compared: a.length, difference: null };
}`;

async function compareXml(
  page: Page,
  before: string,
  after: string,
  select: 'tables' | 'markedPictures',
): Promise<{ compared: number; difference: string | null }> {
  return page.evaluate(`(${COMPARE_TABLES})(${JSON.stringify({ before, after, select })})`);
}

/** Save As to `file` through the queued native dialog; returns the written text. */
async function saveAs(core: CoreHandle, page: Page, file: string): Promise<string> {
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
  if ((await prompt.count()) > 0) {
    await page.getByTestId('dialog-validation-failed-button-yes').click();
  }
  await expect(page.getByTestId('status-message')).toContainText(/saved|found/i);
  await waitForBook(page, file);
  return readFileSync(file, 'utf8');
}

interface ValidationReport {
  errorCount: number;
  issues: { code: string; severity: string }[];
}

/* ------------------------------------------------------------------------ */
/* The journey                                                              */
/* ------------------------------------------------------------------------ */

test.describe('US3 - pictures in table cells', () => {
  let dir: string;
  let files: Record<FileName, string>;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us3-'));
    files = writePictureFiles(dir);
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.rpc('settings.set', {
      patch: { other: { askOnNonClearImage: true, insertClearImages: false } },
    });
    await core.openApp(page);
    await openViaDialog(core, page, BOOK);
    await settle(page);
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    await core.rpc('settings.set', { patch: { view: { fastMode: null } } });
  });

  test('1. sc.1: Add → Inline image in a td and a th, through the prompt and the file choice', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    const docId = await docIdOf(page);

    // A text td of the catalogue c04.
    const td = await textCell(page, 'c04', 'td');
    await clickIntoCell(page, td);
    await undoRedo(page, async () => {
      await addImageFromFile(core, page, 'inlineImage', files['cell-400x300.png']);
      await expect(picture(td, '#cell-400x300.png')).toHaveCount(1);
    });
    await expect(picture(page.getByTestId('body-editor'), '#cell-400x300.png')).toHaveCount(1);
    const list = await core.rpc<{ id: string; width?: number; height?: number }[]>('binary.list', {
      docId,
    });
    expect(list.find((b) => b.id === 'cell-400x300.png')).toMatchObject({
      width: 400,
      height: 300,
    });

    // A text th of its header row.
    const th = await textCell(page, 'c04', 'th');
    await clickIntoCell(page, th);
    await undoRedo(page, async () => {
      await addImageFromFile(core, page, 'inlineImage', files['cell-16x16.png']);
      await expect(picture(th, '#cell-16x16.png')).toHaveCount(1);
    });
    await expect(picture(page.getByTestId('body-editor'), '#cell-16x16.png')).toHaveCount(1);

    // The Source text: the pictures inside that td and that th.
    await page.getByTestId('view-source').click();
    await expect.poll(() => sourceText(page)).toContain('<image l:href="#cell-16x16.png"/>');
    const xml = tableXml(await sourceText(page), 'c04');
    expect(xml).toMatch(/<td>A small item<image l:href="#cell-400x300\.png"\/><\/td>/);
    expect(xml).toMatch(/<th>Picture<image l:href="#cell-16x16\.png"\/><\/th>/);
    await backToBody(page);

    // The edited table keeps the display rules: P1 to P4 and W1.
    await expectGates(page, ['c04'], ['P1', 'P2', 'P3', 'P4', 'W1'], 'c04 after the insertions');

    // Fast Mode keeps the command available in a cell, and it inserts there.
    await core.rpc('settings.set', { patch: { view: { fastMode: true } } });
    await expect(page.getByTestId('body-view')).toHaveClass(/mfbe-body-view--fast/);
    const other = await textCell(page, 'c04', 'td', 1);
    await clickIntoCell(page, other);
    await page.getByTestId('menu-add').click();
    await expect(page.getByTestId('menu-add-inlineImage')).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    await undoRedo(page, async () => {
      await addImageFromFile(core, page, 'inlineImage', files['cell-4000x3000.png']);
      await expect(picture(other, '#cell-4000x3000.png')).toHaveCount(1);
    });
    await core.rpc('settings.set', { patch: { view: { fastMode: null } } });
    await expect(page.getByTestId('body-view')).not.toHaveClass(/mfbe-body-view--fast/);
  });

  test('2. sc.2: an image pasted into a cell stands at the caret in that cell', async ({
    page,
  }) => {
    const target = await textCell(page, 'c03', 'td');
    await clickIntoCell(page, target);
    const after = await undoRedo(page, async () => {
      await dispatchCellFiles(page, 'paste', target, [files['cell-4000x3000.png']]);
      await expect(picture(target, '#cell-4000x3000.png')).toHaveCount(1);
    });
    expect(tableXml(after, 'c03')).toMatch(
      /<td>Text beside the picture<image l:href="#cell-4000x3000\.png"\/><\/td>/,
    );
  });

  test('3. sc.3: three files dropped on a cell go into it in their order', async ({ page }) => {
    const target = await textCell(page, 'c03', 'td', 1);
    const order: FileName[] = ['cell-16x16.png', 'cell-400x300.png', 'cell-4000x3000.png'];
    const after = await undoRedo(
      page,
      async () => {
        await dispatchCellFiles(
          page,
          'drop',
          target,
          order.map((name) => files[name]),
        );
        await expect(target.locator('[data-testid="body-inline-image"]')).toHaveCount(3);
      },
      3,
    );
    await expect(target.locator('[data-testid="body-inline-image"]')).toHaveCount(3);
    const hrefs = await target
      .locator('[data-testid="body-inline-image"]')
      .evaluateAll((els) =>
        els.map((el) =>
          (el as unknown as { getAttribute(n: string): string }).getAttribute('data-href'),
        ),
      );
    expect(hrefs).toEqual(order.map((name) => `#${name}`));
    expect(tableXml(after, 'c03')).toContain(
      '<td>More text<image l:href="#cell-16x16.png"/><image l:href="#cell-400x300.png"/><image l:href="#cell-4000x3000.png"/></td>',
    );
  });

  test('4. sc.4: Image and Section image say why a cell refuses them; Inline image works', async ({
    page,
  }) => {
    await clickIntoCell(page, await textCell(page, 'c04', 'td'));
    await page.getByTestId('menu-add').click();
    const reasons = {
      image: 'Insert image: a cell takes inline images only',
      sectionImage: 'Add image: a cell takes inline images only',
    };
    for (const [entry, title] of [
      [page.getByTestId('menu-add-image'), reasons.image],
      [page.getByTestId('menu-add-sectionImage'), reasons.sectionImage],
    ] as const) {
      await expect(entry).toHaveAttribute('aria-disabled', 'true');
      await expect(entry).toHaveAttribute('title', title);
      await expect(entry).toHaveAttribute('aria-description', title);
    }
    await expect(page.getByTestId('menu-add-inlineImage')).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    // The Commands toolbar: the block form disabled with the same title, the inline one enabled.
    await expect(page.getByTestId('toolbar-insert.image')).toBeDisabled();
    await expect(page.getByTestId('toolbar-insert.image')).toHaveAttribute('title', reasons.image);
    await expect(page.getByTestId('toolbar-insert.inlineImage')).toBeEnabled();

    // A paragraph directly in its section takes a block image again, without the reason.
    await clickIntoParagraph(page, controlParagraph(page, 'c04'));
    await page.getByTestId('menu-add').click();
    const image = page.getByTestId('menu-add-image');
    await expect(image).not.toHaveAttribute('aria-disabled', 'true');
    expect((await image.getAttribute('title')) ?? '').not.toContain(
      'a cell takes inline images only',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('toolbar-insert.image')).toBeEnabled();
  });

  test('5. sc.7: a selected picture shows its outline; Href and Alt text edit it, in a cell and elsewhere', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    const photoCell = cell(page, 'c02', 0, 0);
    const photo = photoCell.locator('[data-testid="body-inline-image"]');
    await photo.scrollIntoViewIfNeeded();
    // The caret elsewhere first, so the picture shows unselected.
    await clickIntoCell(page, cell(page, 'c02', 0, 1));
    await photo.scrollIntoViewIfNeeded();
    const box = (await photo.boundingBox())!;
    const clip = {
      x: Math.floor(box.x) - 4,
      y: Math.floor(box.y) - 4,
      width: Math.ceil(box.x + box.width) - Math.floor(box.x) + 8,
      height: Math.ceil(box.y + box.height) - Math.floor(box.y) + 8,
    };
    const inner = {
      left: box.x - clip.x,
      top: box.y - clip.y,
      right: box.x + box.width - clip.x,
      bottom: box.y + box.height - clip.y,
    };
    await page.mouse.move(0, 0);
    const before = (await page.screenshot({ clip })).toString('base64');
    await photo.click();
    await expect(photo).toHaveClass(/fb-selected/);
    await page.mouse.move(0, 0);
    const after = (await page.screenshot({ clip })).toString('base64');
    const ring = await page.evaluate<{ total: number; changed: number }>(
      `(${RING_CHANGE})(${JSON.stringify({ before, after, inner, width: clip.width, ring: 2, threshold: 32 })})`,
    );
    expect(ring.total).toBeGreaterThan(0);
    expect(
      ring.changed,
      `${ring.changed} of ${ring.total} ring pixels changed`,
    ).toBeGreaterThanOrEqual(ring.total / 2);

    // Href and Alt text of the picture in the cell.
    await editHrefAndAlt(page, photo, '#pic-800x600.png', 'c02');

    // An inline picture in a paragraph directly in a section.
    const paragraph = controlParagraph(page, 'c04');
    await clickIntoParagraph(page, paragraph);
    await addImageFromFile(core, page, 'inlineImage', files['cell-400x300.png']);
    await expect(picture(paragraph, '#cell-400x300.png')).toHaveCount(1);
    const inlinePicture = paragraph.locator('[data-testid="body-inline-image"]');
    await editHrefAndAlt(page, inlinePicture, '#cell-400x300.png', null);

    // A block picture after that paragraph.
    await clickIntoParagraph(page, paragraph);
    await addImageFromFile(core, page, 'image', files['cell-4000x3000.png']);
    const block = paragraph.locator(
      'xpath=following-sibling::figure[@data-testid="body-image"][1]',
    );
    await expect(block).toHaveAttribute('data-href', '#cell-4000x3000.png');
    await editHrefAndAlt(page, block, '#cell-4000x3000.png', null);

    // Alt text needs a selected picture, and the Body view.
    await clickIntoCell(page, cell(page, 'c02', 0, 1));
    await expect(page.getByTestId('links-bar-alt')).toBeDisabled();
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('description-view')).toBeVisible();
    await expect(page.getByTestId('links-bar-alt')).toBeDisabled();
    await page.getByTestId('view-body').click();
  });

  test('6. FR-067: Superscript and Strong on a picture in a cell are saved around it; it stays inside its cell', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    const target = cell(page, 'c09', 0, 0);
    const icon = picture(target, '#pic-48x48.png');
    await selectPicture(page, icon);
    await undoRedo(page, async () => {
      await page.getByTestId('toolbar-style.sup').click();
      await expect(target.locator('sup [data-testid="body-inline-image"]')).toHaveCount(1);
    });
    await expect(picture(cell(page, 'c09', 0, 0), '#pic-48x48.png')).toHaveCount(1);
    const raised = picture(cell(page, 'c09', 0, 0), '#pic-48x48.png');
    await selectPicture(page, raised);
    await undoRedo(page, async () => {
      await page.getByTestId('toolbar-style.strong').click();
      await expect(
        target.locator(
          'strong sup [data-testid="body-inline-image"], sup strong [data-testid="body-inline-image"]',
        ),
      ).toHaveCount(1);
    });
    await expectGates(page, ['c09'], ['P4', 'M1'], 'c09 with the raised picture');

    const marked =
      /<td>Text, <strong><sup><image l:href="#pic-48x48\.png"\/><\/sup><\/strong> and text in one cell<\/td>/;
    const copy = path.join(dir, 'raised-picture.fb2');
    expect(tableXml(await saveAs(core, page, copy), 'c09')).toMatch(marked);
    await openViaDialog(core, page, copy);
    await settle(page);
    expect(tableXml(await toXml(page), 'c09')).toMatch(marked);
    await expectGates(page, ['c09'], ['P4', 'M1'], 'c09 reopened');
  });

  test('7. sc.8: Save As keeps every table, the linked and formatted pictures included', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    const original = readFileSync(BOOK, 'utf8');
    const copy = path.join(dir, 'tables-images-copy.fb2');
    const written = await saveAs(core, page, copy);
    const tables = await compareXml(page, original, written, 'tables');
    expect(tables.difference).toBeNull();
    expect(tables.compared).toBe(
      2 * (Object.keys(EXPECTED.tables).length + Object.keys(EXPECTED.sc006).length),
    );
    // c11's pictures in links and v08's inside every mark, as written.
    expect(tableXml(written, 'c11')).toContain(
      '<a l:href="#c01"><image l:href="#pic-16x16.png"/></a>',
    );
    expect(tableXml(written, 'v08')).toContain(
      '<a l:href="#n1" type="note"><image l:href="#pic-16x16.png"/></a>',
    );

    // The copy, opened again, validates as the fixture does.
    await openViaDialog(core, page, copy);
    const docId = await docIdOf(page);
    const document = await page.evaluate(() => window.__mfbeTest!.scripts!.document());
    const report = await core.rpcJob<ValidationReport>('doc.validate', { docId, document });
    expect(report.errorCount).toBe(0);
    const warnings: Record<string, number> = {};
    for (const issue of report.issues.filter((i) => i.severity === 'warning')) {
      warnings[issue.code] = (warnings[issue.code] ?? 0) + 1;
    }
    expect(warnings).toEqual(EXPECTED.warnings);

    // tables.fb2: the linked and bold pictures of a paragraph and of cells (sc.8 outside tables).
    await openViaDialog(core, page, TABLES_BOOK);
    const tablesCopy = path.join(dir, 'tables-copy.fb2');
    const tablesWritten = await saveAs(core, page, tablesCopy);
    const marked = await compareXml(
      page,
      readFileSync(TABLES_BOOK, 'utf8'),
      tablesWritten,
      'markedPictures',
    );
    expect(marked.difference).toBeNull();
    expect(marked.compared).toBeGreaterThanOrEqual(3);
    expect(tablesWritten).toContain(
      'A linked picture <a l:href="#t-linked"><image l:href="#cell.png"/></a> and a bold picture <strong><image l:href="#cell.png"/></strong> in a paragraph.',
    );
  });
});

/* ------------------------------------------------------------------------ */
/* Paste and drop on a cell                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Dispatches a synthetic `paste`, or `dragover` and `drop` at a point inside the cell (the right
 * end of its first line), carrying the files in the given order, on the cell `args.cell` (the
 * pattern of `DISPATCH_FILE_EVENT`, us7-images.spec.ts).
 */
const DISPATCH_CELL_FILES = `(args) => {
  const target = document.querySelector('[data-mfbe-target="' + args.marker + '"]');
  if (!target) throw new Error('no cell');
  target.removeAttribute('data-mfbe-target');
  const data = new DataTransfer();
  for (const file of args.files) {
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    data.items.add(new File([bytes], file.name, { type: file.type }));
  }
  if (args.kind === 'paste') {
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    return;
  }
  const rect = target.getBoundingClientRect();
  const init = {
    dataTransfer: data,
    bubbles: true,
    cancelable: true,
    clientX: rect.right - 8,
    clientY: rect.top + Math.min(rect.height / 2, 10),
  };
  target.dispatchEvent(new DragEvent('dragover', init));
  target.dispatchEvent(new DragEvent('drop', init));
}`;

async function dispatchCellFiles(
  page: Page,
  kind: 'paste' | 'drop',
  target: Locator,
  paths: string[],
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const marker = `cell-${Date.now()}`;
  await target.evaluate(
    (el, value) =>
      (el as unknown as { setAttribute(n: string, v: string): void }).setAttribute(
        'data-mfbe-target',
        value,
      ),
    marker,
  );
  const args = {
    kind,
    marker,
    files: paths.map((file) => ({
      base64: readFileSync(file).toString('base64'),
      name: path.basename(file),
      type: 'image/png',
    })),
  };
  await page.evaluate(`(${DISPATCH_CELL_FILES})(${JSON.stringify(args)})`);
}

/* ------------------------------------------------------------------------ */
/* The Links bar on a selected picture (FR-029)                             */
/* ------------------------------------------------------------------------ */

/**
 * Selects `target` by a click; Href shows `href` and `#cell-16x16.png` + Enter changes it; Alt
 * text shows the `alt` (empty without one), `Cell picture` + Enter writes it, an empty value
 * removes it - each change one Undo and one Redo. `tableId` names the table whose XML holds the
 * picture, null for one outside tables.
 */
async function editHrefAndAlt(
  page: Page,
  target: Locator,
  href: string,
  tableId: string | null,
): Promise<void> {
  const hrefField = page.getByTestId('links-bar-href');
  const altField = page.getByTestId('links-bar-alt');
  const select = () => selectPicture(page, target);
  const xmlOf = (xml: string) => (tableId ? tableXml(xml, tableId) : xml);
  await select();
  await expect(hrefField).toBeEnabled();
  await expect(hrefField).toHaveValue(href);
  await undoRedo(page, async () => {
    await hrefField.fill('#cell-16x16.png');
    await hrefField.press('Enter');
    await expect(target).toHaveAttribute('data-href', '#cell-16x16.png');
  });
  await select();
  await expect(altField).toBeEnabled();
  await expect(altField).toHaveValue('');
  const withAlt = await undoRedo(page, async () => {
    await altField.fill('Cell picture');
    await altField.press('Enter');
    await expect.poll(async () => xmlOf(await toXml(page))).toContain('alt="Cell picture"');
  });
  expect(xmlOf(withAlt)).toMatch(
    /<image(?=[^>]*\bl:href="#cell-16x16\.png")(?=[^>]*\balt="Cell picture")[^>]*\/>/,
  );
  // The Source view shows it.
  await page.getByTestId('view-source').click();
  await expect.poll(() => sourceText(page)).toContain('alt="Cell picture"');
  expect(xmlOf(await sourceText(page))).toContain('alt="Cell picture"');
  await backToBody(page);
  await select();
  await expect(altField).toHaveValue('Cell picture');
  const removed = await undoRedo(page, async () => {
    await altField.fill('');
    await altField.press('Enter');
    await expect.poll(async () => xmlOf(await toXml(page))).not.toContain('alt="Cell picture"');
  });
  expect(xmlOf(removed)).not.toContain('alt=');
}
