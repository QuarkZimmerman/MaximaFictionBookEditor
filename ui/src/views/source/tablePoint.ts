/**
 * The Source view's table rule (feature 006, FR-061 "Where" and "Unavailable"; US1 sc.10; I23;
 * C3, C37, C38; data-model §7.3 "SourceVerdict" and "The rule"; research R4.2 to R4.4): where
 * *Add → Table* may insert the table's XML, judged synchronously on the editor state, so the
 * command's `enabled` and its reason follow the cursor. The point is the end of the main
 * selection (a non-empty selection is kept), and the first matching row decides:
 *
 *  - `loading` while the text is not loaded (status `idle` or `loading`), `failed` for a failed
 *    load;
 *  - `analysing` while the syntax tree does not reach the end of the text (the controller's
 *    idle task completes it);
 *  - `notWellFormed` with the line of the first problem: the core's last parse of this text
 *    failed (`sourceParseError`, cleared by the next edit), else `syntaxErrorState`;
 *  - `inTag` strictly inside a tag, attribute values included (a tag's own `<` and the point
 *    after its `>` are not inside); `inMarkup` in a comment, a CDATA section, a processing
 *    instruction (the XML declaration included) or a doctype; `outsideRoot` before or after the
 *    root element; `inText` where the character data around the point - text, references and
 *    CDATA up to the nearest tags - holds a character other than white space (the binary
 *    placeholder included);
 *  - otherwise the point lies between the elements of a parent P, and the content models of
 *    `fb2Elements.json` (`contentModel.ts`) give `ok` or `notAllowed`: P resolves through the
 *    `xmlns` declarations in scope to the FB2 namespace or to none (as the core reads both), its
 *    children hold `table` (only `annotation`, `cite`, `history`, `section`), and the table adds
 *    no schema error in P - with q the state after the children before the point and t the
 *    state after a table there, t exists and the children after the point run from t at least
 *    as far as from q, ending in a final state whenever the run from q does. For a valid P
 *    that is "P stays valid"; in a P invalid elsewhere the table is still allowed where it adds
 *    no new error (C38). q comes from a walk back to the nearest synchronising child and a
 *    lenient run forward (a child the model refuses leaves the run where it is); the runs after
 *    the point go in lockstep and stop once they meet, which bounds the cost. There is no
 *    heading-part guard: between `</title>` and a heading `<image>` the table makes that image
 *    the first content image, as the schema reads it (C3).
 *
 * The verdict only enables the command; validation stays in the core (constitution III; C35).
 */

import { ensureSyntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';

import { FB2_ELEMENTS } from './completion';
import { contentModelOf, isFinal, step, syncTargets, type ContentModel } from './contentModel';
import { characterReferenceValue, syntaxErrorState } from './extensions';
import type { SourceLoadStatus } from './sourceEditor';

/** The FictionBook 2 namespace; the core reads elements without a namespace as FB2 too. */
export const FB2_NAMESPACE = 'http://www.gribuser.ru/xml/fictionbook/2.0';
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';

/** The element a table may go into, with the offsets of its tags. */
export interface SourceTableParent {
  /** Its local name: `annotation`, `cite`, `history` or `section`. */
  name: string;
  /** The `<` of its start tag. */
  from: number;
  /** The offset after its start tag's `>`. */
  openTo: number;
  /** The `<` of its end tag. */
  closeFrom: number;
  /** The offset after its end tag. */
  to: number;
}

export type SourceVerdict =
  | { code: 'ok'; pos: number; parent: SourceTableParent; prefix: string }
  | { code: 'loading' }
  | { code: 'failed' }
  | { code: 'analysing' }
  | { code: 'notWellFormed'; line: number }
  | { code: 'inTag' }
  | { code: 'inMarkup' }
  | { code: 'outsideRoot' }
  | { code: 'inText' }
  | { code: 'notAllowed'; element: string };

export type SourceVerdictCode = SourceVerdict['code'];

/** The `ok` verdict: what the inserted XML is planned from (`tableInsert.ts`). */
export type SourceTablePoint = Extract<SourceVerdict, { code: 'ok' }>;

/** What the rule needs besides the editor state: the load status and the core's parse error. */
export interface SourceTableContext {
  status: SourceLoadStatus;
  parseError: { line: number } | null;
}

const TAGS = new Set(['OpenTag', 'CloseTag', 'SelfClosingTag', 'MismatchedCloseTag']);
const MARKUP = new Set(['Comment', 'Cdata', 'ProcessingInst', 'DoctypeDecl']);
const CHARACTER_DATA = new Set(['Text', 'EntityReference', 'CharacterReference', 'Cdata']);

/** A string that is never the name of a child in a content model. */
const FOREIGN = '\u0000foreign';

/**
 * A short key of a verdict that changes exactly when the command's state or its reason may
 * change: the code, with the line or the element (`ok` at another point is the same).
 */
export function sourceVerdictKey(verdict: SourceVerdict): string {
  switch (verdict.code) {
    case 'notWellFormed':
      return `${verdict.code}:${verdict.line}`;
    case 'notAllowed':
      return `${verdict.code}:${verdict.element}`;
    default:
      return verdict.code;
  }
}

/** The complete syntax tree of the state, null while the parser has not reached the end. */
function completeTree(state: EditorState): Tree | null {
  if (!syntaxTreeAvailable(state, state.doc.length)) return null;
  return ensureSyntaxTree(state, state.doc.length, 0);
}

/** The verdict at `at` (by default the end of the main selection). */
export function sourceTablePoint(
  state: EditorState,
  context: SourceTableContext,
  at: number = state.selection.main.to,
): SourceVerdict {
  if (context.status === 'idle' || context.status === 'loading') return { code: 'loading' };
  if (context.status === 'failed') return { code: 'failed' };
  const tree = completeTree(state);
  if (!tree) return { code: 'analysing' };
  if (context.parseError) return { code: 'notWellFormed', line: context.parseError.line };
  const problem = syntaxErrorState(state, tree);
  if (problem) return { code: 'notWellFormed', line: problem.line };
  return classify(state, tree, Math.max(0, Math.min(at, state.doc.length)));
}

/**
 * The state of the parent's content model after the children before `at` - the bounded walk
 * of the rule (exported for its unit test) - or null when `at` is not a point between the
 * elements of a parent with a content model, or the tree is not complete.
 */
export function modelStateBefore(state: EditorState, at: number): number | null {
  const tree = completeTree(state);
  if (!tree) return null;
  const located = locate(state, tree, at);
  if (typeof located === 'string') return null;
  const names = new Names(state, located.parent);
  const model = contentModelOf(names.local);
  return model ? stateBefore(model, located.parent, at, names) : null;
}

/* ------------------------------------------------------------------------ */
/* Locating the point                                                       */
/* ------------------------------------------------------------------------ */

type Located = { parent: SyntaxNode } | 'inTag' | 'inMarkup' | 'outsideRoot' | 'inText';

/** Where the point lies: in a tag, in markup, outside the root, in text, or between elements. */
function locate(state: EditorState, tree: Tree, at: number): Located {
  const inner = tree.resolveInner(at, 0);
  for (let node: SyntaxNode | null = inner; node; node = node.parent) {
    if (TAGS.has(node.name)) return 'inTag';
    if (MARKUP.has(node.name)) return 'inMarkup';
  }
  const root = tree.topNode.getChild('Element');
  if (!root || at <= root.from || at >= root.to) return 'outsideRoot';
  let parent: SyntaxNode | null = inner;
  while (parent && parent.name !== 'Element') parent = parent.parent;
  if (!parent || parent.firstChild?.name !== 'OpenTag') return 'outsideRoot';
  return characterDataAround(state, parent, at) ? 'inText' : { parent };
}

/** Whether the character data next to `at` among the parent's children holds a non-space. */
function characterDataAround(state: EditorState, parent: SyntaxNode, at: number): boolean {
  for (let node = parent.childBefore(at); node; node = node.prevSibling) {
    if (!CHARACTER_DATA.has(node.name)) break;
    if (holdsNonSpace(state, node)) return true;
  }
  for (let node = parent.childAfter(at); node; node = node.nextSibling) {
    if (!CHARACTER_DATA.has(node.name)) break;
    if (holdsNonSpace(state, node)) return true;
  }
  return false;
}

function holdsNonSpace(state: EditorState, node: SyntaxNode): boolean {
  switch (node.name) {
    case 'EntityReference':
      return true; // the five predefined entities are all printable
    case 'CharacterReference': {
      const code = characterReferenceValue(state.sliceDoc(node.from, node.to));
      return !(code === 0x20 || code === 0x9 || code === 0xa || code === 0xd);
    }
    case 'Cdata':
      return /[^ \t\r\n]/.test(state.sliceDoc(node.from, node.to).slice(9, -3));
    default:
      return /[^ \t\r\n]/.test(state.sliceDoc(node.from, node.to));
  }
}

/* ------------------------------------------------------------------------ */
/* Names and namespaces                                                     */
/* ------------------------------------------------------------------------ */

/** The `xmlns` / `xmlns:p` declarations of a start tag: prefix (`''` for the default) → URI. */
function declarations(state: EditorState, tag: SyntaxNode): Map<string, string> | null {
  let found: Map<string, string> | null = null;
  for (let attribute = tag.getChild('Attribute'); attribute; attribute = attribute.nextSibling) {
    if (attribute.name !== 'Attribute') continue;
    const name = attribute.getChild('AttributeName');
    if (!name) continue;
    const text = state.sliceDoc(name.from, name.to);
    if (text !== 'xmlns' && !text.startsWith('xmlns:')) continue;
    const value = attribute.getChild('AttributeValue');
    const uri = value ? state.sliceDoc(value.from + 1, value.to - 1) : '';
    (found ??= new Map()).set(text === 'xmlns' ? '' : text.slice(6), uri);
  }
  return found;
}

/** The qualified name of an element's start tag, split. */
function tagName(state: EditorState, element: SyntaxNode): { prefix: string; local: string } {
  const tag = element.firstChild;
  const name = tag?.getChild('TagName');
  const text = name ? state.sliceDoc(name.from, name.to) : '';
  const colon = text.indexOf(':');
  return colon < 0
    ? { prefix: '', local: text }
    : { prefix: text.slice(0, colon), local: text.slice(colon + 1) };
}

/**
 * The names of the parent P and of its children for the rule: P's prefix and local name, the
 * namespace a prefix resolves to in P's scope (memoised), and a child's symbol - its local
 * name when it is an FB2 element (or has no namespace), else a name no model holds.
 */
class Names {
  readonly prefix: string;
  readonly local: string;
  private readonly scope = new Map<string, string | null>();

  constructor(
    private readonly state: EditorState,
    private readonly parent: SyntaxNode,
  ) {
    const { prefix, local } = tagName(state, parent);
    this.prefix = prefix;
    this.local = local;
  }

  /** The namespace `prefix` resolves to at P (null for an undeclared prefix, '' for none). */
  resolve(prefix: string): string | null {
    if (this.scope.has(prefix)) return this.scope.get(prefix)!;
    let uri: string | null | undefined;
    for (let node: SyntaxNode | null = this.parent; node && uri === undefined; node = node.parent) {
      if (node.name !== 'Element' || !node.firstChild) continue;
      uri = declarations(this.state, node.firstChild)?.get(prefix);
    }
    if (uri === undefined) uri = prefix === 'xml' ? XML_NAMESPACE : prefix === '' ? '' : null;
    this.scope.set(prefix, uri);
    return uri;
  }

  /** Whether P itself is an FB2 element (the FB2 namespace or none). */
  get parentIsFb2(): boolean {
    const uri = this.resolve(this.prefix);
    return uri === FB2_NAMESPACE || uri === '';
  }

  /** The symbol of a child element of P. */
  symbol(child: SyntaxNode): string {
    const { prefix, local } = tagName(this.state, child);
    const own = child.firstChild
      ? declarations(this.state, child.firstChild)?.get(prefix)
      : undefined;
    const uri = own !== undefined ? own : this.resolve(prefix);
    return uri === FB2_NAMESPACE || uri === '' ? local : FOREIGN;
  }
}

/* ------------------------------------------------------------------------ */
/* The rule                                                                 */
/* ------------------------------------------------------------------------ */

function classify(state: EditorState, tree: Tree, at: number): SourceVerdict {
  const located = locate(state, tree, at);
  if (typeof located === 'string') return { code: located };
  const { parent } = located;
  const names = new Names(state, parent);
  const notAllowed: SourceVerdict = { code: 'notAllowed', element: names.local };
  if (!names.parentIsFb2) return notAllowed;
  if (!FB2_ELEMENTS.elements[names.local]?.children.includes('table')) return notAllowed;
  const model = contentModelOf(names.local);
  if (!model) return notAllowed;
  const before = stateBefore(model, parent, at, names);
  const afterTable = step(model, before, 'table');
  if (afterTable === undefined) return notAllowed;
  if (!runsAsFar(model, parent, at, before, afterTable, names)) return notAllowed;
  const open = parent.firstChild!;
  const close = parent.lastChild!;
  return {
    code: 'ok',
    pos: at,
    parent: {
      name: names.local,
      from: parent.from,
      openTo: open.to,
      closeFrom: close.from,
      to: parent.to,
    },
    prefix: names.prefix,
  };
}

/**
 * q: the state after the children before `at`. The walk goes back to the nearest child whose
 * every transition leads to one state (`syncTargets`) - the state after it is known whatever
 * came before - or to the first child, then runs forward leniently: a child the model refuses
 * (an error elsewhere in P) leaves the state where it is (C38).
 */
function stateBefore(model: ContentModel, parent: SyntaxNode, at: number, names: Names): number {
  const sync = syncTargets(model);
  const pending: string[] = [];
  let state = 0;
  for (let node = parent.childBefore(at); node; node = node.prevSibling) {
    if (node.name === 'OpenTag') break;
    if (node.name !== 'Element' || node.to > at) continue;
    const symbol = names.symbol(node);
    const target = sync.get(symbol);
    if (target !== undefined) {
      state = target;
      break;
    }
    pending.push(symbol);
  }
  for (let i = pending.length - 1; i >= 0; i -= 1) state = step(model, state, pending[i]!) ?? state;
  return state;
}

/**
 * Whether the children after `at` run from `t` at least as far as from `q`, ending in a final
 * state whenever the run from `q` does. Both runs go in lockstep and stop once they meet in one
 * state - from there on they are the same.
 */
function runsAsFar(
  model: ContentModel,
  parent: SyntaxNode,
  at: number,
  q: number,
  t: number,
  names: Names,
): boolean {
  let fromQ = q;
  let fromT = t;
  for (let node = parent.childAfter(at); node; node = node.nextSibling) {
    if (fromQ === fromT) return true;
    if (node.name === 'CloseTag') break;
    if (node.name !== 'Element' || node.from < at) continue;
    const symbol = names.symbol(node);
    const nextQ = step(model, fromQ, symbol);
    // The run from q ends here: the run from t has come as far.
    if (nextQ === undefined) return true;
    const nextT = step(model, fromT, symbol);
    // The table would make a child an error that was none.
    if (nextT === undefined) return false;
    fromQ = nextQ;
    fromT = nextT;
  }
  return fromQ === fromT || !isFinal(model, fromQ) || isFinal(model, fromT);
}
