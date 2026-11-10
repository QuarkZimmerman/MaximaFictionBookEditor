// Feature 010, US8 (D30): the imported book's FB2 text - the template's description with the
// front matter's data in the schema's order, then the bodies.

import { describe, expect, it } from 'vitest';

import { convertMarkdown } from '@/features/markdown/convert';
import { buildBook } from '@/features/markdown/describe';

const TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose</genre><author><first-name/><last-name/></author><book-title/><lang>ru</lang></title-info>
<document-info><author><nickname>maker</nickname></author><date/><id/><version>1.0</version></document-info></description>
<body><section><p/></section></body></FictionBook>`;

describe('buildBook', () => {
  it('puts the front matter into the template description in schema order and appends the bodies', () => {
    const result = convertMarkdown(
      '---\ntitle: My Book\nauthor: Ann Writer\nlang: en\ndate: 2026\nseries: Saga\nseries_index: 2\ncover: c.png\n---\nText[^1].\n\n[^1]: Note.\n',
      { fileName: 'file', baseDir: '/b', notesTitle: 'Notes' },
    );
    const xml = buildBook(TEMPLATE, result);
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const titleInfo = doc.getElementsByTagName('title-info')[0]!;
    expect(Array.from(titleInfo.children).map((child) => child.localName)).toEqual([
      'genre',
      'author',
      'book-title',
      'date',
      'coverpage',
      'lang',
      'sequence',
    ]);
    expect(titleInfo.getElementsByTagName('book-title')[0]!.textContent).toBe('My Book');
    expect(titleInfo.getElementsByTagName('last-name')[0]!.textContent).toBe('Writer');
    // Feature 011 (D31, FR-081): a year alone is no xs:date - the date keeps its text, no value.
    expect(titleInfo.getElementsByTagName('date')[0]!.getAttribute('value')).toBeNull();
    expect(titleInfo.getElementsByTagName('date')[0]!.textContent).toBe('2026');
    expect(titleInfo.getElementsByTagName('lang')[0]!.textContent).toBe('en');
    expect(
      titleInfo
        .getElementsByTagName('image')[0]!
        .getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
    ).toBe('#c.png');
    expect(doc.getElementsByTagName('document-info')).toHaveLength(1);
    const bodies = doc.getElementsByTagName('body');
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.getAttribute('name')).toBe('notes');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  });
});
