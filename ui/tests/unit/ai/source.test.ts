/**
 * The Source view's half of a request (feature 005 T069; ai-catalogue §8; data-model §4.2 Source
 * column, §6.4 text path, §7.5; review C11; FR-070 to FR-072): the classification of a Source
 * selection from the model points the position map answers (`inline` inside one text
 * container, `blocks` from a block's `<` to a block's `>` under one parent, `source` for
 * anything else and for `null` points), the refused ranges (a binary, the stylesheet, the XML
 * declaration, the root start tag), the text splice as one CodeMirror change, the text-path
 * gate (`xml.notWellFormed` → `invalidXml` with the position relative to the replacement; the
 * multiset rule against the baseline, which is the last well-formed text's report under FR-072),
 * `structuredAllowed` false after an accepted splice, the tool gate of the text mode and after a
 * text change, and one `doc.fromXml` at the commit with the binary store asserted.
 */

import { selectionHolder, type ModelSelection } from '@/ai/catalogue';
import { ChangeRejection, multiset, type IssueMultiset } from '@/ai/hook';
import { startRequestSession, type RequestSession } from '@/ai/session';
import {
  classifySourceSelection,
  commitSource,
  countContainerTags,
  elementEndOffset,
  firstChangedNodeId,
  insideTag,
  lineColumnOf,
  offsetOfLineColumn,
  offsetsToMap,
  protectedRanges,
  REFUSED_RANGE_MESSAGE,
  refusedRange,
  relativePosition,
  sameBinaries,
  SOURCE_TEXT_MODE_TOOL_NAMES,
  sourceModelSelection,
  sourcePresenter,
  sourceSnapshot,
  sourceTextReplacer,
  sourceToolGate,
  spliceText,
  STRUCTURED_CHANGE_TOOL_NAMES,
  tagShape,
  TEXT_CHANGED_HINT,
  TEXT_MODE_HINT,
  textPathOutcome,
  textPathSpec,
  type SourceRequestState,
} from '@/ai/source';
import type { Document, ValidationIssue, ValidationReport } from '@/model/document';
import type { ModelPoint } from '@/rpc/types';
import { SourceEditorController } from '@/views/source/sourceEditor';
import { sourceSession } from '@/views/source/sync';

import { book, fakeToXml } from './catalogueHarness';
import { harness as sessionHarness } from './sessionUtils';

/* ------------------------------------------------------------------------ */
/* A Source text of the harness book                                        */
/* ------------------------------------------------------------------------ */

const TEXT = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
\t<stylesheet type="text/css">p { text-indent: 1.5em; }</stylesheet>
\t<description>
\t\t<title-info>
\t\t\t<book-title>Alpha</book-title>
\t\t\t<annotation>
\t\t\t\t<p>About the book.</p>
\t\t\t</annotation>
\t\t</title-info>
\t</description>
\t<body>
\t\t<title>
\t\t\t<p>The Book</p>
\t\t</title>
\t\t<section>
\t\t\t<title>
\t\t\t\t<p>ONE</p>
\t\t\t</title>
\t\t\t<p>Alpha beta gamma.</p>
\t\t\t<p>He <emphasis>went</emphasis> out<a l:href="#n_1" type="note">1</a>.</p>
\t\t\t<p>Beta again, and beta once more.</p>
\t\t\t<image l:href="#cover.png" alt="Cover"/>
\t\t\t<empty-line/>
\t\t</section>
\t\t<section>
\t\t\t<title>
\t\t\t\t<p>TWO</p>
\t\t\t</title>
\t\t\t<poem>
\t\t\t\t<stanza>
\t\t\t\t\t<v>Line one</v>
\t\t\t\t\t<v>Line two</v>
\t\t\t\t</stanza>
\t\t\t</poem>
\t\t\t<p>Second section beta.</p>
\t\t\t<p>The last paragraph.</p>
\t\t</section>
\t</body>
\t<binary id="cover.png" content-type="image/png">…1234 bytes…</binary>
\t<binary id="pic.jpg" content-type="image/jpeg">…99 bytes…</binary>
</FictionBook>
`;

const at = (needle: string, offset = 0) => {
  const index = TEXT.indexOf(needle);
  if (index < 0) throw new Error(`not in the text: ${needle}`);
  return index + offset;
};
const after = (needle: string) => at(needle, needle.length);

const point = (nodeId: string, offset = 0): ModelPoint => ({ nodeId, offset });

/** The text's own map: what `doc.mapPositions({toModel})` answers for an offset of TEXT. */
function mapOffset(offset: number): ModelPoint | null {
  const nodes: { from: number; to: number; id: string; text?: string }[] = [
    { from: at('<p>Alpha beta'), to: after('gamma.</p>'), id: 'n13', text: 'Alpha beta gamma.' },
    { from: at('<p>He <emphasis>'), to: after('</a>.</p>'), id: 'n14', text: 'He went out1.' },
    { from: at('<p>Beta again'), to: after('once more.</p>'), id: 'n15' },
    { from: at('<image l:href="#cover.png"'), to: after('alt="Cover"/>'), id: 'n16' },
    { from: at('<empty-line/>'), to: after('<empty-line/>'), id: 'n17' },
    { from: at('<v>Line one'), to: after('Line one</v>'), id: 'n25', text: 'Line one' },
    { from: at('<v>Line two'), to: after('Line two</v>'), id: 'n26', text: 'Line two' },
    { from: at('<stanza>'), to: after('</stanza>'), id: 'n24' },
    { from: at('<poem>'), to: after('</poem>'), id: 'n23' },
    { from: at('<p>Second section'), to: after('Second section beta.</p>'), id: 'n27' },
    { from: at('<p>The last'), to: after('The last paragraph.</p>'), id: 'n28' },
    { from: at('<p>ONE</p>'), to: after('<p>ONE</p>'), id: 'n12', text: 'ONE' },
    { from: at('<p>TWO</p>'), to: after('<p>TWO</p>'), id: 'n22', text: 'TWO' },
    { from: at('<p>The Book</p>'), to: after('<p>The Book</p>'), id: 'n3', text: 'The Book' },
    { from: at('<title>\n\t\t\t\t<p>ONE'), to: after('<p>ONE</p>\n\t\t\t</title>'), id: 'n11' },
    { from: at('<title>\n\t\t\t\t<p>TWO'), to: after('<p>TWO</p>\n\t\t\t</title>'), id: 'n21' },
    { from: at('<section>'), to: after('<empty-line/>\n\t\t</section>'), id: 'n10' },
    { from: TEXT.indexOf('<section>', at('<section>') + 1), to: at('</body>'), id: 'n20' },
    { from: at('<body>'), to: after('</body>'), id: 'n1' },
  ];
  // The innermost node holding the offset wins (the list is ordered leaves first).
  const holder = nodes.find((node) => offset >= node.from && offset <= node.to);
  if (!holder) return null;
  if (holder.text === undefined) return point(holder.id, 0);
  // A text container: inside its content the model offset, on its tags the start / end.
  const contentStart = TEXT.indexOf('>', holder.from) + 1;
  const contentEnd = TEXT.lastIndexOf('</', holder.to);
  if (offset <= contentStart) return point(holder.id, 0);
  if (offset >= contentEnd) return point(holder.id, holder.text.length);
  const inner = TEXT.slice(contentStart, offset).replace(/<[^>]*>/g, '');
  return point(holder.id, inner.length);
}

const mapAll = (offsets: number[]) => offsets.map(mapOffset);

function classify(from: number, to: number, document = book()) {
  return classifySourceSelection(
    TEXT,
    { from, to },
    document,
    mapAll(offsetsToMap(TEXT, { from, to })),
  );
}

/* ------------------------------------------------------------------------ */
/* Refused ranges (C11)                                                     */
/* ------------------------------------------------------------------------ */

describe('the refused ranges', () => {
  it('finds the declaration, the root start tag, the stylesheet and every binary, in order', () => {
    expect(
      protectedRanges(TEXT).map((r) => [r.kind, TEXT.slice(r.from, r.to).slice(0, 12)]),
    ).toEqual([
      ['declaration', '<?xml versio'],
      ['root', '<FictionBook'],
      ['stylesheet', '<stylesheet '],
      ['binary', '<binary id="'],
      ['binary', '<binary id="'],
    ]);
  });

  it('refuses a selection intersecting one of them and nothing else', () => {
    const binary = at('<binary id="cover.png"');
    expect(refusedRange(TEXT, { from: binary + 5, to: binary + 20 })).toBe('binary');
    expect(refusedRange(TEXT, { from: at('</body>'), to: binary + 3 })).toBe('binary');
    expect(refusedRange(TEXT, { from: 0, to: 5 })).toBe('declaration');
    expect(refusedRange(TEXT, { from: at('<FictionBook') + 3, to: at('<FictionBook') + 9 })).toBe(
      'root',
    );
    expect(refusedRange(TEXT, { from: at('text-indent'), to: after('text-indent') })).toBe(
      'stylesheet',
    );
    // Reversed offsets are sorted; a caret is never refused; a body range is fine.
    expect(refusedRange(TEXT, { from: binary + 20, to: binary + 5 })).toBe('binary');
    expect(refusedRange(TEXT, { from: binary + 5, to: binary + 5 })).toBeNull();
    expect(refusedRange(TEXT, { from: at('<p>Alpha'), to: after('gamma.</p>') })).toBeNull();
    // Touching the edge of a protected range does not intersect it.
    expect(
      refusedRange(TEXT, { from: after('</stylesheet>'), to: after('<description>') }),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* Classification (§8.1)                                                    */
/* ------------------------------------------------------------------------ */

describe('tag shape, tags and offsets', () => {
  it('reads the start and end tags of the selected text, whitespace allowed around them', () => {
    const shape = tagShape(TEXT, { from: at('<p>Alpha') - 3, to: after('gamma.</p>') + 1 });
    expect(shape).toEqual({ lead: 3, trail: 1, startName: 'p', endName: 'p' });
    expect(tagShape(TEXT, { from: at('<empty-line/>'), to: after('<empty-line/>') })).toMatchObject(
      {
        startName: 'empty-line',
        endName: 'empty-line',
      },
    );
    expect(tagShape(TEXT, { from: at('Alpha beta'), to: after('gamma.') })).toMatchObject({
      startName: null,
      endName: null,
    });
    expect(tagShape(TEXT, { from: at('</emphasis>'), to: after('</emphasis>') })).toMatchObject({
      startName: null,
      endName: 'emphasis',
    });
  });

  it('knows when an offset lies inside a tag', () => {
    expect(insideTag(TEXT, at('<p>Alpha'))).toBe(false);
    expect(insideTag(TEXT, at('<p>Alpha') + 1)).toBe(true);
    expect(insideTag(TEXT, at('Alpha beta'))).toBe(false);
    expect(insideTag(TEXT, at('gamma.</p>') + 8)).toBe(true);
    expect(insideTag(TEXT, after('gamma.</p>'))).toBe(false);
  });

  it('maps the two ends and a position inside the first and the last tag', () => {
    const from = at('<p>Alpha') - 3;
    const to = after('gamma.</p>') + 1;
    expect(offsetsToMap(TEXT, { from, to })).toEqual([
      from,
      to,
      at('<p>Alpha') + 1,
      after('gamma.</p>') - 1,
    ]);
    expect(offsetsToMap(TEXT, { from: to, to: from })).toEqual([
      from,
      to,
      at('<p>Alpha') + 1,
      after('gamma.</p>') - 1,
    ]);
    expect(offsetsToMap(TEXT, { from: 0, to: 0 })).toEqual([0, 0, 1, 0]);
  });
});

describe('classifySourceSelection', () => {
  it('both ends inside one text container → inline with the model offsets', () => {
    const result = classify(at('beta gamma'), after('beta gamma'));
    expect(result.kind).toBe('inline');
    if (result.kind !== 'inline') return;
    expect(result.anchor).toEqual(point('n13', 6));
    expect(result.head).toEqual(point('n13', 16));
    expect(result.container.node.attrs?.nodeId).toBe('n13');
    // Reversed offsets give the same sorted range.
    expect(classify(after('beta gamma'), at('beta gamma'))).toMatchObject({
      kind: 'inline',
      anchor: point('n13', 6),
      head: point('n13', 16),
    });
  });

  it('a selection starting at an inline element is inline, not blocks', () => {
    const result = classify(at('<emphasis>went'), after('</emphasis>'));
    expect(result).toMatchObject({
      kind: 'inline',
      anchor: point('n14', 3),
      head: point('n14', 7),
    });
  });

  it("from a block's < to its > → blocks, whitespace before it allowed; several siblings; a self-closing block; a nested container", () => {
    const one = classify(at('<p>Alpha') - 3, after('gamma.</p>'));
    expect(one.kind).toBe('blocks');
    if (one.kind !== 'blocks') return;
    expect(one.blocks.map((b) => b.node.attrs?.nodeId)).toEqual(['n13']);
    expect(one.parent?.node.attrs?.nodeId).toBe('n10');
    expect(one.anchor).toEqual(point('n13', 0));
    expect(one.head).toEqual(point('n13', 'Alpha beta gamma.'.length));
    expect(one.range).toEqual({ from: at('<p>Alpha'), to: after('gamma.</p>') });

    const three = classify(at('<p>Alpha'), after('<empty-line/>'));
    expect(three).toMatchObject({ kind: 'blocks' });
    if (three.kind !== 'blocks') return;
    expect(three.blocks.map((b) => b.node.attrs?.nodeId)).toEqual([
      'n13',
      'n14',
      'n15',
      'n16',
      'n17',
    ]);
    expect(three.head).toEqual(point('n17', 0));

    const poem = classify(at('<poem>'), after('</poem>'));
    expect(poem).toMatchObject({ kind: 'blocks' });
    if (poem.kind !== 'blocks') return;
    expect(poem.blocks.map((b) => b.node.attrs?.nodeId)).toEqual(['n23']);
    expect(poem.parent?.node.attrs?.nodeId).toBe('n20');

    const verse = classify(at('<v>Line one'), after('Line two</v>'));
    expect(verse).toMatchObject({ kind: 'blocks' });
    if (verse.kind !== 'blocks') return;
    expect(verse.blocks.map((b) => b.node.attrs?.nodeId)).toEqual(['n25', 'n26']);
    expect(verse.parent?.node.attrs?.nodeId).toBe('n24');
  });

  it('anything else → source: half an element, a tag boundary, a start tag to a nested end tag, the prolog, null points', () => {
    // Half an element: from inside the text to the end tag.
    expect(classify(at('beta gamma'), after('gamma.</p>'))).toEqual({
      kind: 'source',
      range: { from: at('beta gamma'), to: after('gamma.</p>') },
    });
    // From a start tag into the text of the block.
    expect(classify(at('<p>Alpha'), after('Alpha beta')).kind).toBe('source');
    // A tag boundary inside the selection: from one paragraph's text into the next one's.
    expect(classify(at('beta gamma'), after('He <emphasis>')).kind).toBe('source');
    // The section's start tag to the end of its first paragraph (an ancestor to a descendant).
    expect(classify(at('<section>'), after('gamma.</p>')).kind).toBe('source');
    // The description: the map knows no node there (null points).
    expect(classify(at('<book-title>'), after('</book-title>')).kind).toBe('source');
    // Inside a tag at one end.
    expect(classify(at('<p>Alpha') + 2, after('gamma.')).kind).toBe('source');
    // Explicit null points for a text the map does not cover at all.
    expect(
      classifySourceSelection(TEXT, { from: 10, to: 20 }, book(), [null, null, null, null]),
    ).toEqual({
      kind: 'source',
      range: { from: 10, to: 20 },
    });
  });
});

describe('sourceSnapshot', () => {
  const toXml = (nodes: never[]) => Promise.resolve(fakeToXml(nodes));

  it('renders inline and blocks in FB2 form and the source kind as the text verbatim', async () => {
    const inline = await sourceSnapshot(
      TEXT,
      classify(at('<emphasis>went'), after(' out')),
      toXml as never,
    );
    expect(inline).toMatchObject({
      form: 'inline',
      nodeIds: ['n14'],
      parent: { nodeId: 'n14', element: 'p' },
      xml: '<emphasis>went</emphasis> out',
      text: 'went out',
      characters: 8,
      paragraphs: 1,
      blocks: 1,
      hasInlineElements: true,
      from: { id: 'n14', path: 'body[1]/section[1]/p[2]' },
      range: { from: at('<emphasis>went'), to: after(' out') },
    });
    const blocks = await sourceSnapshot(
      TEXT,
      classify(at('<poem>'), after('</poem>')),
      toXml as never,
    );
    expect(blocks).toMatchObject({
      form: 'blocks',
      nodeIds: ['n23'],
      parent: { nodeId: 'n20', element: 'section' },
      text: 'Line one\nLine two',
      paragraphs: 2,
      blocks: 1,
      openStart: false,
      openEnd: false,
      from: { id: 'n23', path: 'body[1]/section[2]/poem[1]' },
      to: { id: 'n23', path: 'body[1]/section[2]/poem[1]' },
    });
    expect(blocks.xml).toContain('<v>Line one</v>');
    const source = await sourceSnapshot(
      TEXT,
      classify(at('beta gamma'), after('He <emphasis>')),
      toXml as never,
    );
    expect(source).toMatchObject({
      form: 'xml',
      nodeIds: [],
      parent: null,
      anchor: null,
      head: null,
      xml: TEXT.slice(at('beta gamma'), after('He <emphasis>')),
      characters: after('He <emphasis>') - at('beta gamma'),
      paragraphs: 1,
      blocks: 0,
    });
    expect(countContainerTags('<p>a</p><v>b</v><subtitle/><td>c</td><poem/>')).toBe(4);
  });
});

/* ------------------------------------------------------------------------ */
/* The text path (§8.1; data-model §7.5)                                    */
/* ------------------------------------------------------------------------ */

function report(issues: ValidationIssue[]): ValidationReport {
  return {
    issues,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    durationMs: 1,
  };
}

const schemaError = (element: string, message: string, line?: number): ValidationIssue => ({
  severity: 'error',
  code: 'schema.invalid',
  params: { element, message },
  ...(line === undefined ? {} : { line }),
});

describe('the text splice', () => {
  it('replaces the range as one CodeMirror change on a copy and reports the new range', () => {
    const spliced = spliceText('abc<p>x</p>def', 3, 11, '<poem/>');
    expect(spliced).toEqual({ text: 'abc<poem/>def', from: 3, to: 10 });
    expect(spliceText('abcdef', 4, 2, 'XY')).toEqual({ text: 'abXYef', from: 2, to: 4 });
  });

  it('line / column arithmetic in both directions and relative to a replacement', () => {
    const text = 'one\ntwo\nthree';
    expect(lineColumnOf(text, 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumnOf(text, 4)).toEqual({ line: 2, column: 1 });
    expect(lineColumnOf(text, 10)).toEqual({ line: 3, column: 3 });
    expect(offsetOfLineColumn(text, 3, 3)).toBe(10);
    expect(offsetOfLineColumn(text, 9, 1)).toBe(text.length);
    // The replacement spans "wo\nthr" (offsets 5..11): a parser position on its second line.
    expect(relativePosition(text, { from: 5, to: 11 }, 3, 2)).toEqual({
      line: 2,
      column: 2,
      inReplacement: true,
    });
    expect(relativePosition(text, { from: 5, to: 11 }, 2, 3)).toEqual({
      line: 1,
      column: 2,
      inReplacement: true,
    });
    expect(relativePosition(text, { from: 5, to: 11 }, 1, 2)).toEqual({
      line: 1,
      column: 2,
      inReplacement: false,
    });
  });

  it('the end of an element in the text: self-closing, nested, with attributes', () => {
    expect(elementEndOffset(TEXT, at('<empty-line/>'))).toBe(after('<empty-line/>'));
    expect(elementEndOffset(TEXT, at('<poem>'))).toBe(after('</poem>'));
    expect(elementEndOffset(TEXT, at('<p>He <emphasis>'))).toBe(after('</a>.</p>'));
    expect(elementEndOffset(TEXT, at('<image l:href="#cover.png"'))).toBe(after('alt="Cover"/>'));
    expect(elementEndOffset(TEXT, at('Alpha beta'))).toBeNull();
    expect(elementEndOffset('<a><b>', 0)).toBeNull();
  });
});

describe('textPathOutcome: the gate of a spliced text', () => {
  const spliced = {
    text: 'line one\n<p>a\n<poem><stanza><v>a</v></poem>\nmore</p>\nlast',
    from: 'line one\n<p>a\n'.length,
    to: 'line one\n<p>a\n<poem><stanza><v>a</v></poem>'.length,
  };

  it('xml.notWellFormed → invalidXml with the parser position relative to the replacement and the hints', () => {
    const outcome = textPathOutcome(
      report([
        {
          severity: 'error',
          code: 'xml.notWellFormed',
          params: { message: 'Opening and ending tag mismatch: stanza line 3 and poem' },
          line: 3,
          column: 30,
        },
      ]),
      new Map(),
      spliced,
    );
    expect(outcome.accepted).toBe(false);
    if (outcome.accepted || outcome.code !== 'invalidXml') return;
    const rejection = outcome.rejection;
    expect(rejection).toBeInstanceOf(ChangeRejection);
    expect(rejection.code).toBe('invalidXml');
    expect(rejection.stage).toBe('parse');
    expect(rejection.issues).toEqual([
      {
        code: 'xml.notWellFormed',
        element: '',
        line: 1,
        column: 30,
        message: 'Opening and ending tag mismatch: stanza line 3 and poem',
      },
    ]);
    expect(rejection.message).toContain('line 1, column 30 of the replacement');
    expect(rejection.hint).toContain('close every element');
    expect(rejection.expected).toEqual({ line: 1, column: 30, relativeTo: 'of the replacement' });
  });

  it('an undefined entity names the U+00A0 hint; a position outside the replacement stays absolute', () => {
    const outcome = textPathOutcome(
      report([
        {
          severity: 'error',
          code: 'xml.notWellFormed',
          params: { message: "Entity 'nbsp' not defined" },
          line: 1,
          column: 4,
        },
      ]),
      new Map(),
      spliced,
    );
    if (outcome.accepted || outcome.code !== 'invalidXml') throw new Error('expected invalidXml');
    expect(outcome.rejection.hint).toContain('U+00A0');
    expect(outcome.rejection.hint).toContain('never &nbsp;');
    expect(outcome.rejection.issues[0]).toMatchObject({ line: 1, column: 4 });
    expect(outcome.rejection.message).toContain('of the document text');
  });

  it('the multiset rule: a key the baseline already holds does not block, a new one or a second of a kind does', () => {
    const titleError = schemaError('title', "Element 'title': This element is not expected.", 20);
    const poemError = schemaError('poem', "Element 'poem': This element is not expected.", 31);
    const baseline: IssueMultiset = multiset([titleError]);
    // The baseline error moved to another line: still the same key, accepted.
    expect(textPathOutcome(report([{ ...titleError, line: 25 }]), baseline, spliced)).toEqual({
      accepted: true,
    });
    // A new kind of error: rejected with it alone.
    const fresh = textPathOutcome(
      report([{ ...titleError, line: 25 }, poemError]),
      baseline,
      spliced,
    );
    expect(fresh).toMatchObject({ accepted: false, code: 'rejected' });
    if (fresh.accepted || fresh.code !== 'rejected') return;
    expect(fresh.errors).toEqual([
      {
        code: 'schema.invalid',
        element: 'poem',
        line: 31,
        message: "Element 'poem': This element is not expected.",
      },
    ]);
    // A second error of the baseline's kind: the count grows, both are reported.
    const doubled = textPathOutcome(
      report([titleError, { ...titleError, line: 40 }]),
      baseline,
      spliced,
    );
    expect(doubled).toMatchObject({ accepted: false, code: 'rejected' });
    if (doubled.accepted || doubled.code !== 'rejected') return;
    expect(doubled.errors).toHaveLength(2);
    // Warnings never count.
    expect(
      textPathOutcome(
        report([{ severity: 'warning', code: 'text.suspicious', params: {} }]),
        new Map(),
        spliced,
      ),
    ).toEqual({ accepted: true });
  });
});

/* ------------------------------------------------------------------------ */
/* The tool gate (§8.1, §8.2, §8.4)                                          */
/* ------------------------------------------------------------------------ */

describe('sourceToolGate', () => {
  const source: ModelSelection = { kind: 'source', from: 1, to: 5, text: 'xml' };
  const inline: ModelSelection = { kind: 'inline', anchor: point('n13', 0), head: point('n13', 3) };

  it('text mode: the six tools alone, every other answers unavailable with the text-mode hint', () => {
    const gate = sourceToolGate(() => ({ wellFormed: false, structuredAllowed: true }));
    expect([...SOURCE_TEXT_MODE_TOOL_NAMES]).toEqual([
      'get_context',
      'get_selection',
      'get_schema',
      'read_resource',
      'validate',
      'replace_selection',
    ]);
    for (const name of SOURCE_TEXT_MODE_TOOL_NAMES) expect(gate(name, source)).toBeNull();
    for (const name of [
      'get_outline',
      'read_part',
      'find',
      'set_selection',
      'replace_node',
      'run_script',
      'list_scripts',
    ]) {
      expect(gate(name, source)).toEqual({
        message: `${name} is unavailable in this request.`,
        hint: TEXT_MODE_HINT,
      });
    }
  });

  it('after a text-path change: the structured change tools and a structured replace_selection are unavailable, the read tools stay', () => {
    const gate = sourceToolGate(() => ({ wellFormed: true, structuredAllowed: false }));
    expect([...STRUCTURED_CHANGE_TOOL_NAMES]).toEqual([
      'replace_node',
      'insert_node',
      'remove_node',
      'set_text',
      'replace_all',
      'set_description',
      'run_script',
    ]);
    for (const name of STRUCTURED_CHANGE_TOOL_NAMES) {
      expect(gate(name, source)).toEqual({
        message: `${name} is unavailable for the rest of this request.`,
        hint: TEXT_CHANGED_HINT,
      });
    }
    expect(gate('replace_selection', source)).toBeNull();
    expect(gate('replace_selection', inline)).toMatchObject({ hint: TEXT_CHANGED_HINT });
    for (const name of [
      'get_context',
      'get_outline',
      'read_part',
      'get_selection',
      'find',
      'validate',
      'get_schema',
      'set_selection',
    ]) {
      expect(gate(name, source)).toBeNull();
    }
  });

  it('the well-formed, untouched state lets everything through but run_script (C8)', () => {
    const gate = sourceToolGate(() => ({ wellFormed: true, structuredAllowed: true }));
    for (const name of [
      'replace_node',
      'insert_node',
      'replace_selection',
      'set_selection',
      'find',
    ]) {
      expect(gate(name, inline)).toBeNull();
    }
    expect(gate('run_script', inline)).toMatchObject({
      hint: 'scripts run in the Body view; ask the user to switch',
    });
  });
});

/* ------------------------------------------------------------------------ */
/* The text path bound to a session; the commit                              */
/* ------------------------------------------------------------------------ */

describe('sameBinaries and the first changed node', () => {
  it('compares ids and sizes, order aside', () => {
    const a = [
      { id: 'x', size: 10 },
      { id: 'y', size: 20 },
    ];
    expect(sameBinaries(a, [...a].reverse())).toBe(true);
    expect(sameBinaries(a, [{ id: 'x', size: 10 }])).toBe(false);
    expect(sameBinaries(a, [a[0]!, { id: 'y', size: 21 }])).toBe(false);
    expect(sameBinaries(a, [a[0]!, { id: 'z', size: 20 }])).toBe(false);
  });

  it('finds the first accepted change’s node', () => {
    const changes = [
      { status: 'rejected', outcome: { accepted: false } },
      {
        status: 'accepted',
        outcome: { accepted: true, result: { nodes: [{ id: 'sc_3' }, { id: 'sc_4' }] } },
      },
      { status: 'accepted', outcome: { accepted: true, result: { node: { id: 'n9' } } } },
    ] as unknown as RequestSession['changes'];
    expect(firstChangedNodeId({ changes })).toBe('sc_3');
    expect(firstChangedNodeId({ changes: [] })).toBeNull();
  });
});

/** A document with a Source text that validates by `validateDocument` and a text validator. */
function sourceSessionHarness(options: { textIssues?: (text: string) => ValidationIssue[] } = {}) {
  const h = sessionHarness({ controller: false });
  const textIssues = options.textIssues ?? (() => []);
  h.rpc.responses['doc.validate'] = (params: unknown) => {
    const { document, text } = params as { document?: Document; text?: string };
    if (text !== undefined) return report(textIssues(text));
    h.validated.push(document!);
    return report([]);
  };
  const fromXmlCalls: string[] = [];
  h.rpc.responses['doc.fromXml'] = (params: unknown) => {
    const { text } = params as { text: string };
    fromXmlCalls.push(text);
    const current = h.store.getState().document!;
    return {
      document: { ...current, binaries: current.binaries.map((b) => ({ ...b })) },
      serial: 7,
      remap: { map: {}, unmappedOld: [], unmappedNew: [] },
    };
  };
  h.rpc.responses['doc.toXml'] = (params: unknown) => {
    const { document } = params as { document: Document };
    return { text: `<rendered>${document.bodies.length}</rendered>`, serial: 8 };
  };
  h.rpc.responses['doc.mapPositions'] = () => ({ toSource: [0], toModel: [], durationMs: 1 });
  return { ...h, fromXmlCalls };
}

const SOURCE_TEXT =
  '<FictionBook>\n<body>\n<section>\n<p>First paragraph.</p>\n<p>Second paragraph.</p>\n</section>\n</body>\n</FictionBook>\n';

async function startSession(h: ReturnType<typeof sourceSessionHarness>) {
  const started = await startRequestSession(h.deps, {
    origin: 'popup',
    kind: 'selection',
    instruction: 'Fix it',
    label: 'Stand-in · m',
  });
  if (!started.ok) throw new Error(`session: ${started.reason}`);
  return started.session;
}

describe('textPathSpec and sourceTextReplacer', () => {
  it('splices the pending text, validates it whole, promotes it when accepted and turns the structured tools off', async () => {
    const h = sourceSessionHarness({
      textIssues: (text) =>
        text.includes('<poem>') && !text.includes('</poem>') ? [notWellFormed(4, 5)] : [],
    });
    const session = await startSession(h);
    const from = SOURCE_TEXT.indexOf('<p>Second');
    const to = SOURCE_TEXT.indexOf('</p>', from) + 4;
    session.source = {
      text: SOURCE_TEXT,
      textBefore: SOURCE_TEXT,
      from,
      to,
      wellFormed: true,
      changed: false,
      pending: null,
    };
    const holder = selectionHolder({ kind: 'source', from, to, text: SOURCE_TEXT.slice(from, to) });
    const replace = sourceTextReplacer(session, () => holder.get());
    const spec = textPathSpec(session, holder);

    // A replacement that keeps the text well-formed (a fence is stripped): accepted.
    const range = await replace('```xml\n<poem><stanza><v>Second</v></stanza></poem>\n```');
    expect(range).toEqual({
      from,
      to: from + '<poem><stanza><v>Second</v></stanza></poem>'.length,
    });
    expect(session.source.pending?.text).toContain(
      '<poem><stanza><v>Second</v></stanza></poem>\n</section>',
    );
    expect(session.source.text).toBe(SOURCE_TEXT); // still the text before: nothing promoted yet
    const validated = await spec.validate();
    expect(validated.errorCount).toBe(0);
    expect(session.structuredAllowed).toBe(true);
    holder.set({ kind: 'source', from: range.from, to: range.to, text: 'new' }); // as the tool does
    spec.settle(true);
    expect(session.source.pending).toBeNull();
    expect(session.source.changed).toBe(true);
    expect(session.source.text).toContain('<poem><stanza><v>Second</v></stanza></poem>');
    expect(session.source.from).toBe(from);
    expect(session.source.to).toBe(range.to);
    expect(session.structuredAllowed).toBe(false);
    // The request stayed on text: no `doc.fromXml` so far.
    expect(h.fromXmlCalls).toEqual([]);

    // A second replacement that breaks the text: invalidXml, the pending text dropped, the
    // selection put back on the accepted replacement.
    holder.set({ kind: 'source', from: session.source.from, to: session.source.to, text: 'x' });
    await replace('<poem><stanza><v>a</v>');
    await expect(spec.validate()).rejects.toMatchObject({ code: 'invalidXml', stage: 'parse' });
    spec.settle(false);
    expect(session.source.pending).toBeNull();
    expect(session.source.text).toContain('</poem>');
    expect(holder.get()).toEqual({
      kind: 'source',
      from: session.source.from,
      to: session.source.to,
      text: '<poem><stanza><v>Second</v></stanza></poem>',
    });
    session.discard();
  });

  it('refuses a range over a binary with notAllowed before anything is spliced', async () => {
    const h = sourceSessionHarness();
    const session = await startSession(h);
    const text = `${SOURCE_TEXT.slice(0, -15)}<binary id="x" content-type="image/png">…9 bytes…</binary>\n</FictionBook>\n`;
    const from = text.indexOf('<binary') + 4;
    session.source = {
      text,
      textBefore: text,
      from,
      to: from + 10,
      wellFormed: true,
      changed: false,
      pending: null,
    };
    const holder = selectionHolder({
      kind: 'source',
      from,
      to: from + 10,
      text: text.slice(from, from + 10),
    });
    const replace = sourceTextReplacer(session, () => holder.get());
    expect(() => replace('<p/>')).toThrow(REFUSED_RANGE_MESSAGE);
    expect(session.source.pending).toBeNull();
    // Not a text selection: an internal error, never a splice.
    holder.set({ kind: 'none', anchor: point('p1'), head: point('p1') });
    expect(() => replace('<p/>')).toThrow('not a Source text selection');
    session.discard();
  });
});

function notWellFormed(line: number, column: number): ValidationIssue {
  return {
    severity: 'error',
    code: 'xml.notWellFormed',
    params: { message: 'Premature end of data in tag poem' },
    line,
    column,
  };
}

describe('commitSource', () => {
  function requestState(
    editor: SourceEditorController,
    docId: string,
    text: string,
  ): SourceRequestState {
    return {
      editor,
      docId,
      textBefore: text,
      baselineBefore: text,
      serialBefore: 1,
      modelBefore: null,
      textMode: false,
      wellFormed: true,
      classification: { kind: 'source', range: { from: 3, to: 9 } },
      caret: null,
      after: null,
    };
  }

  it('the text path: one doc.fromXml at the commit, the binary store asserted, the text shown with the replacement selected, one undo step tagged with the Source view that restores the text byte for byte', async () => {
    const h = sourceSessionHarness();
    const { store } = h;
    const editor = new SourceEditorController({ store, undo: h.undo });
    const docId = store.getState().docId!;
    const state = requestState(editor, docId, SOURCE_TEXT);
    const session = await startRequestSession(h.deps, {
      origin: 'popup',
      kind: 'selection',
      instruction: 'Turn it into a poem',
      label: 'x',
      present: sourcePresenter(store, state),
      undoView: 'source',
    });
    if (!session.ok) throw new Error(session.reason);
    const changed = SOURCE_TEXT.replace(
      '<p>Second paragraph.</p>',
      '<poem><stanza><v>Second</v></stanza></poem>',
    );
    const from = changed.indexOf('<poem>');
    session.session.source = {
      text: changed,
      textBefore: SOURCE_TEXT,
      from,
      to: from + '<poem><stanza><v>Second</v></stanza></poem>'.length,
      wellFormed: true,
      changed: true,
      pending: null,
    };
    // The editor shows the text before the request (headless).
    const ss = sourceSession(store);
    ss.docId = docId;
    ss.text = SOURCE_TEXT;
    ss.baseline = SOURCE_TEXT;
    ss.model = store.getState().document;
    editor.replaceWholeText(SOURCE_TEXT);
    const before = store.getState().document;

    const result = await commitSource({
      ctx: { store, t: (key: string) => key, undo: h.undo, rpc: h.rpc.client } as never,
      rpc: h.rpc.client,
      session: session.session,
      state,
      firstChangedNodeId: null,
      insertedIds: [],
    });
    expect(result.kind).toBe('committed');
    expect(h.fromXmlCalls).toEqual([changed]);
    expect(h.rpc.calls.filter((c) => c.method === 'doc.fromXml')).toHaveLength(1);
    expect(h.rpc.calls.filter((c) => c.method === 'doc.toXml')).toHaveLength(0);
    // The text is the accepted text, the replacement selected, the session clean.
    expect(editor.text).toBe(changed);
    expect(editor.selectionOffsets()).toEqual({ anchor: from, head: session.session.source.to });
    expect(ss.text).toBe(changed);
    expect(ss.baseline).toBe(changed);
    expect(ss.serial).toBe(7);
    expect(store.getState().sourceDirty).toBe(false);
    expect(store.getState().modified).toBe(true);
    expect(store.getState().document).not.toBe(before);
    // One snapshot entry of the Source view; its undo puts the text before back, byte for byte.
    const entry = h.undo.peekUndo()!;
    expect(entry.view).toBe('source');
    expect(entry.snapshot).toBeDefined();
    expect(h.undo.undoDepth).toBe(1);
    expect(h.undo.undo()).toBe(true);
    expect(editor.text).toBe(SOURCE_TEXT);
    expect(store.getState().document).toBe(before);
    expect(ss.baseline).toBe(SOURCE_TEXT);
    expect(editor.selectionOffsets()).toEqual({ anchor: 3, head: 9 });
    expect(h.undo.redo()).toBe(true);
    expect(editor.text).toBe(changed);
    // No `doc.fromXml` beyond the one of the commit.
    expect(h.rpc.calls.filter((c) => c.method === 'doc.fromXml')).toHaveLength(1);
  });

  it('a changed binary store fails the commit and nothing is committed', async () => {
    const h = sourceSessionHarness();
    h.rpc.responses['doc.fromXml'] = () => {
      const current = h.store.getState().document!;
      return { document: { ...current, binaries: [{ id: 'ghost', size: 1 }] }, serial: 7 };
    };
    const editor = new SourceEditorController({ store: h.store, undo: h.undo });
    const docId = h.store.getState().docId!;
    const state = requestState(editor, docId, SOURCE_TEXT);
    const session = await startSession(h);
    session.source = {
      text: 'changed',
      textBefore: SOURCE_TEXT,
      from: 0,
      to: 7,
      wellFormed: true,
      changed: true,
      pending: null,
    };
    const before = h.store.getState().document;
    const result = await commitSource({
      ctx: { store: h.store, t: (key: string) => key, undo: h.undo } as never,
      rpc: h.rpc.client,
      session,
      state,
      firstChangedNodeId: null,
      insertedIds: [],
    });
    expect(result).toEqual({ kind: 'failed', failure: { kind: 'binariesChanged' } });
    expect(h.store.getState().document).toBe(before);
    expect(h.undo.undoDepth).toBe(0);
    expect(session.ended).toBe(true);
  });

  it('the structured path: the copy validated, re-rendered with doc.toXml({positions: true}) and shown, the caret at the first change', async () => {
    const h = sourceSessionHarness();
    const editor = new SourceEditorController({ store: h.store, undo: h.undo });
    const docId = h.store.getState().docId!;
    const state = requestState(editor, docId, SOURCE_TEXT);
    const started = await startRequestSession(h.deps, {
      origin: 'panel',
      kind: 'general',
      instruction: 'Remove the second section',
      label: 'x',
      present: sourcePresenter(h.store, state),
      undoView: 'source',
    });
    if (!started.ok) throw new Error(started.reason);
    const session = started.session;
    session.source = {
      text: SOURCE_TEXT,
      textBefore: SOURCE_TEXT,
      from: 3,
      to: 9,
      wellFormed: true,
      changed: false,
      pending: null,
    };
    // A change of the copy: the second section's title removed.
    const document = session.copy.document;
    const body = document.bodies[0]!;
    session.copy.replace('b1', { ...body, content: body.content.slice(0, 2) } as never);
    h.rpc.responses['doc.mapPositions'] = () => ({ toSource: [11], toModel: [], durationMs: 1 });
    const result = await commitSource({
      ctx: { store: h.store, t: (key: string) => key, undo: h.undo } as never,
      rpc: h.rpc.client,
      session,
      state,
      firstChangedNodeId: 'b1',
      insertedIds: [],
    });
    expect(result.kind).toBe('committed');
    expect(h.fromXmlCalls).toEqual([]);
    const toXml = h.rpc.calls.filter((c) => c.method === 'doc.toXml');
    expect(toXml).toHaveLength(1);
    expect(toXml[0]!.params).toMatchObject({ docId, elideBinaries: true, positions: true });
    expect(editor.text).toBe('<rendered>2</rendered>');
    expect(editor.selectionOffsets()).toEqual({ anchor: 11, head: 11 });
    expect(sourceSession(h.store).serial).toBe(8);
    expect(h.undo.peekUndo()?.view).toBe('source');
  });
});

describe('sourceModelSelection', () => {
  it('turns the classification into the catalogue selection, a caret into none', () => {
    const editor = {} as SourceEditorController;
    const base: SourceRequestState = {
      editor,
      docId: 'd',
      textBefore: TEXT,
      baselineBefore: TEXT,
      serialBefore: null,
      modelBefore: null,
      textMode: false,
      wellFormed: true,
      classification: classify(at('<poem>'), after('</poem>')),
      caret: null,
      after: null,
    };
    const snapshot = { nodeIds: ['n23'], xml: '<poem/>' } as never;
    expect(sourceModelSelection(base, snapshot)).toEqual({
      kind: 'blocks',
      anchor: point('n23'),
      head: point('n23'),
      nodeIds: ['n23'],
      openStart: false,
      openEnd: false,
    });
    const source = { ...base, classification: classify(at('beta gamma'), after('gamma.</p>')) };
    expect(sourceModelSelection(source, { nodeIds: [], xml: 'sel' } as never)).toEqual({
      kind: 'source',
      from: at('beta gamma'),
      to: after('gamma.</p>'),
      text: 'sel',
    });
    const caret = {
      ...base,
      classification: null,
      caret: { point: point('n13', 2), ref: { id: 'n13', path: 'p' } },
    };
    expect(sourceModelSelection(caret, null)).toEqual({
      kind: 'none',
      anchor: point('n13', 2),
      head: point('n13', 2),
    });
  });
});
