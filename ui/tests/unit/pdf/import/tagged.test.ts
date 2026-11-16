/**
 * Feature 016 (User Story 2; D11; tasks T035): a tagged PDF not made by the editor, read by its structure
 * (fixtures/tagged.document.json, from tests/fixtures/pdf/import/tagged.pdf, printed by Chromium): headings
 * open sections, list items become paragraphs, the table keeps its cells.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { PdfDocumentModel } from '@/features/pdf/import/model';
import { flatten, partText } from '@/features/pdf/import/parts';
import { textBody } from '@/features/pdf/import/text';

const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const doc = JSON.parse(
  readFileSync(path.join(HERE, 'tagged.document.json'), 'utf8'),
) as PdfDocumentModel;

describe('a tagged PDF (US2)', () => {
  const { parts } = flatten(doc.structure ?? [], doc.orphans ?? []);

  it('reads its headings, paragraphs, list items and table in order', () => {
    const kinds = parts.map((part) => part.kind);
    expect(kinds[0]).toBe('title');
    expect(kinds).toContain('table');
    const texts = parts.map((part) => partText(part.runs).trim());
    expect(texts[0]).toBe('Heading One');
    expect(texts).toContain('First item');
  });

  it('makes FB2 sections of the headings and keeps the cells', () => {
    const body = textBody(
      parts,
      () => null,
      () => null,
    );
    expect(body.xml).toMatch(/^<body><section><title><p>Heading One<\/p><\/title>/);
    expect(body.xml).toContain('<td>Cell one</td>');
    expect(body.counts.tables).toBe(1);
    expect(
      new DOMParser()
        .parseFromString(`<r>${body.xml}</r>`, 'application/xml')
        .querySelector('parsererror'),
    ).toBeNull();
  });

  it('reads a table whose text lies loose under it, its cells empty, line by line (D32)', () => {
    const leaf = (mcid: number, text: string, top: number) => ({
      page: 3,
      mcid,
      text,
      startTop: top,
      endTop: top,
    });
    const { parts: loose } = flatten(
      [
        {
          type: 'Table',
          kids: [
            leaf(0, 'AWE', 100),
            leaf(1, 'Atomic Weapons Establishment', 100),
            { type: 'TR', kids: [{ type: 'TD', kids: [] }] },
            leaf(2, 'BA', 120),
            leaf(3, 'British Airways', 120),
          ],
        },
      ] as unknown as NonNullable<PdfDocumentModel['structure']>,
      [],
    );
    expect(loose.map((part) => [part.kind, partText(part.runs)])).toEqual([
      ['p', 'AWE Atomic Weapons Establishment'],
      ['p', 'BA British Airways'],
    ]);
  });
});
