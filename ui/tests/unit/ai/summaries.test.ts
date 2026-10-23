/**
 * The human summaries of the `tool.call` entries (feature 005 T055; ai-catalogue §6.16,
 * data-model §5.2, review C14; `ui/src/ai/summaries.ts`): the call summary from the arguments
 * - the reference resolved against the working copy, elements named, sections by index and
 * title -, the result summary with sizes, parts, match counts, inserted elements and the
 * dotted fields of `set_description` - never a value written; the English catalogue.
 */

import i18next from 'i18next';

import {
  argumentsOf,
  callSummary,
  continuationKey,
  nodeLabel,
  resultSummary,
} from '@/ai/summaries';
import { initI18n } from '@/i18n';

import { book } from './sessionUtils';

const document = book({ preExisting: false });

beforeAll(async () => {
  await initI18n({ language: 'en' });
});

const t = () => i18next.getFixedT('en');

describe('argumentsOf', () => {
  it('takes an object as it is, parses a JSON string, and answers {} for anything else', () => {
    expect(argumentsOf({ node: 'n1' })).toEqual({ node: 'n1' });
    expect(argumentsOf('{"node": "n1", "format": "fb2xml"}')).toEqual({
      node: 'n1',
      format: 'fb2xml',
    });
    expect(argumentsOf('not json')).toEqual({});
    expect(argumentsOf('[1]')).toEqual({});
    expect(argumentsOf(null)).toEqual({});
  });
});

describe('callSummary', () => {
  it('names the part a read is about: sections by index and title, other nodes by element and path', () => {
    expect(callSummary(t(), { name: 'get_outline', args: {} }, document)).toBe('Read the outline');
    expect(
      callSummary(t(), { name: 'read_part', args: { node: 'body[1]/section[1]' } }, document),
    ).toBe('Read section 1 "ONE"');
    expect(callSummary(t(), { name: 'read_part', args: { node: 'p2' } }, document)).toBe(
      'Read paragraph body[1]/section[1]/p[2]',
    );
    expect(callSummary(t(), { name: 'read_part', args: { node: 'b2' } }, document)).toBe(
      'Read body "notes"',
    );
    expect(callSummary(t(), { name: 'get_outline', args: { node: 's2' } }, document)).toBe(
      'Read the outline of section 2',
    );
    // An unknown reference is named as given; an unknown tool by its name.
    expect(callSummary(t(), { name: 'read_part', args: { node: 'body[9]' } }, document)).toBe(
      'Read body[9]',
    );
    expect(callSummary(t(), { name: 'count_words', args: {} }, document)).toBe('count_words');
  });

  it('names the change tools by their target, find and replace_all by the query, set_description without values', () => {
    const summary = (name: string, args: Record<string, unknown>) =>
      callSummary(t(), { name, args }, document);
    expect(summary('replace_node', { node: 'body[1]/section[1]/title[1]' })).toBe(
      'Replaced title body[1]/section[1]/title[1]',
    );
    expect(
      summary('insert_node', { where: 'append', node: 's1', content: { xml: '<p>x</p>' } }),
    ).toBe('Inserted content at the end of section 1 "ONE"');
    expect(summary('remove_node', { node: 'p1' })).toBe(
      'Removed paragraph body[1]/section[1]/p[1]',
    );
    expect(summary('set_text', { node: 'p1', text: 'secret' })).toBe(
      'Set the text of paragraph body[1]/section[1]/p[1]',
    );
    expect(summary('find', { text: 'ё' })).toBe('Searched "ё"');
    expect(summary('replace_all', { text: 'Анна', replacement: 'Марта' })).toBe(
      'Replaced "Анна" everywhere',
    );
    expect(
      summary('set_description', { description: { titleInfo: { bookTitle: 'secret' } } }),
    ).toBe('Changed the description');
    expect(summary('get_context', {})).toBe('Read the working context');
    expect(summary('get_selection', {})).toBe('Read the selection');
    expect(summary('replace_selection', { content: { text: 'secret' } })).toBe(
      'Replaced the selection',
    );
  });
});

describe('resultSummary', () => {
  it('completes a read with its size and part, a search with its count, an insertion with its elements', () => {
    const read = { name: 'read_part', args: { node: 'body[1]/section[1]' } };
    expect(
      resultSummary(
        t(),
        read,
        { node: { id: 's1', path: 'body[1]/section[1]', type: 'section', characters: 2300 } },
        document,
      ),
    ).toBe('Read section 1 "ONE" (2300 characters)');
    expect(
      resultSummary(
        t(),
        read,
        {
          node: { id: 's1', path: 'body[1]/section[1]', type: 'section', characters: 2300 },
          blocks: [{ text: 'x'.repeat(1200) }],
          more: { cursor: 'after:p1', remaining: { blocks: 1, characters: 1100 }, hint: 'more' },
        },
        document,
      ),
    ).toBe('Read section 1 "ONE" (2300 characters, part 1 of 2)');
    expect(
      resultSummary(
        t(),
        { name: 'read_part', args: { node: 'body[1]/section[1]', cursor: 'after:p1' } },
        {
          node: { id: 's1', path: 'body[1]/section[1]', type: 'section', characters: 2300 },
          blocks: [],
        },
        document,
        { part: 2 },
      ),
    ).toBe('Read section 1 "ONE" (2300 characters, part 2 of 2)');
    expect(
      resultSummary(
        t(),
        { name: 'find', args: { text: 'ё' } },
        { matches: [], total: 12 },
        document,
      ),
    ).toBe('Searched "ё" (12 matches)');
    expect(
      resultSummary(
        t(),
        { name: 'find', args: { text: 'ё' } },
        { matches: [], total: 1 },
        document,
      ),
    ).toBe('Searched "ё" (1 match)');
    expect(
      resultSummary(
        t(),
        { name: 'replace_all', args: { text: 'a', replacement: 'b' } },
        { count: 0, blocks: [] },
        document,
      ),
    ).toBe('Replaced "a" everywhere (0 matches)');
    expect(
      resultSummary(
        t(),
        { name: 'insert_node', args: { where: 'after', node: 'p1' } },
        {
          nodes: [
            { id: 'sc_1', path: 'body[1]/section[1]/p[2]', type: 'p' },
            { id: 'sc_2', path: 'body[1]/section[1]/p[3]', type: 'p' },
          ],
        },
        document,
      ),
    ).toBe('Inserted 2 elements after paragraph body[1]/section[1]/p[1]');
  });

  it('names the dotted fields of set_description and never their values; adds nothing for an error envelope', () => {
    expect(
      resultSummary(
        t(),
        { name: 'set_description', args: { description: { titleInfo: { genres: ['sf'] } } } },
        {
          description: {},
          validation: { newErrors: 0, preExistingErrors: 0 },
          fields: ['titleInfo.genres', 'documentInfo.history'],
        },
        document,
      ),
    ).toBe('Changed the description (titleInfo.genres, documentInfo.history)');
    expect(
      resultSummary(
        t(),
        { name: 'read_part', args: { node: 'x' } },
        { error: { code: 'unknownNode', message: 'no' } },
        document,
      ),
    ).toBeNull();
    expect(
      resultSummary(t(), { name: 'get_context', args: {} }, { catalogueVersion: 1 }, document),
    ).toBeNull();
  });
});

describe('nodeLabel / continuationKey', () => {
  it('labels a node by element and path, a section by its index and title, a body by its name', () => {
    expect(nodeLabel(t(), { type: 'p', path: 'body[1]/section[2]/p[4]' })).toBe(
      'paragraph body[1]/section[2]/p[4]',
    );
    expect(nodeLabel(t(), { type: 'section', path: 'body[1]/section[3]', title: 'Title' })).toBe(
      'section 3 "Title"',
    );
    expect(nodeLabel(t(), { type: 'section', path: 'body[1]/section[3]' })).toBe('section 3');
    expect(nodeLabel(t(), { type: 'body', path: 'body[2]', name: 'notes' })).toBe('body "notes"');
    expect(nodeLabel(t(), { type: 'body', path: 'body[1]' })).toBe('body 1');
    expect(nodeLabel(t(), { type: 'empty-line', path: 'body[1]/section[1]/empty-line[1]' })).toBe(
      'empty line body[1]/section[1]/empty-line[1]',
    );
    expect(nodeLabel(t(), { type: 'cite', path: 'body[1]/section[1]/cite[1]' })).toBe(
      'quotation body[1]/section[1]/cite[1]',
    );
    expect(nodeLabel(t(), { type: 'date', path: 'body[1]/section[1]/poem[1]/date[1]' })).toBe(
      'date body[1]/section[1]/poem[1]/date[1]',
    );
  });

  it('counts the parts of one continued read under the arguments without the cursor', () => {
    const first = continuationKey({ name: 'read_part', args: { node: 's1', format: 'text' } });
    const next = continuationKey({
      name: 'read_part',
      args: { node: 's1', format: 'text', cursor: 'after:p1' },
    });
    expect(next).toBe(first);
    expect(continuationKey({ name: 'read_part', args: { node: 's2' } })).not.toBe(first);
  });
});
