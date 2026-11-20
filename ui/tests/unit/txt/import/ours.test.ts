// Feature 017 (T048; D5, D28, D29): the editor's own TXT read back - recognised by its record; the record's
// fields, the title page's annotation, and the note blocks with their references, from a book exported by
// the TXT layout itself.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { layoutTxt } from '@/features/txt/export/layout';
import { ownBodies, ownDescription, parseOwnTxt } from '@/features/txt/import/ours';
import type { Document } from '@/model/document';

const MODELS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../tests/fixtures/txt/models',
);
const LISTS = {
  genres: [
    {
      code: 'sf',
      category: 'sf',
      names: { en: 'Science Fiction', ru: 'Научная фантастика', uk: 'Наукова фантастика' },
      source: 'standard',
    },
  ],
  languages: [
    { code: 'en', names: { en: 'English', ru: 'Английский', uk: 'Англійська' } },
    { code: 'ru', names: { en: 'Russian', ru: 'Русский', uk: 'Російська' } },
  ],
};
const TEMPLATE =
  '<FictionBook><description><title-info><genre>prose</genre><author><last-name/></author>' +
  '<book-title/><lang>en</lang></title-info><document-info><id>x</id></document-info></description></FictionBook>';

const model = (name: string): Document =>
  JSON.parse(readFileSync(path.join(MODELS, `${name}.json`), 'utf8')) as Document;
const exported = (name: string): string => layoutTxt(model(name), LISTS, name, '0.0.12').text;

describe("the editor's own TXT (D5, D28, D29)", () => {
  it('is recognised by its record, whatever the version', () => {
    expect(parseOwnTxt(exported('reference-all-elements'))).not.toBeNull();
    expect(
      parseOwnTxt(exported('reference-all-elements').replace('0.0.12', '0.1.0-rc.3')),
    ).not.toBeNull();
    // A damaged record (an unknown label) is read as a TXT made elsewhere.
    expect(
      parseOwnTxt(exported('reference-all-elements').replace('\nCity:', '\nTown:')),
    ).toBeNull();
    expect(parseOwnTxt('Just a text.\n')).toBeNull();
  });

  it('gives the description back from the record and the annotation', () => {
    const own = parseOwnTxt(exported('modern-utf8'))!;
    const { xml } = ownDescription(own, TEMPLATE, LISTS);
    expect(xml).toContain('<book-title>Современная книга</book-title>');
    expect(xml).toContain('<sequence name="Серия" number="3"/>');
    expect(xml).toContain('<genre>sf</genre>');
    expect(xml).toContain('<lang>ru</lang>');
    expect(xml).toContain('<src-lang>en</src-lang>');
    expect(xml).toContain(
      '<author><first-name>Анна</first-name><middle-name>Петровна</middle-name><last-name>Иванова</last-name></author>',
    );
    // A nickname alone stays a nickname.
    expect(xml).toContain('<author><nickname>Соавтор</nickname></author>');
    expect(xml).toContain('<annotation><p>Аннотация с курсивом.</p>');
    expect(xml).toContain('<publisher>Издательство</publisher>');
    expect(xml).toContain('<document-info><id>x</id></document-info>');
  });

  it('turns the note blocks into notes and links their references', () => {
    const own = parseOwnTxt(exported('long-notes'))!;
    const { xml, notes } = ownBodies(own);
    expect(notes).toBe(3);
    expect(xml).toContain('<a l:href="#n_1" type="note">[1]</a>');
    expect(xml).toContain('<a l:href="#n_3" type="note">[{1}]</a>');
    expect(xml).toContain('<body name="notes"><section id="n_1"><title><p>1</p></title>');
    expect(xml).not.toContain('-- Note');
  });
});
