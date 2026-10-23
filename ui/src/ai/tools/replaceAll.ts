/**
 * The block rewrite of `replace_all` (feature 005 T054; ai-catalogue §3.3): the semantics of
 * `mfbe.doc.replaceAll` of the script API - every match of one text container replaced from
 * the back through a detached ProseMirror transform, so that the marks at each match start
 * carry over and the editor's expansion syntax of a regular-expression replacement
 * (`$0`–`$9` groups, `$U` / `$L` / `$T` case, `$S` / `$E` strong / emphasis, `$Q` reset -
 * `features/search/replacement.ts`) adds its marks. The matches come from the regex runner
 * (the worker with the 2-second budget, review C15), whose offsets are the plain-text offsets
 * of the block - the model offsets of the 004 contract (inline atoms count one).
 */

import { Fragment } from 'prosemirror-model';
import { Transform } from 'prosemirror-transform';

import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { fb2Schema, nodeTypeFor } from '@/editor/schema';
import { nodeToModel } from '@/editor/toModel';
import { expandReplacement, type Expanded } from '@/features/search/replacement';

import type { RegexMatch } from '../regexRunner';

/** How one match is replaced: the literal text, or the expansion of the pattern for a regex. */
export function expansionFor(
  replacement: string,
  regex: boolean,
): (match: Pick<RegexMatch, 'text' | 'groups'>) => Expanded {
  if (!regex) return () => ({ text: replacement, ranges: [] });
  return (match) =>
    expandReplacement(replacement, [match.text, ...match.groups.map((group) => group ?? '')]);
}

/**
 * The text container `json` with every match (offsets inside the block, in order) replaced by
 * its expansion. The block is rebuilt through a detached transform in a holder document (a
 * section holding the block alone gives content positions starting at 2); the result keeps
 * the block's attributes and id. `json` itself when the block cannot be built.
 */
export function rewriteBlock(
  json: ModelNodeJson,
  matches: readonly Pick<RegexMatch, 'from' | 'to' | 'text' | 'groups'>[],
  expand: (match: Pick<RegexMatch, 'text' | 'groups'>) => Expanded,
): ModelNodeJson {
  if (matches.length === 0) return json;
  const node = nodeFromModel(json);
  const section = nodeTypeFor('section');
  if (!node || !section) return json;
  const holder = fb2Schema.nodes.doc!.create(null, [section.create(null, Fragment.from([node]))]);
  const transform = new Transform(holder);
  const contentStart = 2; // doc > section(0) > block(1) > content(2)
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i]!;
    const start = contentStart + match.from;
    const end = contentStart + match.to;
    const expanded = expand(match);
    const marks = transform.doc.resolve(start).marks();
    if (expanded.text) transform.replaceWith(start, end, fb2Schema.text(expanded.text, marks));
    else transform.delete(start, end);
    for (const range of expanded.ranges) {
      const a = start + range.start;
      const b = a + range.length;
      if (range.strong) transform.addMark(a, b, fb2Schema.marks.strong!.create());
      if (range.emphasis) transform.addMark(a, b, fb2Schema.marks.emphasis!.create());
    }
  }
  const rebuilt = transform.doc.firstChild?.firstChild;
  return rebuilt ? nodeToModel(rebuilt) : json;
}
