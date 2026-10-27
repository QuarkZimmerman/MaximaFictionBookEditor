/**
 * The content-model automata against the editor's ProseMirror schema (feature 006, T056;
 * FR-061; I24; C35; resource-formats.md §12, Tests; vR4:115-117): for `section`, `cite`,
 * `epigraph`, `poem`, `stanza` and the `annotation` node, every child sequence over the
 * element's children up to length 4 is accepted by the automaton exactly when the node's
 * content expression (`fb2Schema.nodes[name].contentMatch`) accepts it. The empty sequence is
 * left out - the editor's `section` requires content where the XSD allows an empty one -, the
 * schema's `empty_line` and `text_author` stand for `empty-line` and `text-author`, and the
 * editor-only `raw_xml` is not among the children, so it never takes part.
 */

import type { NodeType } from 'prosemirror-model';

import { fb2Schema } from '@/editor/schema';
import { FB2_ELEMENTS } from '@/views/source/completion';
import { contentModelOf, isFinal, step, type ContentModel } from '@/views/source/contentModel';

const PM_NAMES: Readonly<Record<string, string>> = {
  'empty-line': 'empty_line',
  'text-author': 'text_author',
};

function automatonAccepts(model: ContentModel, children: readonly string[]): boolean {
  let state = 0;
  for (const child of children) {
    const next = step(model, state, child);
    if (next === undefined) return false;
    state = next;
  }
  return isFinal(model, state);
}

function schemaAccepts(type: NodeType, children: readonly string[]): boolean {
  let match = type.contentMatch;
  for (const child of children) {
    const childType = fb2Schema.nodes[PM_NAMES[child] ?? child];
    if (!childType) throw new Error(`no ProseMirror node for <${child}>`);
    const next = match.matchType(childType);
    if (!next) return false;
    match = next;
  }
  return match.validEnd;
}

/** Every sequence of 1 to `max` symbols of `alphabet`. */
function* sequences(alphabet: readonly string[], max: number): Generator<string[]> {
  let level: string[][] = [[]];
  for (let length = 1; length <= max; length += 1) {
    const next: string[][] = [];
    for (const prefix of level) {
      for (const symbol of alphabet) {
        const sequence = [...prefix, symbol];
        next.push(sequence);
        yield sequence;
      }
    }
    level = next;
  }
}

describe('content models against the ProseMirror content expressions', () => {
  it.each(['section', 'cite', 'epigraph', 'poem', 'stanza', 'annotation'])(
    '%s: the same verdict on every child sequence up to length 4',
    (name) => {
      const model = contentModelOf(name);
      expect(model, name).not.toBeNull();
      const type = fb2Schema.nodes[name];
      expect(type, name).toBeDefined();
      const alphabet = FB2_ELEMENTS.elements[name]!.children;
      expect(alphabet).not.toContain('raw-xml');
      let count = 0;
      let accepted = 0;
      const mismatches: string[] = [];
      for (const sequence of sequences(alphabet, 4)) {
        count += 1;
        const automaton = automatonAccepts(model!, sequence);
        if (automaton) accepted += 1;
        if (automaton !== schemaAccepts(type!, sequence)) {
          mismatches.push(`[${sequence.join(', ')}]: automaton ${automaton}`);
        }
      }
      const n = alphabet.length;
      expect(count).toBe(n + n ** 2 + n ** 3 + n ** 4);
      expect(accepted).toBeGreaterThan(0);
      expect(mismatches.slice(0, 20)).toEqual([]);
    },
  );
});
