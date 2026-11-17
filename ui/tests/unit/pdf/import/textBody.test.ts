/**
 * Feature 016 (D11, D32; tasks T065): the body of a PDF not made by the editor keeps to FB2's sections - a
 * section holds either its own text or subsections, never both, and more than a title (the library's PDFs
 * found both).
 */
import { describe, expect, it } from 'vitest';

import type { Part } from '@/features/pdf/import/parts';
import { textBody } from '@/features/pdf/import/text';

const p = (text: string): Part => ({ kind: 'p', page: 1, runs: [{ text, page: 1 }] });
const title = (text: string, level: number): Part => ({
  kind: 'title',
  page: 1,
  runs: [{ text, page: 1 }],
  level,
});

describe('the sections of a PDF without the editor’s record (D11)', () => {
  it('puts a section’s text before its subsections into an untitled first one, and fills an empty one', () => {
    const { xml } = textBody(
      [p('Lead'), title('Sub', 2), p('Body'), title('Next', 1)],
      () => null,
      () => null,
    );
    expect(xml).toBe(
      '<body><section><section><p>Lead</p></section><section><title><p>Sub</p></title><p>Body</p></section></section>' +
        '<section><title><p>Next</p></title><empty-line/></section></body>',
    );
  });

  it('lets one picture stand at a section’s top, and starts its text with no picture', () => {
    const figure = (id: string): Part => ({ kind: 'figure', page: 1, runs: [], readerId: id });
    const { xml } = textBody(
      [figure('a'), figure('b'), p('Text'), title('Plates', 1), figure('c')],
      () => null,
      (_p, _a, id) => id ?? null,
    );
    expect(xml).toBe(
      '<body><section><image l:href="#a"/><empty-line/><image l:href="#b"/><p>Text</p></section>' +
        '<section><title><p>Plates</p></title><image l:href="#c"/><empty-line/></section></body>',
    );
  });

  it('joins consecutive title lines of one level into one title', () => {
    const { xml, counts } = textBody(
      [title('One', 1), title('line two', 1), p('Text')],
      () => null,
      () => null,
    );
    expect(xml).toBe(
      '<body><section><title><p>One</p><p>line two</p></title><p>Text</p></section></body>',
    );
    expect(counts.sections).toBe(1);
  });
});
