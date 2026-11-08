// Feature 011 (US2; D34, D37, D39; contracts/tree.md §2): the one table of the tree's element kinds.
import { describe, expect, it } from 'vitest';

import en from '@/i18n/tree.en.json';
import {
  DEFAULT_SHOWN_ENTRIES,
  ELEMENT_ENTRIES,
  ROW_KIND_INFO,
  kindShown,
  shownEntries,
  shownSignature,
} from '@/views/tree/elementKinds';

describe('the kinds of the Document tree (contracts/tree.md §2)', () => {
  it('lists the Elements entries in the original order, named in the editor’s words', () => {
    expect(ELEMENT_ENTRIES.map((entry) => en.tree.elements[entry.id])).toEqual([
      'Section',
      'Body',
      'Picture',
      'Annotation',
      'History',
      'Poem',
      'Stanza',
      'Title',
      'Epigraph',
      'Quote',
      'Subtitle',
      'Table',
      'Header cell',
      'Cell',
    ]);
    expect(ELEMENT_ENTRIES.map((entry) => entry.fb2)).toEqual([
      'section',
      'body',
      'image',
      'annotation',
      'history',
      'poem',
      'stanza',
      'title',
      'epigraph',
      'cite',
      'subtitle',
      'table',
      'th',
      'td',
    ]);
  });

  it('starts with the original’s choices: titles, epigraphs and quotes hidden', () => {
    const hidden = ELEMENT_ENTRIES.filter((entry) => !DEFAULT_SHOWN_ENTRIES.has(entry.id));
    expect(hidden.map((entry) => entry.id)).toEqual(['title', 'epigraph', 'quote']);
  });

  it('takes the user’s choices over the defaults and ignores unknown keys', () => {
    const shown = shownEntries({ title: true, table: false, bogus: true });
    expect(shown.has('title')).toBe(true);
    expect(shown.has('table')).toBe(false);
    expect(shown.has('section')).toBe(true);
    expect(shownSignature(shown)).not.toBe(shownSignature(DEFAULT_SHOWN_ENTRIES));
    expect(kindShown('inline-image', shown)).toBe(true);
    expect(kindShown('cite', shown)).toBe(false);
  });

  it('gives each kind its icon, whether it holds rows and whether it starts closed', () => {
    expect(ROW_KIND_INFO.subtitle.icon).toBe('struct-06');
    expect(ROW_KIND_INFO.stanza.icon).toBe('struct-03');
    expect(ROW_KIND_INFO.td.icon).toBe('struct-27');
    expect(ROW_KIND_INFO.cite.icon).toBe('struct-09');
    expect(ROW_KIND_INFO.epigraph.icon).toBe('struct-18');
    const closed = Object.entries(ROW_KIND_INFO)
      .filter(([, info]) => info.startsClosed)
      .map(([kind]) => kind)
      .sort();
    expect(closed).toEqual(['annotation', 'cite', 'epigraph', 'poem', 'stanza', 'table']);
    for (const kind of ['body', 'section'] as const) {
      expect(ROW_KIND_INFO[kind]).toMatchObject({ holdsRows: true, startsClosed: false });
    }
    for (const kind of ['title', 'subtitle', 'image', 'inline-image', 'th', 'td'] as const) {
      expect(ROW_KIND_INFO[kind].holdsRows, kind).toBe(false);
    }
  });

  it('names the FB2 element in each entry’s tooltip', () => {
    expect(en.tree.elements.tooltip).toContain('{{element}}');
  });
});
