/**
 * Unit tests for Source view CodeMirror 6 Maxima Library `<custom-info>` highlight extension
 * (feature 021, T034, FR-027, research.md R6).
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { MAXIMA_LIBRARY_CUSTOM_INFO_TYPES } from '@/features/description/maximaIdentities';
import {
  findMaximaCustomInfoRanges,
  fullSyntaxTree,
  maximaCustomInfoHighlightExtension,
  sourceLanguage,
} from '@/views/source/extensions';

const ALL_15_MARKERS = [...MAXIMA_LIBRARY_CUSTOM_INFO_TYPES];

function buildXml(customLines: string[]): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">',
    '  <description>',
    '    <title-info><book-title>Sample</book-title></title-info>',
    ...customLines.map((line) => `    ${line}`),
    '  </description>',
    '  <body><section><p>Text</p></section></body>',
    '</FictionBook>',
  ].join('\n');
}

describe('maximaCustomInfoHighlightExtension (T034)', () => {
  it('detects all 15 Maxima Library custom-info tags and skips unrelated custom-info elements', () => {
    const lines = [
      ...ALL_15_MARKERS.map(
        (marker, idx) => `<custom-info info-type="${marker}">${idx + 1} Value</custom-info>`,
      ),
      '<custom-info info-type="unrelated">Do not highlight</custom-info>',
      '<custom-info>No info-type attribute</custom-info>',
      '<!-- <custom-info info-type="mlauthorid">Commented out</custom-info> -->',
    ];
    const doc = buildXml(lines);
    const state = EditorState.create({ doc, extensions: [sourceLanguage()] });
    const tree = fullSyntaxTree(state);
    const ranges = findMaximaCustomInfoRanges(state, [{ from: 0, to: doc.length }], tree);

    expect(ranges).toHaveLength(15);
    const texts = ranges.map((r) => doc.slice(r.from, r.to));
    for (const marker of ALL_15_MARKERS) {
      expect(texts.some((text) => text.includes(`info-type="${marker}"`))).toBe(true);
    }
    expect(texts.some((text) => text.includes('unrelated'))).toBe(false);
    expect(texts.some((text) => text.includes('No info-type'))).toBe(false);
    expect(texts.some((text) => text.includes('Commented out'))).toBe(false);
  });

  it('handles single quotes, double quotes, self-closing, and multiline elements', () => {
    const doc = buildXml([
      "<custom-info info-type='mlauthorid'>101 Single Quotes</custom-info>",
      '<custom-info\n      info-type="mlseriesid">\n      301 Multiline\n    </custom-info>',
      '<custom-info info-type="mlillustrator" />',
      '<custom-info info-type="ordinary">Plain</custom-info>',
    ]);
    const state = EditorState.create({ doc, extensions: [sourceLanguage()] });
    const tree = fullSyntaxTree(state);
    const ranges = findMaximaCustomInfoRanges(state, [{ from: 0, to: doc.length }], tree);

    expect(ranges).toHaveLength(3);
    expect(doc.slice(ranges[0]!.from, ranges[0]!.to)).toContain('Single Quotes');
    expect(doc.slice(ranges[1]!.from, ranges[1]!.to)).toContain('Multiline');
    expect(doc.slice(ranges[2]!.from, ranges[2]!.to)).toContain('mlillustrator');
  });

  it('renders cm-maxima-custom-info decorations in EditorView with zero edit protection', () => {
    const doc = buildXml([
      '<custom-info info-type="mlauthorid">101 Толстой Лев</custom-info>',
      '<custom-info info-type="other">Plain</custom-info>',
    ]);
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [sourceLanguage(), maximaCustomInfoHighlightExtension()],
      }),
    });

    try {
      // Force full parse so decorations reflect the complete document.
      fullSyntaxTree(view.state);
      view.dispatch({});

      const highlighted = parent.querySelectorAll('.cm-maxima-custom-info');
      expect(highlighted.length).toBeGreaterThan(0);
      expect(
        Array.from(highlighted)
          .map((el) => el.textContent)
          .join(''),
      ).toContain('101 Толстой Лев');

      // Direct edit inside the highlighted tag succeeds without any read-only or atomic block.
      const idx = view.state.doc.toString().indexOf('Толстой');
      expect(idx).toBeGreaterThan(0);
      view.dispatch({ changes: { from: idx, to: idx + 'Толстой'.length, insert: 'Чехов' } });
      expect(view.state.doc.toString()).toContain('101 Чехов Лев');

      // Renaming info-type away from Maxima markers immediately drops the highlight.
      const typeIdx = view.state.doc.toString().indexOf('mlauthorid');
      view.dispatch({
        changes: { from: typeIdx, to: typeIdx + 'mlauthorid'.length, insert: 'customtag' },
      });
      fullSyntaxTree(view.state);
      view.dispatch({});
      expect(parent.querySelectorAll('.cm-maxima-custom-info')).toHaveLength(0);
    } finally {
      view.destroy();
      parent.remove();
    }
  });
});
