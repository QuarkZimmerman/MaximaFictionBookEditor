/**
 * Feature 014 (D19, DP-9; tasks T038): the notes, their references, and the footnote each becomes.
 */
import { describe, expect, it } from 'vitest';

import { FB2_NS, XHTML_NS } from '@/features/preview/buildPreview';
import {
  footnoteElement,
  isNotesBody,
  noteRefs,
  noteSections,
  referenceId,
} from '@/features/pdf/export/footnotes';

const fb2 = (name: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]) => {
  const element = document.createElementNS(FB2_NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  element.append(...children);
  return element;
};
const link = (href: string, text: string, note = true) => {
  const a = document.createElementNS(XHTML_NS, 'a');
  a.setAttribute('href', href);
  if (note) a.setAttribute('data-note', 'true');
  a.textContent = text;
  return a;
};

describe('footnotes (D19)', () => {
  const titled = fb2(
    'section',
    { id: 'n1' },
    fb2('title', {}, fb2('p', {}, '1')),
    fb2('p', { id: 'x' }, 'The first note.'),
  );
  const untitled = fb2('section', { id: 'n2' }, fb2('p', {}, 'The second note.'));
  const notes = fb2(
    'body',
    { name: 'notes' },
    fb2('title', {}, fb2('p', {}, 'Notes')),
    titled,
    untitled,
  );
  const root = fb2('FictionBook', {}, fb2('body'), notes);

  it('finds the notes of the notes bodies by id, and the references to them in order', () => {
    expect(isNotesBody(notes)).toBe(true);
    expect([...noteSections(root).keys()]).toEqual(['n1', 'n2']);
    const block = fb2(
      'p',
      {},
      'See',
      link('#n2', '[2]'),
      link('#n1', '[1]'),
      link('#ch2', 'chapter', false),
      link('#zz', '[9]'),
    );
    expect(noteRefs(block, noteSections(root)).map(([id]) => id)).toEqual(['n2', 'n1']);
  });

  it("begins a footnote with the note's title, else the reference's text, linking back", () => {
    const one = footnoteElement(document, 'n1', titled, '[1]');
    expect(one.id).toBe('n1');
    const label = one.querySelector('.mfbe-footnote-label')!;
    expect(label.textContent).toBe('1');
    expect(label.getAttribute('href')).toBe(`#${referenceId('n1')}`);
    expect(one.textContent).toBe('1 The first note.');
    // The note's own ids stay with the book's note.
    expect(one.querySelector('[id="x"]')).toBeNull();
    const two = footnoteElement(document, 'n2', untitled, ' [2] ');
    expect(two.querySelector('.mfbe-footnote-label')!.textContent).toBe('[2]');
  });
});
