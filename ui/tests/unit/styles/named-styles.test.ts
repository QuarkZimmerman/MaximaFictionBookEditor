// Feature 011 (US9; D43; FR-020f; contracts/styles.md §4): where a named style goes, what removes
// it, and the Style menu's entries.
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import type { ModelNodeJson } from '@/editor/fromModel';
import { docFromModel } from '@/editor/fromModel';
import { fb2Schema } from '@/editor/schema';
import { classNamesOf } from '@/features/styles/classNames';
import {
  REMOVE_NAMED_STYLE,
  hasNamedStyle,
  namedStyleCommandId,
  namedStyleMenuItems,
  styleTarget,
} from '@/features/styles/namedStyles';
import type { BodyNode } from '@/model/document';

const text = (value: string): ModelNodeJson => ({ type: 'text', text: value });
const p = (nodeId: string, value: string): ModelNodeJson => ({
  type: 'p',
  attrs: { nodeId },
  content: [text(value)],
});

function state(): EditorState {
  const body: ModelNodeJson = {
    type: 'body',
    attrs: { nodeId: 'b' },
    content: [
      {
        type: 'section',
        attrs: { nodeId: 's' },
        content: [
          { type: 'title', attrs: { nodeId: 't' }, content: [p('tp', 'Title')] },
          p('p1', 'First paragraph'),
          p('p2', 'Second paragraph'),
          { type: 'empty-line', attrs: { nodeId: 'e' } },
          { type: 'image', attrs: { nodeId: 'img', href: '#pic.png' } },
          {
            type: 'table',
            attrs: { nodeId: 'T' },
            content: [
              {
                type: 'tr',
                attrs: { nodeId: 'r' },
                content: [{ type: 'td', attrs: { nodeId: 'c' }, content: [text('cell')] }],
              },
            ],
          },
        ],
      },
    ],
  };
  const doc = docFromModel({ bodies: [body as unknown as BodyNode] }).node;
  return EditorState.create({ doc, schema: fb2Schema });
}

/** The document position of the first occurrence of `value` in a text node. */
function at(current: EditorState, value: string, offset = 0): number {
  let found = -1;
  current.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(value)) {
      found = pos + node.text!.indexOf(value) + offset;
    }
    return found < 0;
  });
  if (found < 0) throw new Error(`no text ${value}`);
  return found;
}

describe('named styles (contracts/styles.md §4)', () => {
  it('with text selected across two paragraphs: one mark in each, in one transaction', () => {
    const start = state();
    const selected = start.apply(
      start.tr.setSelection(
        TextSelection.create(start.doc, at(start, 'paragraph'), at(start, 'Second', 6)),
      ),
    );
    const target = styleTarget(selected);
    expect(target?.kind).toBe('text');
    const type = fb2Schema.marks.style!;
    const styled = selected.apply(
      selected.tr.addMark(
        selected.selection.from,
        selected.selection.to,
        type.create({ name: 'letter' }),
      ),
    );
    const marked: string[] = [];
    styled.doc.descendants((node) => {
      if (node.isText && type.isInSet(node.marks)) marked.push(node.text!);
    });
    expect(marked).toEqual(['paragraph', 'Second']);
    expect(hasNamedStyle(styled)).toBe(true);
  });

  it('without a selection: the innermost paragraph, title paragraph or cell at the caret', () => {
    const start = state();
    const caret = (value: string) =>
      start.apply(start.tr.setSelection(TextSelection.create(start.doc, at(start, value, 1))));
    expect(styleTarget(caret('First'))).toMatchObject({ kind: 'element' });
    expect(
      (styleTarget(caret('First')) as { node: { type: { name: string } } }).node.type.name,
    ).toBe('p');
    expect(
      (styleTarget(caret('Title')) as { node: { type: { name: string } } }).node.type.name,
    ).toBe('p');
    expect(
      (styleTarget(caret('cell')) as { node: { type: { name: string } } }).node.type.name,
    ).toBe('td');
    expect(hasNamedStyle(caret('First'))).toBe(false);
  });

  it('refuses a picture: the schema gives it no style', () => {
    const start = state();
    let imagePos = -1;
    start.doc.descendants((node, pos) => {
      if (node.type.name === 'image') imagePos = pos;
      return imagePos < 0;
    });
    const selected = start.apply(start.tr.setSelection(NodeSelection.create(start.doc, imagePos)));
    expect(styleTarget(selected)).toBeNull();
  });

  it('lists the book’s class names, each once, then Remove Named Style', () => {
    const sheets = [
      {
        type: 'text/css',
        content:
          '/* .ignored */ .letter { font-style: italic }\n@media print { .print { color: black } }',
      },
      { type: 'text/css', content: 'p.sign, .letter { text-align: right }' },
      { type: 'text/x-other', content: '.other {}' },
    ];
    expect(classNamesOf(sheets)).toEqual(['letter', 'print', 'sign']);
    expect(namedStyleMenuItems(sheets)).toEqual([
      { kind: 'command', commandId: namedStyleCommandId('letter') },
      { kind: 'command', commandId: namedStyleCommandId('print') },
      { kind: 'command', commandId: namedStyleCommandId('sign') },
      { kind: 'separator' },
      { kind: 'command', commandId: REMOVE_NAMED_STYLE },
    ]);
    expect(namedStyleMenuItems([])).toEqual([]);
  });
});
