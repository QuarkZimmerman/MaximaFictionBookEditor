// Feature 011 (US8; D42; contracts/styles.md §3-§4; research DP-13, DP-16): the stylesheets as the
// Styles view groups them, the canonical text of an edited one, and renaming a used class.
import { describe, expect, it } from 'vitest';

import type { ModelNodeJson } from '@/editor/fromModel';
import { classUses, renameClassInSelector, renameClassUses } from '@/features/styles/apply';
import {
  defaultGroup,
  namedStyles,
  readStylesheet,
  readStylesheets,
  writeStylesheet,
} from '@/features/styles/stylesheetModel';
import type { BodyNode } from '@/model/document';

import { fakeDocument } from '../features/testUtils';

describe('the Styles view’s groups (contracts/styles.md §3)', () => {
  it('reads a CSS stylesheet’s rules one per selector, keeping its at-rules', () => {
    const group = readStylesheet(
      {
        type: 'text/css',
        content:
          '/* note */\np { text-indent: 1em; margin:0  1em }\n@media print { p { color: black } }\nsection > title,\n.letter { font-style: italic }\n',
      },
      0,
    );
    expect(group.editable).toBe(true);
    expect(group.rules.map((rule) => rule.selector)).toEqual(['p', 'section > title, .letter']);
    expect(group.rules[0]!.declarations).toBe('  text-indent: 1em;\n  margin: 0 1em;');
    expect(group.atrules).toHaveLength(1);
    expect(writeStylesheet(group)).toBe(
      '@media print{p{color:black}}\np {\n  text-indent: 1em;\n  margin: 0 1em;\n}\nsection > title, .letter {\n  font-style: italic;\n}\n',
    );
  });

  it('shows another type, and CSS it cannot read, as read only', () => {
    expect(readStylesheet({ type: 'text/x-other', content: 'anything' }, 0).editable).toBe(false);
    const faulty = readStylesheet(
      { type: 'text/css', content: 'p { color: red; } } garbage {{' },
      1,
    );
    expect(faulty.editable).toBe(false);
    expect(faulty.faults.length).toBeGreaterThan(0);
    expect(faulty.text).toBe('p { color: red; } } garbage {{');
  });

  it('the default group is the first editable CSS stylesheet; named styles come from every one', () => {
    const groups = readStylesheets([
      { type: 'text/x-other', content: '.x {}' },
      { type: 'text/css', content: '.letter { font-style: italic }' },
      { type: 'text/css', content: 'p.sign, .letter { text-align: right }' },
    ]);
    expect(defaultGroup(groups)?.index).toBe(1);
    expect(
      namedStyles([
        { type: 'text/css', content: '.letter { font-style: italic }' },
        { type: 'text/css', content: 'p.sign, .letter { text-align: right }' },
      ]),
    ).toEqual(['letter', 'sign']);
  });
});

describe('renaming a used class (FR-020h, DP-16)', () => {
  const text = (value: string, style?: string): ModelNodeJson => ({
    type: 'text',
    text: value,
    ...(style ? { marks: [{ type: 'style', attrs: { name: style } }] } : {}),
  });
  function book() {
    const body: ModelNodeJson = {
      type: 'body',
      attrs: { nodeId: 'b' },
      content: [
        {
          type: 'section',
          attrs: { nodeId: 's' },
          content: [
            { type: 'p', attrs: { nodeId: 'p1', style: 'letter' }, content: [text('Dear')] },
            {
              type: 'p',
              attrs: { nodeId: 'p2' },
              content: [text('a '), text('b', 'letter'), text('c', 'other')],
            },
          ],
        },
      ],
    };
    return fakeDocument({ bodies: [body as unknown as BodyNode] });
  }

  it('counts the marks and style attributes that use the class', () => {
    expect(classUses(book(), 'letter')).toBe(2);
    expect(classUses(book(), 'other')).toBe(1);
    expect(classUses(book(), 'none')).toBe(0);
  });

  it('renames every use, and the class in a selector', () => {
    const renamed = renameClassUses(book(), 'letter', 'note');
    expect(classUses(renamed, 'letter')).toBe(0);
    expect(classUses(renamed, 'note')).toBe(2);
    expect(classUses(renamed, 'other')).toBe(1);
    expect(renameClassInSelector('p.letter, .letter-x, .letter > .letter', 'letter', 'note')).toBe(
      'p.note, .letter-x, .note > .note',
    );
  });
});
