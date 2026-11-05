/**
 * Feature 009, User Story 6 (T074): attribute, value and text completion in the Source view
 * (FR-060 to FR-067, data-model §9).
 */
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorSelection, EditorState } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';

import { attributeCompletion, provideCompletionLists } from '@/views/source/attributeCompletion';
import { sourceLanguage } from '@/views/source/extensions';

const ROOT =
  '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">';

function complete(marked: string): CompletionResult | null {
  const pos = marked.indexOf('|');
  const doc = marked.slice(0, pos) + marked.slice(pos + 1);
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(pos),
    extensions: [sourceLanguage()],
  });
  const result = attributeCompletion(new CompletionContext(state, pos, true));
  if (result instanceof Promise) throw new Error('the source is synchronous');
  return result;
}

const labels = (result: CompletionResult | null) => result?.options.map((o) => o.label) ?? [];

afterEach(() => provideCompletionLists(() => ({ genres: [], languages: [] })));

describe('attribute names (FR-060, FR-061)', () => {
  it('lists the element’s attributes, required first, the present ones left out', () => {
    const names = labels(complete(`${ROOT}<body><section><p><a |`));
    expect(names[0]).toBe('l:href');
    expect(names).toContain('type');
    const without = labels(complete(`${ROOT}<body><section><p><a type="note" |`));
    expect(without).not.toContain('type');
  });

  it('uses the link prefix the root declares; none declared, no link attributes', () => {
    const custom = ROOT.replace('xmlns:l=', 'xmlns:xlink=');
    expect(labels(complete(`${custom}<body><section><p><a |`))).toContain('xlink:href');
    const none = '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">';
    expect(labels(complete(`${none}<body><section><p><a |`))).not.toContain('l:href');
  });
});

describe('values (FR-062, FR-063)', () => {
  const book = `${ROOT}<body><section id="ch1"><p id="p1">x</p></section></body><binary id="pic.png" content-type="image/png">AA==</binary>`;
  it('a link target: # and the book’s ids in order, the binaries apart', () => {
    const at = book.replace('<p id="p1">x</p>', '<p id="p1"><a l:href="|"/></p>');
    expect(labels(complete(at))).toEqual(['#ch1', '#p1']);
  });

  it('an image target: # and the pictures', () => {
    const at = book.replace('<p id="p1">x</p>', '<image l:href="|"/>');
    expect(labels(complete(at))).toEqual(['#pic.png']);
  });

  it('a link type, align and valign, content-type and a body name', () => {
    expect(labels(complete(`${ROOT}<body><section><p><a type="|`))).toEqual(['note']);
    expect(labels(complete(`${ROOT}<body><section><table><tr><td align="|`))).toEqual([
      'left',
      'right',
      'center',
    ]);
    expect(labels(complete(`${ROOT}<body><section><table><tr><td valign="|`))).toEqual([
      'top',
      'middle',
      'bottom',
    ]);
    expect(labels(complete(`${ROOT}<binary content-type="|`))).toEqual(['image/jpeg', 'image/png']);
    expect(labels(complete(`${ROOT}<body name="|`))).toEqual(['notes', 'comments']);
  });
});

describe('text and quiet places (FR-064, FR-065)', () => {
  it('genre and lang take the codes the Description view loads', () => {
    provideCompletionLists(() => ({ genres: ['sf', 'prose_classic'], languages: ['ru', 'en'] }));
    expect(labels(complete(`${ROOT}<description><title-info><genre>|`))).toEqual([
      'sf',
      'prose_classic',
    ]);
    expect(labels(complete(`${ROOT}<description><title-info><lang>|`))).toEqual(['ru', 'en']);
  });

  it('offers nothing in a comment', () => {
    expect(complete(`${ROOT}<body><!-- <a |`)).toBeNull();
  });
});
