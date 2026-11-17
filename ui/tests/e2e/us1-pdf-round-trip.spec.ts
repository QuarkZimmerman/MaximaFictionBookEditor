/**
 * Feature 016, User Story 1 (T027; D6; SC-001, SC-002): export to PDF and import again gives the book back,
 * apart from D6's list. For each book: open it, save it as the editor writes it, export it to PDF through
 * the print seam, import the PDF, save the new book, and compare the two saved books with
 * tests/epub/compare-fb2.js in the page; the differences D6 names are left out.
 *
 * The books: the reference book by default; `MFBE_ROUND_TRIP_BOOKS` names a list file, one path per line
 * (tests/pdf/round-trip.mjs runs it so); `MFBE_ROUND_TRIP_SIZE` the page size (A5 by default);
 * `MFBE_ROUND_TRIP_REPORT` receives the results as JSON.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, fixtureBook, test } from './fixtures/core';
import { bodyErrors, bookXml } from './fixtures/epubImport';
import { openBookCopy } from './fixtures/epubExport';
import { exportPdfTo } from './fixtures/pdfExport';
import { importPdfViaMenu, pdfImportDone } from './fixtures/pdfImport';
import { startPrintSeam } from './fixtures/printSeam';
import { scratchDir } from './fixtures/scratch';

const COMPARE = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/epub/compare-fb2.js'),
  'utf8',
);

/**
 * D6's differences (Q1: C, what the PDF does not hold), as compare-fb2.js words them: a group of lines (its
 * heading, then "-" lines of the original and "+" lines of the book imported again) is allowed when, with the
 * normalisations below, its two sides are the same; single lines are allowed by the patterns.
 */
const NORMALISE: [RegExp, string][] = [
  // C9: a PNG comes back with the same pixels in a new file, so its bytes - and the picture's identity - differ.
  [/a picture the original does not have/g, 'picture'],
  [/picture \d+/g, 'picture'],
  // C6: a poem date's value, a cell's vertical alignment.
  [/(\/date) value="[^"]*"/g, '$1'],
  [/ valign="[^"]*"/g, ''],
];
const ALLOWED_LINES: RegExp[] = [
  /did not come back byte for byte$/,
  /^a picture the original does not have came in$/,
  // C1: the notes' title when no note was printed after the text.
  /^\s*- body name="(notes|comments)"\/title\/p:/,
  // C5: a note without a title of its own gets its printed label as its title.
  /^\s*\+ body name="(notes|comments)"\/section\/title\/p:/,
];

/**
 * C5, where a link shows its note's text: the note's printed label, which it now begins with as its title, is
 * taken from the start of that text (as often as it stands there), and the text is cut short, since the
 * comparison shows its first characters only.
 */
function noteTexts(line: string): string {
  return line.replace(
    /\[a note -> "([^"]*)"\]([\s\S]*?)\[\/a\]/g,
    (_all, target: string, inner: string) => {
      // The link's text without the marks around it (a label such as "[1]" stays).
      const label = inner
        .replace(/\[\/?(?:strong|emphasis|style|strikethrough|sub|sup|code|a)\b[^\]]*\]/g, '')
        .trim();
      let text = target;
      while (label && text.startsWith(`${label} `)) text = text.slice(label.length + 1);
      return `[a note -> "${text.slice(0, 24)}"]${inner}[/a]`;
    },
  );
}

/**
 * C3: the text as the PDF holds it, applied to both books before they are compared - no soft hyphens and no
 * zero-width characters; in every block a run of white space is one space, the first, across the inline elements
 * between (as the engine collapses it), and none stands at the block's edges; code keeps its own. Evaluated in
 * the page.
 */
const SPACES = `(text) => {
  const FB = 'http://www.gribuser.ru/xml/fictionbook/2.0';
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  for (const name of ['p', 'v', 'subtitle', 'text-author', 'date', 'td', 'th']) {
    for (const block of [...doc.getElementsByTagNameNS(FB, name)]) {
      // D6, at implement: marks without text are lost, a link of a space alone comes back as the space and
      // links of one address side by side as one, and a space at a mark's edge keeps no mark of its own.
      const MARKS = new Set(['strong', 'emphasis', 'style', 'strikethrough', 'sub', 'sup', 'code', 'a']);
      const marks = () => [...block.getElementsByTagNameNS(FB, '*')].filter((e) => MARKS.has(e.localName));
      for (const mark of marks().reverse()) {
        if ((mark.textContent || '').trim() === '') mark.replaceWith(...mark.childNodes);
      }
      const XL = 'http://www.w3.org/1999/xlink';
      for (const link of [...block.getElementsByTagNameNS(FB, 'a')]) {
        if (!link.isConnected) continue;
        for (;;) {
          let next = link.nextSibling;
          const gap = [];
          while (next && next.nodeType === 3 && next.data.trim() === '') {
            gap.push(next);
            next = next.nextSibling;
          }
          if (!next || next.nodeType !== 1 || next.localName !== 'a' ||
              next.getAttributeNS(XL, 'href') !== link.getAttributeNS(XL, 'href')) break;
          link.append(...gap);
          link.append(...next.childNodes);
          next.remove();
        }
      }
      for (const mark of marks().reverse()) {
        const first = mark.firstChild;
        if (first && first.nodeType === 3 && /^\\s/.test(first.data)) {
          mark.before(first.data.match(/^\\s+/)[0]);
          first.data = first.data.replace(/^\\s+/, '');
        }
        const last = mark.lastChild;
        if (last && last.nodeType === 3 && /\\s$/.test(last.data)) {
          mark.after(last.data.match(/\\s+$/)[0]);
          last.data = last.data.replace(/\\s+$/, '');
        }
      }
      // ... and so two marks alike with only white space between come back as one.
      for (const mark of marks()) {
        if (!mark.isConnected) continue;
        for (;;) {
          let next = mark.nextSibling;
          const gap = [];
          while (next && next.nodeType === 3 && next.data.trim() === '') {
            gap.push(next);
            next = next.nextSibling;
          }
          if (!next || next.nodeType !== 1 || next.localName !== mark.localName) break;
          // Their own attributes, not the namespaces an element declares.
          const own = (e) => [...e.attributes].filter((a) => !a.name.startsWith('xmlns'));
          const same =
            own(mark).length === own(next).length &&
            own(mark).every((a) => next.getAttribute(a.name) === a.value);
          if (!same) break;
          mark.append(...gap);
          mark.append(...next.childNodes);
          next.remove();
        }
      }
      const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
      let space = true;
      for (const node of nodes) {
        if (node.parentElement && node.parentElement.closest('code')) { space = false; continue; }
        let out = '';
        for (const char of node.data.replace(/[\\u00ad\\u061c\\u200b-\\u200f\\u202a-\\u202e\\u2060\\u2066-\\u2069\\ufeff]/g, '')) {
          const white = /[ \\t\\n\\r]/.test(char);
          if (white && space) continue;
          out += white ? ' ' : char;
          space = white;
        }
        node.data = out;
      }
      for (let i = nodes.length - 1; i >= 0; i--) {
        nodes[i].data = nodes[i].data.replace(/ +$/, '');
        if (nodes[i].data.length > 0) break;
      }
    }
  }
  // D6: parts FB2's schema does not allow (a <br/>, an <em> some books hold) are not carried over: the editor
  // keeps them as raw XML, which Preview and so the PDF do not draw - left out of both books, with their text.
  const FB2_NAMES = new Set(('FictionBook description title-info genre author first-name middle-name last-name ' +
    'nickname home-page email id book-title annotation keywords date coverpage image lang src-lang translator ' +
    'sequence src-title-info document-info program-used src-url src-ocr version history publisher ' +
    'publish-info book-name city year isbn custom-info output part output-document-class body title epigraph ' +
    'section p poem stanza v subtitle cite empty-line text-author table tr th td strong emphasis style a ' +
    'strikethrough sub sup code binary stylesheet').split(' '));
  for (const element of [...doc.getElementsByTagName('*')].reverse()) {
    if (!FB2_NAMES.has(element.localName)) element.remove();
  }
  // C5: notes grouped in sections of a notes body come back ungrouped, the groups' titles with them - each
  // group unwrapped.
  for (const body of [...doc.getElementsByTagNameNS(FB, 'body')].slice(1)) {
    for (;;) {
      const group = [...body.getElementsByTagNameNS(FB, 'section')].find((section) =>
        [...section.children].some((child) => child.localName === 'section'),
      );
      if (!group) break;
      group.replaceWith(...[...group.children].filter((child) => child.localName === 'section'));
    }
  }
  // C4 (Q1: not in the record): inside the notes, block kinds, named styles, strikethrough, sub- and
  // superscripts, languages and ids are not carried - each note's content as paragraphs, those marks unwrapped.
  const XML_NS = 'http://www.w3.org/XML/1998/namespace';
  for (const body of [...doc.getElementsByTagNameNS(FB, 'body')].slice(1)) {
    const own = (element) => element.localName === 'section' && element.parentElement === body;
    for (const element of [...body.getElementsByTagName('*')].reverse()) {
      const name = element.localName;
      const unwrap = ['sub', 'sup', 'strikethrough', 'style', 'poem', 'stanza', 'cite', 'epigraph'];
      if (unwrap.includes(name) || (name === 'title' && element.parentElement !== body && !own(element.parentElement)))
        element.replaceWith(...element.childNodes);
      else if (['v', 'subtitle', 'text-author'].includes(name)) {
        const paragraph = doc.createElementNS(FB, 'p');
        paragraph.append(...element.childNodes);
        element.replaceWith(paragraph);
      } else if (name === 'empty-line') element.remove();
      else {
        element.removeAttributeNS(XML_NS, 'lang');
        if (!own(element)) element.removeAttribute('id');
      }
    }
  }
  // C5: a link to a note carries the note mark, and no other link does - the mark left out of both books.
  for (const link of [...doc.getElementsByTagNameNS(FB, 'a')]) link.removeAttribute('type');
  // C5: which notes body a note belongs to, when a book has two, and the bodies' names - one body "notes".
  const named = [...doc.getElementsByTagNameNS(FB, 'body')].slice(1).filter((body) => body.hasAttribute('name'));
  if (named.length) {
    named[0].setAttribute('name', 'notes');
    for (const other of named.slice(1)) {
      named[0].append(...[...other.children].filter((child) => child.localName === 'section'));
      other.remove();
    }
  }
  // D6 (requester, 2026-11-17): a link whose address is empty comes back as its text; a picture whose file the
  // book does not hold does not come back; a space at a line break inside a note is not named by the record -
  // the notes compared without their spaces.
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  for (const link of [...doc.getElementsByTagNameNS(FB, 'a')]) {
    if (!(link.getAttributeNS(XLINK_NS, 'href') || '').trim()) link.replaceWith(...link.childNodes);
  }
  const files = new Set([...doc.getElementsByTagNameNS(FB, 'binary')].map((binary) => binary.getAttribute('id')));
  for (const image of [...doc.getElementsByTagNameNS(FB, 'image')]) {
    const href = image.getAttributeNS(XLINK_NS, 'href') || '';
    if (href.startsWith('#') && !files.has(href.slice(1))) image.remove();
  }
  for (const body of [...doc.getElementsByTagNameNS(FB, 'body')].slice(1)) {
    const walker = doc.createTreeWalker(body, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) node.data = node.data.replace(/\\s+/g, '');
  }
  // C5: the notes come in the order of their first references - each notes body's notes sorted by id.
  for (const body of [...doc.getElementsByTagNameNS(FB, 'body')].slice(1)) {
    const notes = [...body.children].filter((child) => child.localName === 'section');
    const sorted = [...notes].sort((a, b) =>
      (a.getAttribute('id') ?? '').localeCompare(b.getAttribute('id') ?? '', 'en', { numeric: true }),
    );
    for (const note of sorted) body.append(note);
  }
  // C5: a note without a title of its own gets its printed label as its title - dropped where it repeats the
  // label its first paragraph's link back shows.
  const plain = (value) => (value || '').replace(/[\\s\\[\\]().]/g, '');
  for (const section of [...doc.getElementsByTagNameNS(FB, 'section')]) {
    const title = section.firstElementChild;
    if (!title || title.localName !== 'title') continue;
    const first = title.nextElementSibling;
    const back = first && first.localName === 'p' ? first.getElementsByTagNameNS(FB, 'a')[0] : null;
    if (back && plain(back.textContent) && plain(title.textContent) === plain(back.textContent)) title.remove();
  }
  return new XMLSerializer().serializeToString(doc);
}`;

/** The differences D6 does not allow. */
export function outsideD6(differences: readonly string[]): string[] {
  const out: string[] = [];
  let group: string[] = [];
  const flush = (): void => {
    if (group.length === 0) return;
    const [heading, ...lines] = group;
    const norm = (line: string): string =>
      noteTexts(NORMALISE.reduce((text, [re, by]) => text.replace(re, by), line.slice(4)));
    const kept = lines.filter((line) => !ALLOWED_LINES.some((re) => re.test(line)));
    const minus = kept
      .filter((l) => l.startsWith('  - '))
      .map(norm)
      .sort();
    const plus = kept
      .filter((l) => l.startsWith('  + '))
      .map(norm)
      .sort();
    if (kept.length > 0 && JSON.stringify(minus) !== JSON.stringify(plus))
      out.push(heading, ...kept);
    group = [];
  };
  for (const line of differences) {
    if (line.startsWith('  - ') || line.startsWith('  + ')) {
      group.push(line);
      continue;
    }
    flush();
    if (/^(description|bodies|stylesheets|notes):/.test(line)) group = [line];
    else if (!ALLOWED_LINES.some((re) => re.test(line))) out.push(line);
  }
  flush();
  return out;
}

function books(): string[] {
  const list = process.env.MFBE_ROUND_TRIP_BOOKS;
  // The reference book, and right-to-left text the engine draws in the order it stands on the line (D32).
  if (!list)
    return [
      fixtureBook('reference-all-elements.fb2'),
      fixtureBook('pdf-round-trip-rtl.fb2'),
      fixtureBook('long-notes.fb2'),
    ];
  return readFileSync(list, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

interface Result {
  book: string;
  differences: string[];
  allowed?: string[];
  failure?: string;
  invalid?: string[];
  againInvalid?: string[];
  /** The errors of the book imported again that its invalid original has not. */
  againNew?: string[];
}

test.afterEach(async ({ core }) => {
  if (core.hasCore) await core.rpc('settings.set', { patch: { view: null } }).catch(() => {});
});

test.describe('US1 (feature 016) - export to PDF and import again', () => {
  test('each book comes back, apart from D6 (SC-001, SC-002)', async ({ core, page, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    const list = books();
    test.setTimeout(60_000 + list.length * 300_000);
    await core.rpc('settings.set', { patch: { view: { spellEnabled: false } } });
    await core.openApp(page);
    const seam = startPrintSeam(core, context, { readyTimeoutMs: 300_000 });
    const size = process.env.MFBE_ROUND_TRIP_SIZE ?? 'A5 (148 × 210 mm)';
    const results: Result[] = [];
    try {
      for (const book of list) {
        const dir = scratchDir('pdf-round-trip-');
        try {
          await openBookCopy(core, page, book, dir);
          const invalid = await bodyErrors(core, page);
          const original = await bookXml(core, page);
          const pdf = path.join(dir, 'book.pdf');
          await exportPdfTo(core, page, pdf, size);
          await pdfImportDone(page, await importPdfViaMenu(core, page, pdf), 300_000);
          const againErrors = await bodyErrors(core, page);
          const again = await bookXml(core, page);
          // MFBE_ROUND_TRIP_KEEP=<folder>: the book imported again kept there, by the original's name, to read.
          if (process.env.MFBE_ROUND_TRIP_KEEP)
            writeFileSync(path.join(process.env.MFBE_ROUND_TRIP_KEEP, path.basename(book)), again);
          const all = await page.evaluate<string[]>(
            `(${COMPARE})((${SPACES})(${JSON.stringify(original)}), (${SPACES})(${JSON.stringify(again)}), { full: true })`,
          );
          // Judged on whole lines (compare-fb2.js's { full: true }), shown cut.
          const shown = (line: string): string =>
            line.length > 400 ? `${line.slice(0, 400)}…` : line;
          const judged = outsideD6(all);
          const differences = judged.map(shown);
          results.push({
            book,
            differences,
            ...(all.length > differences.length
              ? { allowed: all.filter((d) => !judged.includes(d)).map(shown) }
              : {}),
            ...(invalid.length > 0 ? { invalid: invalid.slice(0, 3) } : {}),
            ...(againErrors.length > 0 ? { againInvalid: againErrors.slice(0, 3) } : {}),
            // SC-002: an invalid original fails only by errors its original has not - all of them compared.
            ...(invalid.length > 0 && againErrors.some((e) => !invalid.includes(e))
              ? { againNew: againErrors.filter((e) => !invalid.includes(e)).slice(0, 3) }
              : {}),
          });
        } catch (error) {
          results.push({
            book,
            differences: [],
            failure: String(error).replace(/\s+/g, ' ').slice(0, 800),
          });
          await page.keyboard.press('Escape');
        }
      }
    } finally {
      await seam.stop();
    }
    if (process.env.MFBE_ROUND_TRIP_REPORT) {
      writeFileSync(process.env.MFBE_ROUND_TRIP_REPORT, `${JSON.stringify(results, null, 2)}\n`);
    }
    expect(
      results.filter(
        (result) =>
          result.failure ||
          result.againInvalid ||
          (!result.invalid && result.differences.length > 0),
      ),
    ).toEqual([]);
  });
});
