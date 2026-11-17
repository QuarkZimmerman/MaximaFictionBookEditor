/**
 * Notes written with superscript numbers (issue #16; the requester's decision after his smoke test of
 * 0.0.12-rc.1): made Markdown footnotes where that is unambiguous, left as they are otherwise.
 */
import { describe, expect, it } from 'vitest';

import { convertMarkdown } from '@/features/markdown/convert';
import { superscriptNotes } from '@/features/markdown/superscriptNotes';

const ISSUE = `## Глава первая

Олени ... туристов¹. Пять бывших аскетов ... Сиддхартха² перестанет.

---

¹ В Плоском мире туристы — это особая форма жизни.

² Имя «Будда» он получит позже.

---
`;

describe('notes written with superscript numbers', () => {
  it('become footnotes: the markers in the text, the paragraphs after the break, the breaks gone', () => {
    expect(superscriptNotes(ISSUE)).toBe(`## Глава первая

Олени ... туристов[^sup1-1]. Пять бывших аскетов ... Сиддхартха[^sup1-2] перестанет.


[^sup1-1]: В Плоском мире туристы — это особая форма жизни.

[^sup1-2]: Имя «Будда» он получит позже.

`);
  });

  it('come into the book as its notes', () => {
    const { bodyXml, notesXml, stats } = convertMarkdown(ISSUE, {
      fileName: 't',
      baseDir: '/tmp',
      notesTitle: 'Примечания',
    });
    const xml = `${bodyXml}${notesXml ?? ''}`;
    expect(stats.notes).toBe(2);
    expect(xml).toContain('туристов<a l:href="#n_1" type="note">');
    expect(xml).toContain('Сиддхартха<a l:href="#n_2" type="note">');
    expect(notesXml).toMatch(/В Плоском мире туристы[\s\S]*Имя «Будда»/);
    expect(xml).not.toContain('* * *');
    expect(xml).not.toContain('¹');
  });

  it('restart in each chapter that has its own', () => {
    const md = `# One\n\nA¹ b.\n\n---\n\n¹ First.\n\n# Two\n\nC¹ d.\n\n---\n\n¹ Second.\n`;
    const out = superscriptNotes(md);
    expect(out).toContain('A[^sup1-1] b.');
    expect(out).toContain('[^sup1-1]: First.');
    expect(out).toContain('C[^sup2-1] d.');
    expect(out).toContain('[^sup2-1]: Second.');
  });

  it('are left alone where a number stands twice, a paragraph after the break is no note, or in code', () => {
    const twice = `Площадь 5 м² и дом².\n\n---\n\n² Дом с садом.\n`;
    expect(superscriptNotes(twice)).toBe(twice);
    const mixed = `Text¹.\n\n---\n\n¹ A note.\n\nMore text, no note.\n`;
    expect(superscriptNotes(mixed)).toBe(mixed);
    const missing = `Text without markers.\n\n---\n\n¹ A note nobody refers to.\n`;
    expect(superscriptNotes(missing)).toBe(missing);
    const fenced = 'Text `x¹` and y¹.\n\n```\nz¹\n```\n\n---\n\n¹ The note.\n';
    expect(superscriptNotes(fenced)).toBe(
      'Text `x¹` and y[^sup1-1].\n\n```\nz¹\n```\n\n\n[^sup1-1]: The note.\n',
    );
    const plain = 'Площадь 5 м².\n';
    expect(superscriptNotes(plain)).toBe(plain);
  });
});
