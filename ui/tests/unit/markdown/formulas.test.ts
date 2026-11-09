// Feature 011 (D50, FR-075b, SC-022): TeX formulas in Markdown by GitHub's rules - markers for the
// import flow, prices and escaped dollars left as text - and the export writing them back.
import { describe, expect, it } from 'vitest';

import { convertMarkdown } from '@/features/markdown/convert';
import { serializeMarkdown } from '@/features/markdown/export/serialize';
import type { BodyNode, Document } from '@/model/document';

import { fakeDocument } from '../features/testUtils';

const options = { fileName: 'f', baseDir: '', notesTitle: 'Notes' };

describe('formulas on import (D50)', () => {
  it('marks $…$ in a line and $$…$$ and ```math as blocks; prices and \\$ stay text', () => {
    const result = convertMarkdown(
      [
        '# T',
        '',
        'Euler: $e^{i\\pi} + 1 = 0$, costs $5 or $10, and \\$3 stays.',
        '',
        '$$',
        '\\int_0^1 x^2\\,dx = \\frac13',
        '$$',
        '',
        '```math',
        'a^2 + b^2 = c^2',
        '```',
        '',
        '> $$',
        '> x',
        '> $$',
        '',
        'In a line: $$y$$ too.',
        '',
      ].join('\n'),
      options,
    );
    expect(result.formulas.map((f) => [f.id, f.source, f.display])).toEqual([
      ['formula-1', 'e^{i\\pi} + 1 = 0', false],
      ['formula-2', '\\int_0^1 x^2\\,dx = \\frac13', true],
      ['formula-3', 'a^2 + b^2 = c^2', true],
      ['formula-4', 'x', true],
      ['formula-5', 'y', false],
    ]);
    expect(result.bodyXml).toContain('<!--mfbe-formula:0-->');
    expect(result.bodyXml).toContain('costs $5 or $10, and $3 stays.');
    // A block formula is a picture of its own; in a quote it sits in a paragraph.
    expect(result.formulas[1]!.imageXml).toBe(
      '<image l:href="#formula-2" alt="\\int_0^1 x^2\\,dx = \\frac13"/>',
    );
    expect(result.formulas[3]!.imageXml).toBe('<p><image l:href="#formula-4" alt="x"/></p>');
    expect(result.formulas[0]!.textXml).toBe('$e^{i\\pi} + 1 = 0$');
  });

  it('writes formula pictures back as $…$ in a line and $$…$$ as a block', () => {
    const body = {
      type: 'body',
      attrs: { nodeId: 'b' },
      content: [
        {
          type: 'section',
          attrs: { nodeId: 's' },
          content: [
            {
              type: 'p',
              attrs: { nodeId: 'p' },
              content: [
                { type: 'text', text: 'Euler: ' },
                { type: 'inline-image', attrs: { href: '#formula-1', alt: 'e' } },
              ],
            },
            { type: 'image', attrs: { nodeId: 'i', href: '#formula-2', alt: 'x' } },
          ],
        },
      ],
    };
    const document: Document = fakeDocument({ bodies: [body as unknown as BodyNode] });
    document.binaries = [
      { id: 'formula-1', contentType: 'image/png', size: 10 },
      { id: 'formula-2', contentType: 'image/png', size: 10 },
    ] as unknown as Document['binaries'];
    const out = serializeMarkdown(document, {
      form: 'zip',
      includePictures: true,
      diagramSources: new Map([
        ['formula-1', 'e^{i\\pi} + 1 = 0'],
        ['formula-2', '\\frac13'],
      ]),
    });
    expect(out.text).toContain('Euler: $e^{i\\pi} + 1 = 0$');
    expect(out.text).toContain('$$\n\\frac13\n$$');
    expect(out.pictures).toEqual([]);
  });
});
