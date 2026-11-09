// Feature 011 (SC-011): hostile books give a Markdown text within the budgets, never a crash or a
// hang - 10,000 sections, a table of 10,000 rows, sections nested 50 deep, picture ids that clash
// without regard to letter case.
import { describe, expect, it } from 'vitest';

import type { ModelNodeJson } from '@/editor/fromModel';
import { serializeMarkdown } from '@/features/markdown/export/serialize';
import type { BodyNode, Document } from '@/model/document';

import { fakeDocument } from '../features/testUtils';

let ids = 0;
const id = () => `h${(ids += 1)}`;
const text = (value: string): ModelNodeJson => ({ type: 'text', text: value });
const p = (value: string): ModelNodeJson => ({
  type: 'p',
  attrs: { nodeId: id() },
  content: [text(value)],
});
const section = (content: ModelNodeJson[]): ModelNodeJson => ({
  type: 'section',
  attrs: { nodeId: id() },
  content,
});
const bookOf = (content: ModelNodeJson[]): Document =>
  fakeDocument({
    bodies: [{ type: 'body', attrs: { nodeId: id() }, content } as unknown as BodyNode],
  });

/** Runs `work` and returns its result and the milliseconds it took. */
function timed<T>(work: () => T): [T, number] {
  const started = performance.now();
  const result = work();
  return [result, performance.now() - started];
}

describe('hostile books (SC-011)', () => {
  it('10,000 sections', () => {
    const sections = Array.from({ length: 10_000 }, (_, i) =>
      section([
        { type: 'title', attrs: { nodeId: id() }, content: [p(`Chapter ${i + 1}`)] },
        p('Text.'),
      ]),
    );
    const [out, ms] = timed(() =>
      serializeMarkdown(bookOf(sections), { form: 'zip', includePictures: true }),
    );
    expect(out.written.sections).toBe(10_000);
    expect(out.text).toContain('## Chapter 10000');
    expect(ms).toBeLessThan(5_000);
  });

  it('a table of 10,000 rows', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      type: 'tr',
      attrs: { nodeId: id() },
      content: [
        { type: 'td', attrs: { nodeId: id() }, content: [text(`r${i}`)] },
        { type: 'td', attrs: { nodeId: id() }, content: [text('x')] },
      ],
    }));
    const table: ModelNodeJson = { type: 'table', attrs: { nodeId: id() }, content: rows };
    const [out, ms] = timed(() =>
      serializeMarkdown(bookOf([section([table])]), { form: 'zip', includePictures: true }),
    );
    expect(out.written.tables).toBe(1);
    expect(out.text).toContain('| r9999 | x |');
    expect(ms).toBeLessThan(5_000);
  });

  it('sections nested 50 deep', () => {
    let inner = section([p('the deepest text')]);
    for (let depth = 0; depth < 49; depth += 1) inner = section([p(`level ${depth}`), inner]);
    const [out, ms] = timed(() =>
      serializeMarkdown(bookOf([inner]), { form: 'zip', includePictures: true }),
    );
    expect(out.written.sections).toBe(50);
    expect(out.text).toContain('the deepest text');
    expect(out.text).not.toMatch(/#{7}/);
    expect(ms).toBeLessThan(5_000);
  });

  it('picture ids that clash without regard to letter case get names of their own', () => {
    const document = bookOf([
      section([
        { type: 'image', attrs: { nodeId: id(), href: '#Pic.png' } },
        { type: 'image', attrs: { nodeId: id(), href: '#pic.png' } },
        { type: 'image', attrs: { nodeId: id(), href: '#PIC.PNG' } },
      ]),
    ]);
    document.binaries = ['Pic.png', 'pic.png', 'PIC.PNG'].map(
      (binaryId) =>
        ({
          id: binaryId,
          contentType: 'image/png',
          size: 1,
        }) as unknown as Document['binaries'][number],
    );
    const out = serializeMarkdown(document, { form: 'zip', includePictures: true });
    const names = out.pictures.map((picture) => picture.name.toLowerCase());
    expect(new Set(names).size).toBe(3);
  });
});
