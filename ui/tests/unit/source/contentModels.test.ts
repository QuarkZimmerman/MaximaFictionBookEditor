/**
 * The content-model automata of `fb2Elements.json` (feature 006, T056; FR-061; I24; C35;
 * resource-formats.md §12 and its Tests; research R4.1): every element whose `children` hold
 * `table` has a `model`, the eight names declared with different content models have none;
 * the automata are well formed (every `next` value a state, every final state existing, the
 * transitions' symbols the element's children); they accept exactly the accepted and refuse
 * the refused child sequences of `fb2-sequences.expected.json`, written by hand from the XSD
 * and independent of the generator; `step`, `isFinal` and `syncTargets` of `contentModel.ts`.
 */

import { FB2_ELEMENTS } from '@/views/source/completion';
import {
  contentModelOf,
  isFinal,
  step,
  syncTargets,
  type ContentModel,
} from '@/views/source/contentModel';

import expectedSequences from './fb2-sequences.expected.json';

/** Declared several times with different content models: no `model` (vR4:35). */
const WITHOUT_MODEL = [
  'code',
  'emphasis',
  'publisher',
  'strikethrough',
  'strong',
  'style',
  'sub',
  'sup',
];

interface Sequences {
  accepted: string[][];
  refused: string[][];
}

const SEQUENCES = Object.fromEntries(
  Object.entries(expectedSequences).filter(([key]) => !key.startsWith('_')),
) as unknown as Record<string, Sequences>;

/** True when the automaton runs the whole sequence from state 0 and ends in a final state. */
function accepts(model: ContentModel, children: readonly string[]): boolean {
  let state = 0;
  for (const child of children) {
    const next = step(model, state, child);
    if (next === undefined) return false;
    state = next;
  }
  return isFinal(model, state);
}

const sorted = (names: Iterable<string>): string[] =>
  [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

describe('the content models of fb2Elements.json', () => {
  it('cover every element that may hold a table: annotation, cite, history and section', () => {
    const parents = Object.entries(FB2_ELEMENTS.elements)
      .filter(([, element]) => element.children.includes('table'))
      .map(([name]) => name);
    expect(sorted(parents)).toEqual(['annotation', 'cite', 'history', 'section']);
    for (const name of parents) {
      expect(FB2_ELEMENTS.elements[name]!.model, name).toBeDefined();
      expect(contentModelOf(name), name).toBe(FB2_ELEMENTS.elements[name]!.model);
    }
  });

  it('are absent for the eight names declared with different content models, present for every other', () => {
    for (const name of WITHOUT_MODEL) {
      expect(FB2_ELEMENTS.elements[name], name).toBeDefined();
      expect(FB2_ELEMENTS.elements[name]!.model, name).toBeUndefined();
      expect(contentModelOf(name), name).toBeNull();
    }
    for (const [name, element] of Object.entries(FB2_ELEMENTS.elements)) {
      if (!WITHOUT_MODEL.includes(name)) expect(element.model, name).toBeDefined();
    }
    expect(contentModelOf('chapter')).toBeNull();
  });

  it('are well-formed automata over the element’s children', () => {
    for (const [name, element] of Object.entries(FB2_ELEMENTS.elements)) {
      const model = element.model;
      if (!model) continue;
      const states = model.next.length;
      expect(states, name).toBeGreaterThan(0);
      expect(model.final, name).toEqual([...new Set(model.final)].sort((a, b) => a - b));
      for (const state of model.final) {
        expect(
          Number.isInteger(state) && state >= 0 && state < states,
          `${name}: final ${state}`,
        ).toBe(true);
      }
      const symbols = new Set<string>();
      const reached = new Set<number>([0]);
      model.next.forEach((row, state) => {
        expect(Object.keys(row), `${name}: row ${state}`).toEqual(sorted(Object.keys(row)));
        for (const [child, target] of Object.entries(row)) {
          symbols.add(child);
          const to = target ?? -1;
          expect(
            Number.isInteger(to) && to >= 0 && to < states,
            `${name}: ${state} --${child}--> ${target}`,
          ).toBe(true);
          reached.add(to);
        }
      });
      expect(sorted(symbols), name).toEqual(element.children);
      // States are numbered breadth first from the start: every one is reachable.
      expect(reached.size, name).toBe(states);
    }
  });

  it('accept exactly the accepted and refuse the refused sequences written from the XSD', () => {
    expect(sorted(Object.keys(SEQUENCES))).toEqual([
      'annotation',
      'body',
      'cite',
      'epigraph',
      'history',
      'poem',
      'section',
      'stanza',
    ]);
    for (const [name, { accepted, refused }] of Object.entries(SEQUENCES)) {
      const model = contentModelOf(name);
      expect(model, name).not.toBeNull();
      for (const sequence of accepted) {
        expect(accepts(model!, sequence), `${name} accepts [${sequence.join(', ')}]`).toBe(true);
      }
      for (const sequence of refused) {
        expect(accepts(model!, sequence), `${name} refuses [${sequence.join(', ')}]`).toBe(false);
      }
    }
  });

  it('step and isFinal from the start state', () => {
    const section = contentModelOf('section')!;
    expect(isFinal(section, 0)).toBe(true); // an empty section is valid
    const afterTitle = step(section, 0, 'title');
    expect(afterTitle).toBeDefined();
    expect(isFinal(section, afterTitle!)).toBe(false);
    const content = step(section, afterTitle!, 'table');
    expect(content).toBeDefined();
    expect(step(section, content!, 'epigraph')).toBeUndefined();
    expect(step(section, 0, 'v')).toBeUndefined();
    expect(step(section, 0, 'not-an-element')).toBeUndefined();
    expect(step(section, 999, 'p')).toBeUndefined();
    expect(isFinal(section, 999)).toBe(false);

    const cite = contentModelOf('cite')!;
    expect(isFinal(cite, 0)).toBe(true);
    const author = step(cite, 0, 'text-author')!;
    expect(isFinal(cite, author)).toBe(true);
    expect(step(cite, author, 'table')).toBeUndefined();
    expect(step(cite, 0, 'table')).toBe(0);

    const body = contentModelOf('body')!;
    expect(isFinal(body, 0)).toBe(false); // a body needs a section
  });

  it('syncTargets: in section every symbol but image, each with its one target state', () => {
    const section = contentModelOf('section')!;
    const targets = syncTargets(section);
    expect(sorted(targets.keys())).toEqual(
      FB2_ELEMENTS.elements.section!.children.filter((child) => child !== 'image'),
    );
    for (const [symbol, target] of targets) {
      for (const row of section.next) {
        if (row[symbol] !== undefined) expect(row[symbol], symbol).toBe(target);
      }
    }
    // An annotation has one state: every symbol synchronises.
    const annotation = contentModelOf('annotation')!;
    expect(sorted(syncTargets(annotation).keys())).toEqual(
      FB2_ELEMENTS.elements.annotation!.children,
    );
    // The same object for the same model.
    expect(syncTargets(section)).toBe(targets);
  });
});
