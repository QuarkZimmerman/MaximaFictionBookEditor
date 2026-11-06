/**
 * Feature 009, User Story 3 (T046): which links are note links, and the plain text the note
 * tooltip shows (data-model §6).
 */
import { describe, expect, it } from 'vitest';

import { isNoteLink, noteText } from '@/editor/plugins/noteTooltip';
import type { Document } from '@/model/document';

const texts = { picture: '[picture]', table: '[table]', notFound: 'Note not found' };

function p(text: string) {
  return { type: 'p', content: [{ type: 'text', text }] };
}

const model = {
  bodies: [
    {
      type: 'body',
      attrs: {},
      content: [{ type: 'section', attrs: { id: 'ch1' }, content: [p('Chapter text.')] }],
    },
    {
      type: 'body',
      attrs: { name: 'notes' },
      content: [
        {
          type: 'section',
          attrs: { id: 'n_1' },
          content: [
            { type: 'title', content: [p('1')] },
            p('First line, '),
            {
              type: 'p',
              content: [
                { type: 'text', text: 'with ' },
                { type: 'text', text: 'strong', marks: [{ type: 'strong' }] },
                { type: 'text', text: ' words.' },
              ],
            },
            { type: 'subtitle', content: [{ type: 'text', text: 'A subtitle' }] },
            {
              type: 'poem',
              content: [
                {
                  type: 'stanza',
                  content: [{ type: 'v', content: [{ type: 'text', text: 'Verse one' }] }],
                },
                {
                  type: 'stanza',
                  content: [{ type: 'v', content: [{ type: 'text', text: 'Verse two' }] }],
                },
              ],
            },
            { type: 'image', attrs: { href: '#pic' } },
            { type: 'table', content: [] },
          ],
        },
      ],
    },
    {
      type: 'body',
      attrs: { name: 'comments' },
      content: [{ type: 'section', attrs: { id: 'c_1' }, content: [p('A comment.')] }],
    },
  ],
} as unknown as Pick<Document, 'bodies'>;

describe('isNoteLink (data-model §6)', () => {
  it('is a link of type note, or one into a notes or comments body', () => {
    expect(isNoteLink(model, '#ch1', 'note')).toBe(true);
    expect(isNoteLink(model, '#n_1', null)).toBe(true);
    expect(isNoteLink(model, '#c_1', undefined)).toBe(true);
  });
  it('is no other link', () => {
    expect(isNoteLink(model, '#ch1', null)).toBe(false);
    expect(isNoteLink(model, 'https://example.org/', null)).toBe(false);
    expect(isNoteLink(model, '#', null)).toBe(false);
    expect(isNoteLink(model, '#missing', null)).toBe(false);
  });
});

describe('noteText (data-model §6)', () => {
  it('skips the title, keeps lines without formatting, sets stanzas apart, names pictures and tables', () => {
    expect(noteText(model, 'n_1', texts)).toBe(
      [
        'First line, ',
        'with strong words.',
        'A subtitle',
        '',
        'Verse one',
        '',
        'Verse two',
        '',
        '[picture]',
        '[table]',
      ].join('\n'),
    );
  });
  it('says so when the note is missing', () => {
    expect(noteText(model, 'nowhere', texts)).toBe('Note not found');
  });
});
