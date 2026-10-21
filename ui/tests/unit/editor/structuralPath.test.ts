/**
 * Structural paths (feature 004, data-model §0.1; research R5.2, R5.3): the UI helper produces
 * the core's own path for every node of the parity fixture dumped by
 * tests/core/test_node_ids.cpp (`tests/fixtures/books/modern-utf8.paths.json`), in whole-book
 * and windowed mode; `resolvePosition` applies FR-101's fallback - exact hit, clamped paragraph,
 * clamped section, missing type, empty document, offset clamp - and the annotation / history
 * prefixes, counting an inline image as one unit and an astral character as the two UTF-16
 * units ProseMirror counts (the model offset of rpc-api.md "Definitions shared by the additions").
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';

import { docFromModel } from '@/editor/fromModel';
import { FIXED_BLOCK_IDS, findNodeById } from '@/editor/schema';
import { contentSize, pathOfCaret, pathOfNode, resolvePosition } from '@/editor/structuralPath';
import { createWindow, type SectionWindow } from '@/editor/virtualization';
import type { Document } from '@/model/document';

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/books/modern-utf8.paths.json',
);

interface ParityFixture {
  document: Document;
  paths: Record<string, string>;
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as ParityFixture;

/**
 * The paths of the fixture for the nodes the editor document holds: the bodies and - above
 * the first body since feature 004 US2 - the title-info annotation and the history with their
 * content (the two blocks carry the fixed UI ids, their paths are the roots themselves). The
 * source title info's annotation is not shown in the Body view.
 */
function bodyPaths(): Map<string, string> {
  const shown = (nodePath: string) =>
    nodePath.startsWith('body[') ||
    nodePath.startsWith('title-info/annotation[1]') ||
    nodePath.startsWith('document-info/history[1]');
  const paths = new Map(Object.entries(fixture.paths).filter(([, nodePath]) => shown(nodePath)));
  // The core's ids of the two roots are replaced by the fixed block ids in the editor document.
  for (const [id, nodePath] of [...paths]) {
    if (nodePath === 'title-info/annotation[1]') {
      paths.delete(id);
      paths.set(FIXED_BLOCK_IDS.annotation, nodePath);
    } else if (nodePath === 'document-info/history[1]') {
      paths.delete(id);
      paths.set(FIXED_BLOCK_IDS.history, nodePath);
    }
  }
  return paths;
}

function stateOf(window: SectionWindow): EditorState {
  return EditorState.create({ doc: window.doc });
}

describe('pathOfNode / pathOfCaret - parity with the core', () => {
  it('loads the fixture dumped by the core', () => {
    expect(fixture.document.bodies.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(fixture.paths).length).toBeGreaterThanOrEqual(40);
    expect(fixture.paths).toMatchObject({ n1: 'body[1]' });
  });

  it('yields the same path as node_path() for every node of the whole-book document', () => {
    const window = createWindow(fixture.document);
    expect(window.wholeBook).toBe(true);
    const state = stateOf(window);
    const expected = bodyPaths();
    let checked = 0;
    state.doc.descendants((node, pos) => {
      const id = node.attrs.nodeId as string | null;
      if (!id) return true;
      expect(pathOfNode(state, pos, window), `node ${id}`).toBe(expected.get(id));
      checked += 1;
      return true;
    });
    expect(checked).toBe(expected.size);
    // Inline images and empty lines are leaves with a path of their own.
    const inlineImage = [...expected.entries()].find(([, p]) => p.includes('inline-image'));
    expect(inlineImage).toBeDefined();
  });

  it('applies the body and section offsets of a windowed view', () => {
    const expected = bodyPaths();
    for (const bodyIndex of [0, 1]) {
      const window = createWindow(fixture.document, {
        forceWindowed: true,
        bodyIndex,
        start: 0,
        count: 50,
      });
      expect(window.wholeBook).toBe(false);
      const state = stateOf(window);
      state.doc.descendants((node, pos) => {
        const id = node.attrs.nodeId as string | null;
        if (!id) return true;
        expect(pathOfNode(state, pos, window), `node ${id} of body ${bodyIndex + 1}`).toBe(
          expected.get(id),
        );
        return true;
      });
    }
    // A window starting at the second section shifts the section index, not the header's.
    const body = fixture.document.bodies[0]!;
    const sections = body.content.filter((child) => child.type === 'section');
    if (sections.length >= 2) {
      const shifted = createWindow(fixture.document, {
        forceWindowed: true,
        bodyIndex: 0,
        start: 1,
        count: 1,
      });
      const state = stateOf(shifted);
      state.doc.descendants((node, pos) => {
        const id = node.attrs.nodeId as string | null;
        if (!id) return true;
        expect(pathOfNode(state, pos, shifted), `node ${id} in the shifted window`).toBe(
          expected.get(id),
        );
        return true;
      });
    }
  });

  it('names the text block of a caret and the selected leaf of a node selection', () => {
    const window = createWindow(fixture.document);
    const state = stateOf(window);
    const expected = bodyPaths();
    // The caret inside the first paragraph of the first section.
    const firstParagraphId = [...expected.entries()].find(
      ([, p]) => p === 'body[1]/section[1]/p[1]',
    )![0];
    const found = findNodeById(state.doc, firstParagraphId)!;
    const caret = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, found.pos + 2)),
    );
    expect(pathOfCaret(caret, window)).toBe('body[1]/section[1]/p[1]');
    // A selected inline image names the image.
    const inlineImage = [...expected.entries()].find(([, p]) => p.includes('inline-image'))!;
    const image = findNodeById(state.doc, inlineImage[0])!;
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, image.pos)));
    expect(pathOfCaret(selected, window)).toBe(inlineImage[1]);
    // A caret right before the inline image still names the paragraph.
    const before = state.apply(state.tr.setSelection(TextSelection.create(state.doc, image.pos)));
    expect(pathOfCaret(before, window)).toBe(inlineImage[1].replace(/\/inline-image\[\d+\]$/, ''));
    // An empty document has no path.
    const empty = EditorState.create({ doc: docFromModel({ bodies: [] }).node });
    expect(pathOfCaret(empty, null)).toBe('');
  });
});

describe('resolvePosition - FR-101', () => {
  type ModelNode = { type: string; attrs: { nodeId: string }; content?: unknown[] };
  const text = (value: string) => ({ type: 'text', text: value });
  const p = (id: string, ...content: unknown[]): ModelNode => ({
    type: 'p',
    attrs: { nodeId: id },
    content,
  });
  const section = (id: string, ...content: ModelNode[]): ModelNode => ({
    type: 'section',
    attrs: { nodeId: id },
    content,
  });
  const body = (id: string, ...content: ModelNode[]): ModelNode => ({
    type: 'body',
    attrs: { nodeId: id },
    content,
  });

  function model(bodies: ModelNode[], extra: Partial<Document['description']> = {}) {
    return {
      bodies: bodies as unknown as Document['bodies'],
      description: {
        titleInfo: {
          genres: [],
          authors: [],
          bookTitle: '',
          coverpage: [],
          lang: 'ru',
          translators: [],
          sequences: [],
        },
        documentInfo: {
          authors: [],
          date: { text: '' },
          srcUrls: [],
          id: '',
          version: '',
          publishers: [],
        },
        customInfo: [],
        outputs: [],
        ...extra,
      } as Document['description'],
    };
  }

  const book = model([
    body(
      'b1',
      section(
        's1',
        p('p1', text('Первый абзац.')),
        p('p2', text('Второй абзац.')),
        { type: 'empty-line', attrs: { nodeId: 'e1' } },
        p('p3', text('Третий.')),
      ),
      section('s2', p('p4', text('Четвёртый.'))),
    ),
    body('b2', section('n1', p('n1p1', text('Сноска.')))),
  ]);

  it('hits the exact node and keeps the offset within its content', () => {
    expect(resolvePosition(book, { path: 'body[1]/section[1]/p[2]', offset: 3 })).toEqual({
      nodeId: 'p2',
      offset: 3,
      exact: true,
    });
    expect(resolvePosition(book, { path: 'body[2]/section[1]/p[1]', offset: 0 })).toEqual({
      nodeId: 'n1p1',
      offset: 0,
      exact: true,
    });
    // Every text block path of the parity fixture resolves to its own id, both ways.
    for (const [id, nodePath] of Object.entries(fixture.paths)) {
      if (!/\/(p|subtitle|text-author|v|td|th|date)\[\d+\]$/.test(nodePath)) continue;
      if (!/^(body\[|title-info\/|document-info\/)/.test(nodePath)) continue;
      expect(resolvePosition(fixture.document, { path: nodePath, offset: 0 })).toEqual({
        nodeId: id,
        offset: 0,
        exact: true,
      });
    }
  });

  it('clamps a paragraph index to the last paragraph of that type', () => {
    expect(resolvePosition(book, { path: 'body[1]/section[1]/p[12]', offset: 2 })).toEqual({
      nodeId: 'p3',
      offset: 2,
      exact: false,
    });
  });

  it('clamps a section index to the section now at that place', () => {
    // section[3] no longer exists: the last section holds the place, its first paragraph the
    // twelfth one asked for (clamped to its only paragraph).
    expect(resolvePosition(book, { path: 'body[1]/section[3]/p[12]', offset: 4 })).toEqual({
      nodeId: 'p4',
      offset: 4,
      exact: false,
    });
    // A body index beyond the last body clamps to the last body.
    expect(resolvePosition(book, { path: 'body[5]/section[1]/p[1]', offset: 0 })).toEqual({
      nodeId: 'n1p1',
      offset: 0,
      exact: false,
    });
  });

  it('stops at the node reached when the type is missing and takes its first text block', () => {
    // No poem in the section: the section's first text block.
    expect(
      resolvePosition(book, { path: 'body[1]/section[2]/poem[1]/stanza[1]/v[3]', offset: 1 }),
    ).toEqual({ nodeId: 'p4', offset: 1, exact: false });
    // A path ending on a container descends to its first text block.
    expect(resolvePosition(book, { path: 'body[1]/section[1]', offset: 0 })).toEqual({
      nodeId: 'p1',
      offset: 0,
      exact: false,
    });
    // A path ending on a leaf without text (the empty line) lands on the leaf itself.
    expect(resolvePosition(book, { path: 'body[1]/section[1]/empty-line[1]', offset: 0 })).toEqual({
      nodeId: 'e1',
      offset: 0,
      exact: true,
    });
  });

  it('falls back to the document start: the first body, else the annotation block', () => {
    const start = { nodeId: 'p1', offset: 0, exact: false };
    expect(resolvePosition(book, { path: 'body[1]/section[1]/p[1]/x', offset: 0 }).nodeId).toBe(
      'p1',
    );
    expect(resolvePosition(book, { path: 'src-title-info/annotation[1]/p[1]', offset: 0 })).toEqual(
      start,
    );
    expect(resolvePosition(book, { path: 'nonsense', offset: 0 })).toEqual(start);
    expect(resolvePosition(book, { path: '', offset: 0 })).toEqual(start);
    // The annotation named by the path is absent: the document start.
    expect(resolvePosition(book, { path: 'title-info/annotation[1]/p[1]', offset: 2 })).toEqual(
      start,
    );
    // A body whose first element has no text at all: the body itself.
    const imageOnly = model([
      body('b1', { type: 'image', attrs: { nodeId: 'i1' } } as unknown as ModelNode),
    ]);
    expect(resolvePosition(imageOnly, { path: 'body[1]/section[2]/p[1]', offset: 0 })).toEqual({
      nodeId: 'b1',
      offset: 0,
      exact: false,
    });
    // No body and no block: the annotation block of the Body view (a body-less .fbd).
    expect(resolvePosition(model([]), { path: 'body[1]/section[1]/p[1]', offset: 7 })).toEqual({
      nodeId: FIXED_BLOCK_IDS.annotation,
      offset: 0,
      exact: false,
    });
  });

  it('clamps the offset to the content size, counting atoms and UTF-16 units as ProseMirror', () => {
    const annotated = model([body('b1', section('s1', p('p1', text('abc'))))], {
      titleInfo: {
        genres: [],
        authors: [],
        bookTitle: '',
        coverpage: [],
        lang: 'ru',
        translators: [],
        sequences: [],
        annotation: {
          type: 'annotation',
          attrs: { nodeId: 'a1' },
          content: [
            p('a1p1', text('a😀b')) as never,
            p(
              'a1p2',
              text('x'),
              { type: 'inline-image', attrs: { nodeId: 'img1', href: '#i.png' } },
              text('y'),
            ) as never,
          ],
        },
      },
      documentInfo: {
        authors: [],
        date: { text: '' },
        srcUrls: [],
        id: '',
        version: '',
        publishers: [],
        history: {
          type: 'annotation',
          attrs: { nodeId: 'h1', lang: 'ru' },
          content: [p('h1p1', text('v1')) as never, p('h1p2', text('v2 — вычитка')) as never],
        },
      },
    });
    // The annotation and history prefixes.
    expect(
      resolvePosition(annotated, { path: 'title-info/annotation[1]/p[1]', offset: 2 }),
    ).toEqual({ nodeId: 'a1p1', offset: 2, exact: true });
    expect(
      resolvePosition(annotated, { path: 'document-info/history[1]/p[2]', offset: 3 }),
    ).toEqual({ nodeId: 'h1p2', offset: 3, exact: true });
    expect(
      resolvePosition(annotated, { path: 'document-info/history[1]/p[9]', offset: 0 }),
    ).toEqual({ nodeId: 'h1p2', offset: 0, exact: false });
    // "a😀b" is four UTF-16 units; the inline image counts one unit: "x" + image + "y" = 3.
    const astral = annotated.description.titleInfo.annotation!.content[0]!;
    const withImage = annotated.description.titleInfo.annotation!.content[1]!;
    expect(contentSize(astral)).toBe(4);
    expect(contentSize(withImage)).toBe(3);
    expect(
      resolvePosition(annotated, { path: 'title-info/annotation[1]/p[1]', offset: 4 }),
    ).toEqual({ nodeId: 'a1p1', offset: 4, exact: true });
    expect(
      resolvePosition(annotated, { path: 'title-info/annotation[1]/p[1]', offset: 40 }),
    ).toEqual({ nodeId: 'a1p1', offset: 4, exact: false });
    expect(
      resolvePosition(annotated, { path: 'title-info/annotation[1]/p[2]', offset: 3 }),
    ).toEqual({ nodeId: 'a1p2', offset: 3, exact: true });
    expect(
      resolvePosition(annotated, { path: 'title-info/annotation[1]/p[2]', offset: 5 }),
    ).toEqual({ nodeId: 'a1p2', offset: 3, exact: false });
    // Negative and fractional offsets are tamed.
    expect(resolvePosition(annotated, { path: 'body[1]/section[1]/p[1]', offset: -3 })).toEqual({
      nodeId: 'p1',
      offset: 0,
      exact: false,
    });
    expect(resolvePosition(annotated, { path: 'body[1]/section[1]/p[1]', offset: 1.5 })).toEqual({
      nodeId: 'p1',
      offset: 1,
      exact: false,
    });
    // ProseMirror counts the same: the editor document's paragraph has content size 4.
    const window = createWindow(model([body('b1', section('s1', p('p1', text('a😀b')) as never))]));
    const found = findNodeById(window.doc, 'p1')!;
    expect(found.node.content.size).toBe(4);
  });
});
