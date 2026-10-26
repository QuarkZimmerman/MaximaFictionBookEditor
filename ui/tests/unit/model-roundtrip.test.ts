/**
 * Model <-> editor round trip (T048): every body of the JSON fixtures in
 * `tests/fixtures/json/` must convert to ProseMirror nodes and back deep-equal, including
 * raw-xml nodes, marks order and attributes; conversion of broken input must never throw.
 */

/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  annotationFromModel,
  bodyFromModel,
  createReport,
  docFromModel,
  nodeFromModel,
  type ModelNodeJson,
} from '@/editor/fromModel';
import { fb2Schema } from '@/editor/schema';
import { annotationToModel, bodyToModel, docToBodies, nodeToModel } from '@/editor/toModel';
import type { Document } from '@/model/document';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/json',
);

function loadDocuments(): Array<[string, Document]> {
  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name, JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'))] as const)
    .filter((entry): entry is [string, Document] => Array.isArray(entry[1].bodies))
    .map(([name, doc]) => [name, doc]);
}

const documents = loadDocuments();

describe('model round trip over tests/fixtures/json', () => {
  it('finds the body fixtures', () => {
    expect(documents.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'minimal-book.json',
        'rich-book.json',
        'description-full.json',
        'tables-book.json',
      ]),
    );
  });

  it.each(documents)('%s: bodies convert to ProseMirror and back deep-equal', (_name, doc) => {
    const report = createReport();
    const bodies = doc.bodies.map((body, index) =>
      bodyFromModel(body, report, `bodies[${index + 1}]`),
    );
    expect(report.problems).toEqual([]);
    for (const body of bodies) expect(() => body.check()).not.toThrow();
    expect(bodies.map(bodyToModel)).toEqual(doc.bodies);

    const { node: pmDoc, report: docReport } = docFromModel(doc);
    expect(docReport.problems).toEqual([]);
    expect(docToBodies(pmDoc)).toEqual(doc.bodies);
  });

  it.each(documents)('%s: annotation and history round-trip', (_name, doc) => {
    const annotation = doc.description.titleInfo.annotation;
    const history = doc.description.documentInfo.history;
    expect(annotationToModel(annotationFromModel(annotation))).toEqual(annotation);
    expect(annotationToModel(annotationFromModel(history))).toEqual(history);
  });

  it('tables-book.json holds cells with lang, marks with lang and xlinkType, atoms with marks, unknownAttrs, two styles in each order and two emphasis marks of different languages', () => {
    // Feature 006 (document-model "Tests to write"): the model book of tables.fb2 pins the
    // shapes the conversions above carry both ways.
    const tables = documents.find(([name]) => name === 'tables-book.json')![1];
    const nodes: ModelNodeJson[] = [];
    const visit = (node: ModelNodeJson) => {
      nodes.push(node);
      for (const child of node.content ?? []) visit(child);
    };
    for (const body of tables.bodies) visit(body as unknown as ModelNodeJson);
    // A mark as `{mark, ...attrs}` (a link's own `type` attribute keeps its name).
    const marksOf = (node: ModelNodeJson): Record<string, unknown>[] =>
      (node.marks ?? []).map((m) => ({ mark: m.type, ...(('attrs' in m && m.attrs) || {}) }));
    const cells = nodes.filter((n) => n.type === 'td' || n.type === 'th');
    expect(cells.some((c) => c.attrs?.lang === 'de')).toBe(true);
    expect(cells.some((c) => c.attrs?.lang === 'en-GB')).toBe(true);
    const texts = nodes.filter((n) => n.type === 'text');
    expect(
      texts.some((t) => marksOf(t).some((m) => m.mark === 'emphasis' && m.lang === 'la')),
    ).toBe(true);
    expect(
      texts.some((t) => marksOf(t).some((m) => m.mark === 'link' && m.xlinkType === 'simple')),
    ).toBe(true);
    const atoms = nodes.filter((n) => n.type === 'inline-image' || n.type === 'raw-xml');
    expect(atoms.some((a) => marksOf(a).some((m) => m.mark === 'link'))).toBe(true);
    expect(atoms.some((a) => marksOf(a).some((m) => m.mark === 'strong'))).toBe(true);
    expect(nodes.some((n) => n.attrs && 'unknownAttrs' in n.attrs)).toBe(true);
    const styles = (t: ModelNodeJson) =>
      marksOf(t)
        .filter((m) => m.mark === 'style')
        .map((m) => m.name);
    expect(texts.some((t) => JSON.stringify(styles(t)) === '["a","b"]')).toBe(true);
    expect(texts.some((t) => JSON.stringify(styles(t)) === '["b","a"]')).toBe(true);
    expect(
      texts.some(
        (t) =>
          JSON.stringify(
            marksOf(t)
              .filter((m) => m.mark === 'emphasis')
              .map((m) => m.lang),
          ) === '["la","de"]',
      ),
    ).toBe(true);
    // A carriage return as read from &#13;.
    expect(texts.some((t) => (t.text ?? '').includes('\r'))).toBe(true);
  });

  it('rich-book: marks arrive in canonical order, raw-xml keeps inline/block variants', () => {
    const rich = documents.find(([name]) => name === 'rich-book.json')![1];
    const body = bodyFromModel(rich.bodies[0]!);
    const section = body.child(3);
    expect(section.type.name).toBe('section');
    const lead = section.child(1);
    expect(lead.type.name).toBe('p');
    expect(lead.attrs.style).toBe('lead');
    const marked = lead.child(1);
    expect(marked.marks.map((m) => m.type.name)).toEqual(['strong', 'emphasis']);
    const inlineImage = lead.content.content.find((n) => n.type.name === 'inline_image');
    expect(inlineImage?.attrs.href).toBe('#smile.png');
    const rawBlock = section.content.content.find((n) => n.type.name === 'raw_xml');
    expect(rawBlock?.attrs.xml).toContain('<unknown-block');
    const inlineRawParent = section.content.content.find(
      (n) => n.type.name === 'p' && n.content.content.some((c) => c.type.name === 'raw_xml_inline'),
    );
    expect(inlineRawParent).toBeDefined();
    const table = section.content.content.find((n) => n.type.name === 'table')!;
    expect(table.firstChild!.attrs.align).toBe('center');
    expect(table.firstChild!.firstChild!.attrs.colspan).toBe(2);
    const poem = section.content.content.find((n) => n.type.name === 'poem')!;
    expect(poem.lastChild!.type.name).toBe('date');
    expect(poem.lastChild!.attrs.value).toBe('1900-01-01');
  });
});

describe('fromModel robustness', () => {
  const p = (text: string, nodeId = 'p1'): ModelNodeJson => ({
    type: 'p',
    attrs: { nodeId },
    content: [{ type: 'text', text }],
  });

  it('keeps schema-invalid content, reports it and still round-trips', () => {
    const report = createReport();
    // a section with a title after a paragraph (wrong order) and an empty section
    const body: ModelNodeJson = {
      type: 'body',
      attrs: { nodeId: 'b' },
      content: [
        {
          type: 'section',
          attrs: { nodeId: 's1' },
          content: [p('text'), { type: 'title', attrs: { nodeId: 't' }, content: [p('T', 'p2')] }],
        },
        { type: 'section', attrs: { nodeId: 's2' }, content: [] },
      ],
    };
    const node = nodeFromModel(body, report)!;
    expect(node.type.name).toBe('body');
    expect(report.problems.map((pr) => pr.path)).toEqual(['body/section[1]', 'body/section[2]']);
    expect(report.problems[0]!.nodeId).toBe('s1');
    expect(nodeToModel(node)).toEqual(body);
  });

  it('wraps unknown node types as raw-xml carrying the original JSON (lossless)', () => {
    const report = createReport();
    const weird: ModelNodeJson = {
      type: 'footnote-block',
      attrs: { nodeId: 'w1', depth: 3 },
      content: [p('inner', 'p3')],
    };
    const section: ModelNodeJson = {
      type: 'section',
      attrs: { nodeId: 's' },
      content: [
        p('ok'),
        weird,
        {
          type: 'p',
          attrs: { nodeId: 'p4' },
          content: [
            { type: 'text', text: 'a' },
            { type: 'glyph', attrs: { nodeId: 'g1', code: 7 } },
          ],
        },
      ],
    };
    const node = nodeFromModel(section, report)!;
    expect(node.child(1).type.name).toBe('raw_xml');
    expect(node.child(1).attrs.xml).toBe('<footnote-block/>');
    expect(node.child(2).child(1).type.name).toBe('raw_xml_inline');
    expect(report.problems.map((pr) => pr.message)).toEqual([
      'unknown node type "footnote-block"',
      'unknown node type "glyph"',
    ]);
    expect(nodeToModel(node)).toEqual(section);
  });

  it('preserves unknown attributes through extraAttrs and drops unknown marks with a report', () => {
    const report = createReport();
    const para: ModelNodeJson = {
      type: 'p',
      attrs: { nodeId: 'p1', id: 'x', weight: 'heavy' },
      content: [
        { type: 'text', text: 'hi', marks: [{ type: 'strong' }, { type: 'blink' } as never] },
      ],
    };
    const node = nodeFromModel(para, report)!;
    expect(node.attrs.extraAttrs).toEqual({ weight: 'heavy' });
    expect(report.problems).toEqual([
      { path: 'p/text[1]', message: 'unknown mark type "blink" dropped' },
    ]);
    expect(nodeToModel(node)).toEqual({
      type: 'p',
      attrs: { nodeId: 'p1', id: 'x', weight: 'heavy' },
      content: [{ type: 'text', text: 'hi', marks: [{ type: 'strong' }] }],
    });
  });

  it('drops empty text nodes and children of leaf nodes with a report; raw-xml inline flag is restored', () => {
    const report = createReport();
    const section: ModelNodeJson = {
      type: 'section',
      attrs: { nodeId: 's' },
      content: [
        { type: 'p', attrs: { nodeId: 'p1' }, content: [{ type: 'text', text: '' }] },
        { type: 'empty-line', attrs: { nodeId: 'e1' }, content: [p('x', 'p9')] },
        { type: 'raw-xml', attrs: { nodeId: 'r1', xml: '<a/>', inline: false } },
      ],
    };
    const node = nodeFromModel(section, report)!;
    expect(node.child(0).childCount).toBe(0);
    expect(node.child(1).type.name).toBe('empty_line');
    expect(node.child(2).type.name).toBe('raw_xml');
    expect(report.problems[0]!.message).toContain('leaf node "empty-line" had 1 children');
    const back = nodeToModel(node);
    expect(back.content![0]).toEqual({ type: 'p', attrs: { nodeId: 'p1' }, content: [] });
    expect(back.content![1]).toEqual({ type: 'empty-line', attrs: { nodeId: 'e1' } });
    expect(back.content![2]).toEqual({
      type: 'raw-xml',
      attrs: { nodeId: 'r1', xml: '<a/>', inline: false },
    });
  });

  it('bodyFromModel always yields a body and docFromModel accepts zero bodies', () => {
    const body = bodyFromModel({ type: 'p', attrs: { nodeId: 'z' }, content: [] } as never);
    expect(body.type).toBe(fb2Schema.nodes.body);
    const { node } = docFromModel({ bodies: [] });
    expect(node.childCount).toBe(0);
    expect(() => node.check()).not.toThrow();
  });
});
