/**
 * Feature 016 (User Story 1, R4, D5 to D8; tasks T028): the reference book exported by 0.0.11, read by the
 * reader (fixtures/*.json, from tests/fixtures/pdf/import/reference-0.0.11-a5.pdf), comes back as its book.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { HintsV1, PdfDocumentModel, PdfPageModel } from '@/features/pdf/import/model';
import {
  convertOurs,
  logicalOrder,
  restoreDescription,
  spaceRuns,
  stripWhole,
} from '@/features/pdf/import/ours';
import { flatten, type Flattened } from '@/features/pdf/import/parts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const base = path.join(HERE, 'fixtures', 'reference-0.0.11-a5');
const doc = JSON.parse(readFileSync(`${base}.document.json`, 'utf8')) as PdfDocumentModel;
const pages = [1, 2, 3, 4, 5, 6].map(
  (n) => JSON.parse(readFileSync(`${base}.page-${n}.json`, 'utf8')) as PdfPageModel,
);

const convert = () =>
  convertOurs(
    JSON.parse(doc.record!.hints),
    flatten(doc.structure!, doc.orphans),
    pages,
    doc.record!.description,
  );

describe("the editor's own PDF (US1)", () => {
  const result = convert();
  const xml = result.xml;
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');

  it('gives a well-formed FictionBook whose anchors all fit', () => {
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(result.mismatches).toBe(0);
    expect(result.counts).toEqual({ sections: 4, pictures: 3, tables: 1, notes: 2 });
  });

  it('gives back the description, its annotation from its own page', () => {
    expect(xml).toContain(
      '<book-title>The Reference Book</book-title><annotation><p>The annotation of the reference book.</p></annotation>',
    );
    expect(xml).toContain('<sequence name="The Series" number="3"/>');
  });

  it('gives back sections, titles, epigraphs, pictures and the named style', () => {
    expect(xml).toContain(
      '<image l:href="#pic-jpg" alt="Body picture"/><title><p>Anna Example</p><p>The Reference Book</p></title>',
    );
    expect(xml).toContain(
      '<epigraph><p>An epigraph of the body.</p><text-author>Someone Wise</text-author></epigraph>',
    );
    expect(xml).toContain(
      '<section id="ch1"><title><p>Chapter One</p><p>with a second title line</p></title>',
    );
    expect(xml).toContain(
      '<p style="letter">A paragraph in the named style letter.</p><empty-line/>',
    );
    expect(xml).toContain('<section id="part2"><title><p>Part Two</p></title><section id="ch2-1">');
    expect(xml).toContain('<p xml:lang="de">Ein deutscher Absatz.</p>');
  });

  it('gives back the inline marks where the hints put them', () => {
    expect(xml).toContain(
      '<p id="p1">Plain, <strong>strong</strong>, <emphasis>emphasis</emphasis>, <strikethrough>struck</strikethrough>, H<sub>2</sub>O, x<sup>2</sup>, <code>code()</code>, <style name="smallcaps">small caps</style> and an inline <image l:href="#pic-png" alt="inline"/> picture.</p>',
    );
    expect(xml).toContain('<a l:href="#n1" type="note">[1]</a>');
    expect(xml).toContain(
      '<a l:href="#ch2">chapter two</a> and to <a l:href="https://example.com/">a web page</a>.',
    );
  });

  it('gives back the poem with its stanzas, and the table with its spans and alignment', () => {
    expect(xml).toContain(
      '<v>First verse line,</v><v>second verse line.</v></stanza><stanza><v>Another stanza.</v></stanza>',
    );
    expect(xml).toContain('<th align="center">Head B</th>');
    expect(xml).toContain('<td colspan="2" align="right">Two columns</td>');
    expect(xml).toContain('<td rowspan="2">Two rows</td>');
  });

  it('gives back the notes from the feet of the pages, in the order of their references', () => {
    expect(xml).toContain(
      '<body name="notes"><section id="n1"><title><p>1</p></title><p>The first note.</p></section><section id="n2">',
    );
  });

  it('asks for each picture once, under its own binary id', () => {
    expect(result.pictures.map((p) => p.binaryId)).toEqual(['cover', 'pic-jpg', 'pic-png']);
  });
});

describe('the rules under it', () => {
  // The engine draws the book's spaces as characters; only a line's end hides one (D32's library run).
  it('puts the spaces the PDF does not draw: at a new line, and beside an inline picture', () => {
    const runs = spaceRuns([
      { text: 'a web page', page: 1, top: 100, size: 10, left: 40, right: 100 },
      { text: '.', page: 1, top: 115, size: 10, left: 40, right: 43 },
      { text: 'H', page: 1, top: 130, size: 10, left: 40, right: 47 },
      { text: '2', page: 1, top: 133, size: 7, left: 47, right: 51 },
      { text: 'O, next', page: 1, top: 130, size: 10, left: 51, right: 90 },
      { text: 'inline', page: 1, top: 145, size: 10, left: 40, right: 70 },
      { text: '', page: 1, picture: { alt: 'x' }, top: 150, left: 120, right: 126 },
      { text: 'picture.', page: 1, top: 160, size: 10, left: 40, right: 80 },
    ]);
    expect(runs.map((r) => r.text).join('|')).toBe('a web page|. |H|2|O, next |inline || picture.');
  });

  it('turns right-to-left text round to the order the book wrote it (D32)', () => {
    expect(logicalOrder('Мафусаил (ивр. חלשותמ, Метушелах)')).toBe(
      'Мафусаил (ивр. מתושלח, Метушелах)',
    );
    // Brackets mirrored and numbers kept: the same turn gives the line's order back (the round trip of a
    // book with such text comes back equal).
    const book = 'שלום (עולם) 1990 גדול';
    expect(logicalOrder(book)).not.toBe(book);
    expect(logicalOrder(logicalOrder(book))).toBe(book);
    expect(logicalOrder('no such text')).toBe('no such text');
  });

  it('drops the bold or italic every run of a block has, keeping the rest', () => {
    expect(
      stripWhole([
        { text: 'a', page: 1, bold: true },
        { text: 'b', page: 1, bold: true, italic: true },
      ]),
    ).toEqual([
      { text: 'a', page: 1 },
      { text: 'b', page: 1, italic: true },
    ]);
  });

  it('puts the annotation after the book title and the history after the version', () => {
    const description =
      '<description><title-info><book-title>T</book-title><lang>en</lang></title-info><document-info><id>1</id><version>1.0</version><publisher>P</publisher></document-info></description>';
    expect(restoreDescription(description, '<annotation/>', '<history/>')).toBe(
      '<description><title-info><book-title>T</book-title><annotation/><lang>en</lang></title-info><document-info><id>1</id><version>1.0</version><history/><publisher>P</publisher></document-info></description>',
    );
  });
});

describe('a block that draws nothing (D32)', () => {
  // Three paragraphs, the second of raw XML only (an <em>), which Preview does not draw: the PDF holds two.
  const hints = {
    v: 1,
    blocks: 3,
    blank: [1],
    generated: { cover: null, titlePage: 1, annotationPage: null, historyPage: null },
    bodies: [{ name: '', page: 1 }],
    sections: [[0, 1]],
    kinds: [],
    styles: [],
    marks: [],
    spaces: [],
    langs: [],
    ids: [],
    tables: [],
    pictures: [],
    stylesheets: [],
    anchors: { '0': 'One', '2': 'Three' },
  } as unknown as HintsV1;
  const run = (text: string, top: number) => ({
    text,
    page: 2,
    top,
    left: 50,
    right: 90,
    size: 10,
  });
  const flat = {
    parts: [
      { kind: 'p', page: 2, runs: [run('One', 100)] },
      { kind: 'p', page: 2, runs: [run('Three', 130)] },
    ],
    footnotes: [],
  } as unknown as Flattened;

  it('takes no part for it, and gives it back empty', () => {
    const { xml, mismatches } = convertOurs(hints, flat, [], '<description/>');
    expect(mismatches).toBe(0);
    expect(xml.replace(/\s+/g, '')).toContain('<p>One</p><p/><p>Three</p>');
  });

  it('nor for the part of spaces the engine tags for a paragraph of invisible characters (U+FEFF)', () => {
    const tagged = {
      ...flat,
      parts: [flat.parts[0], { kind: 'p', page: 2, runs: [run(' ', 115)] }, flat.parts[1]],
    } as unknown as Flattened;
    // A record of feature 016: it names the page breaks.
    const recorded = { ...hints, continued: [] } as unknown as HintsV1;
    const { xml, mismatches } = convertOurs(recorded, tagged, [], '<description/>');
    expect(mismatches).toBe(0);
    expect(xml.replace(/\s+/g, '')).toContain('<p>One</p><p/><p>Three</p>');
  });
});
