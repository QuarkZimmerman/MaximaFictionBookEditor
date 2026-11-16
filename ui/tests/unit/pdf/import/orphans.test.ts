/**
 * Feature 016 (D6, D32): marked content the structure holds but the reader could not reach - the orphans - goes
 * back where it belongs. Built as the library run found it in the editor's own PDFs before the role map kept
 * PDF 2.0's Strong and Em (a PDF without a role map of another program still gives such orphans).
 */
import { describe, expect, it } from 'vitest';

import type { StructElement, StructLeaf } from '@/features/pdf/import/model';
import { flatten, partText } from '@/features/pdf/import/parts';

const leaf = (mcid: number, text: string, at: Partial<StructLeaf> = {}): StructLeaf => ({
  page: 5,
  mcid,
  text,
  size: 10.5,
  ...at,
});
const p = (...kids: StructLeaf[]): StructElement => ({
  type: 'P',
  kids: [{ type: 'NonStruct', kids }],
});
const texts = (structure: StructElement[], orphans: StructLeaf[]): string[] =>
  flatten(structure, orphans).parts.map((part) => partText(part.runs));

describe('orphans of the structure', () => {
  it('fill the empty elements between their neighbours, a line each', () => {
    const structure: StructElement[] = [
      { type: 'H2', kids: [{ type: 'NonStruct', kids: [] }] },
      p(),
      p(
        leaf(2, 'Houlun sent the old servant.', {
          top: 120,
          left: 42.5,
          right: 370,
          startTop: 120,
        }),
      ),
    ];
    const orphans = [
      leaf(0, 'ERSTES BUCH', {
        top: 64,
        left: 162,
        right: 257,
        startLeft: 162,
        startTop: 64,
        endTop: 64,
      }),
      leaf(1, 'I', { top: 98, left: 58.3, right: 62.5, startLeft: 58.3, startTop: 98, endTop: 98 }),
    ];
    expect(texts(structure, orphans)).toEqual(['ERSTES BUCH', 'I', 'Houlun sent the old servant.']);
  });

  it('join the paragraph they stand in, in the order of their marked content', () => {
    const structure = [
      p(
        leaf(0, 'Plain ', { top: 100, left: 42.5, right: 70, endRight: 70, endTop: 100 }),
        leaf(2, ' text.', { top: 100, left: 95, right: 120, startLeft: 95, startTop: 100 }),
      ),
    ];
    const orphans = [
      leaf(1, 'bold', { top: 100, left: 70, right: 95, startLeft: 70, startTop: 100, endTop: 100 }),
    ];
    expect(texts(structure, orphans)).toEqual(['Plain bold text.']);
  });

  it('begin the next paragraph from a line of their own with the first-line indent', () => {
    const structure = [
      p(
        leaf(8, 'One can also use aloe juice.', {
          top: 437,
          left: 42.5,
          right: 370,
          endRight: 300,
          endTop: 469,
        }),
      ),
      p(
        leaf(10, ' - hastens the shoots.', {
          top: 500,
          left: 42.5,
          right: 370,
          startLeft: 42.5,
          startTop: 500,
        }),
      ),
    ];
    const orphans = [
      leaf(9, 'The next step is soaking', {
        top: 485,
        left: 58.3,
        right: 330,
        startLeft: 58.3,
        startTop: 485,
        endTop: 485,
      }),
    ];
    expect(texts(structure, orphans)).toEqual([
      'One can also use aloe juice.',
      'The next step is soaking - hastens the shoots.',
    ]);
  });

  it('close the paragraph before from its full line, before paragraphs wholly of orphans', () => {
    const structure = [
      p(
        leaf(3, '"Khleeg!" he declared, reverting to the Ogre tongue.', {
          top: 100,
          left: 42.5,
          right: 372,
          endRight: 371,
          endTop: 116,
        }),
      ),
      p(),
      p(),
      p(
        leaf(7, 'He raised a fist.', {
          top: 180,
          left: 42.5,
          right: 300,
          startLeft: 58.3,
          startTop: 180,
        }),
      ),
    ];
    const orphans = [
      leaf(4, ' "Falan du hach!"', {
        top: 132,
        left: 42.5,
        right: 120,
        startLeft: 42.5,
        startTop: 132,
        endTop: 132,
      }),
      leaf(5, '"Falan du hach?"', {
        top: 148,
        left: 58.3,
        right: 140,
        startLeft: 58.3,
        startTop: 148,
        endTop: 148,
      }),
      leaf(6, '"Ke!"', {
        top: 164,
        left: 58.3,
        right: 90,
        startLeft: 58.3,
        startTop: 164,
        endTop: 164,
      }),
    ];
    expect(texts(structure, orphans)).toEqual([
      '"Khleeg!" he declared, reverting to the Ogre tongue. "Falan du hach!"',
      '"Falan du hach?"',
      '"Ke!"',
      'He raised a fist.',
    ]);
  });
});
