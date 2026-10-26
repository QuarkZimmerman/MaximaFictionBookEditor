/**
 * The Source view's half of an AI request (feature 005 T070; ai-catalogue §8; data-model §4.2
 * "Source" column, §6.4 "Text path commit", §7.5; research R7, review C11; FR-030, FR-070 to
 * FR-072). Part of the lazy chunk.
 *
 * The pure part (unit-tested in `tests/unit/ai/source.test.ts`):
 *  - the **refused ranges** (C11): a selection that intersects a `<binary>` element, the
 *    `<stylesheet>` element, the XML declaration or the root `<FictionBook …>` start tag is
 *    never given to or changed by the assistant as text - binaries never travel as text
 *    (FR-055); `refusedRange` finds them in the Source text;
 *  - the **classification** of a Source selection from the model points `doc.mapPositions`
 *    answers for its offsets (§8.1): both ends inside one text container's content → `inline`
 *    (the FB2 form is the container's inline content between the mapped offsets, as in the
 *    Body view); from the `<` of a block's start tag (whitespace before it allowed) to the `>`
 *    of a block's end tag under one parent → `blocks`; anything else - a tag boundary inside
 *    the selection, half an element, a span over the description's parts the map does not know
 *    (`null` points) → `source`: the selected text as it is (FR-070);
 *  - the **text path**: the replacement spliced into a copy of the text as one CodeMirror
 *    change, the whole text validated with `doc.validate({text})` → `xml.notWellFormed` →
 *    `invalidXml` with the parser's line and column (relative to the replacement when inside
 *    it), else the content-key multiset rule of `hook.ts` against the baseline; an accepted
 *    text stays text in the session (`session.source.text`) and the structured change tools
 *    answer `unavailable` for the rest of the request (`sourceToolGate`);
 *  - the restricted **six tools** of the Source text mode (a text that is not well-formed at the
 *    start, FR-072) and the gate every other tool answers from.
 *
 * The editor-bound part: `prepareSource` (the `preparing` step - `commitPendingSource` only
 * when the request will use structured tools and the text is well-formed, the mapping, the
 * snapshot), `sourceTextPath` (the `replaceSourceText` dependency of the catalogue and the
 * hook's `validate` / `settle` of a text-path change), `commitSource` (one `doc.fromXml` for
 * the text path, `doc.toXml` for the structured one, the binary store asserted unchanged, the
 * Source text re-rendered with the caret at the first change) and `sourcePresenter` (the one
 * snapshot step replayed in both views: the model shown and the Source text restored).
 */

import { EditorState } from '@codemirror/state';

import type { CommandContext } from '@/app/commands';
import type { ModelNodeJson } from '@/editor/fromModel';
import type { BinaryMeta, Document, ValidationIssue, ValidationReport } from '@/model/document';
import { actions, type AppStore } from '@/model/store';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode, type ModelPoint } from '@/rpc/types';
import { plainText } from '@/scripting/api-impl';
import type { PresentPhase } from '@/scripting/runSession';
import type { SourceEditorController } from '@/views/source/sourceEditor';
import {
  applyRemap,
  commitPendingSource,
  sourceSession,
  type RemapTable,
} from '@/views/source/sync';

import { ToolError, US3_TOOL_NAMES, type ModelSelection } from './catalogue';
import type { BlockRef, FragmentToXml, SelectionSnapshot } from './context';
import { ChangeRejection, invalidXmlHint, newErrors, type ErrorForModel } from './hook';
import { stripFence } from './reply';
import type { CommitResult, RequestCancel, RequestSession, SessionRpc } from './session';
import {
  commonParentBlocks,
  containerSize,
  hasInlineElements,
  indexDocument,
  inlineText,
  nodeIdOf,
  pathOf,
  sliceInline,
  TEXT_CONTAINERS,
  type DocIndex,
  type Entry,
} from './tools/model';

/* ------------------------------------------------------------------------ */
/* Constants (ai-catalogue §8.1, §8.4)                                        */
/* ------------------------------------------------------------------------ */

/** The tools of the Source text mode (§8.4) - the `tools` array of such a request. */
export const SOURCE_TEXT_MODE_TOOL_NAMES = [
  'get_context',
  'get_selection',
  'get_schema',
  'read_resource',
  'validate',
  'replace_selection',
] as const;

const TEXT_MODE_TOOLS: ReadonlySet<string> = new Set(SOURCE_TEXT_MODE_TOOL_NAMES);

/** The structured change tools unavailable after a text-path change (§8.1; `run_script` is C8's). */
export const STRUCTURED_CHANGE_TOOL_NAMES = [
  ...US3_TOOL_NAMES,
  'edit_table',
  'run_script',
] as const;

const STRUCTURED_TOOLS: ReadonlySet<string> = new Set(STRUCTURED_CHANGE_TOOL_NAMES);

/** The hint of the `unavailable` envelope in Source text mode (§8.4). */
export const TEXT_MODE_HINT =
  'the document text is not well-formed; change the selected text so that it becomes well-formed';

/** The hint of the `unavailable` envelope after a text-path change (§8.1). */
export const TEXT_CHANGED_HINT =
  'the document text was changed as text in this request; continue with text replacements of the selection or finish';

/** The hint of `run_script` outside the Body view (§8.2, review C8). */
export const SCRIPTS_BODY_ONLY_HINT = 'scripts run in the Body view; ask the user to switch';

/** The `notAllowed` message of a refused range (§8.1, review C11). */
export const REFUSED_RANGE_MESSAGE =
  'binary data, the stylesheet, the XML declaration and the root element are never changed as text';

/* ------------------------------------------------------------------------ */
/* Refused ranges                                                            */
/* ------------------------------------------------------------------------ */

export type ProtectedKind = 'declaration' | 'root' | 'stylesheet' | 'binary';

export interface ProtectedRange {
  kind: ProtectedKind;
  from: number;
  to: number;
}

export interface SourceRange {
  from: number;
  to: number;
}

const DECLARATION = /^\uFEFF?\s*<\?xml[\s\S]*?\?>/;
const ROOT_START = /<FictionBook\b[^>]*>/;
const STYLESHEET = /<stylesheet\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/stylesheet\s*>)/g;
const BINARY = /<binary\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/binary\s*>)/g;

/**
 * The parts of the Source text the assistant never touches as text, in text order: the XML
 * declaration, the root element's start tag, every `<stylesheet>` and every `<binary>`
 * element (with its placeholder or its data).
 */
export function protectedRanges(text: string): ProtectedRange[] {
  const out: ProtectedRange[] = [];
  const declaration = DECLARATION.exec(text);
  if (declaration) out.push({ kind: 'declaration', from: 0, to: declaration[0].length });
  const root = ROOT_START.exec(text);
  if (root) out.push({ kind: 'root', from: root.index, to: root.index + root[0].length });
  for (const [kind, pattern] of [
    ['stylesheet', STYLESHEET],
    ['binary', BINARY],
  ] as const) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      out.push({ kind, from: match.index, to: match.index + match[0].length });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/** The kind of the first protected range a non-empty selection intersects; null for none. */
export function refusedRange(text: string, range: SourceRange): ProtectedKind | null {
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  if (from === to) return null;
  for (const protectedRange of protectedRanges(text)) {
    if (from < protectedRange.to && to > protectedRange.from) return protectedRange.kind;
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Classification (ai-catalogue §8.1; data-model §4.2)                       */
/* ------------------------------------------------------------------------ */

/** What the selected text looks like at its edges: the tag names it starts and ends with. */
export interface TagShape {
  /** Whitespace before the first non-blank character / after the last one. */
  lead: number;
  trail: number;
  /** The element name of a start tag at the start (`<p>`, `<empty-line/>`); null otherwise. */
  startName: string | null;
  /** The element name of an end tag or a self-closing tag at the end; null otherwise. */
  endName: string | null;
}

const NAME = '[A-Za-z_][\\w.:-]*';
const START_TAG = new RegExp(`^<(${NAME})(?:[\\s/>]|$)`);
const END_TAG = new RegExp(`^</(${NAME})\\s*>$`);
const SELF_CLOSING = new RegExp(`^<(${NAME})(?:\\s[^<>]*)?/>$`);

/** The tag shape of `text.slice(from, to)`. */
export function tagShape(text: string, range: SourceRange): TagShape {
  const inner = text.slice(range.from, range.to);
  const lead = inner.length - inner.trimStart().length;
  const trail = inner.length - inner.trimEnd().length;
  const core = inner.trim();
  const start = START_TAG.exec(core);
  let endName: string | null = null;
  const lt = core.lastIndexOf('<');
  if (lt >= 0) {
    const tail = core.slice(lt);
    endName = END_TAG.exec(tail)?.[1] ?? SELF_CLOSING.exec(tail)?.[1] ?? null;
  }
  return { lead, trail, startName: start?.[1] ?? null, endName };
}

/** True when `offset` lies inside a tag (after a `<` that no `>` has closed yet). */
export function insideTag(text: string, offset: number): boolean {
  const lt = text.lastIndexOf('<', offset - 1);
  if (lt < 0) return false;
  const gt = text.lastIndexOf('>', offset - 1);
  return lt > gt;
}

/**
 * The offsets whose model points the classification needs, in order: the selection's two ends,
 * then a position inside the first tag (after its `<`) and inside the last tag (its `>`) -
 * meaningful when the shape has tags there, harmless otherwise (clamped into the text).
 */
export function offsetsToMap(text: string, range: SourceRange): number[] {
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  const shape = tagShape(text, { from, to });
  const clamp = (offset: number) => Math.min(Math.max(offset, 0), text.length);
  return [from, to, clamp(from + shape.lead + 1), clamp(to - shape.trail - 1)];
}

export type SourceClassification =
  | {
      kind: 'inline';
      anchor: ModelPoint;
      head: ModelPoint;
      container: Entry;
      range: SourceRange;
    }
  | {
      kind: 'blocks';
      blocks: Entry[];
      parent: Entry | null;
      anchor: ModelPoint;
      head: ModelPoint;
      /** The text range of the blocks: from the first `<` to the last `>`. */
      range: SourceRange;
    }
  | { kind: 'source'; range: SourceRange };

/** True when `inner` holds a start or end tag of element `type` (a container never nests itself). */
function containsOwnTag(inner: string, type: string): boolean {
  return new RegExp(`<${type}(?:[\\s/>])|</${type}\\s*>`).test(inner);
}

/**
 * Classifies a Source selection (§8.1) from the points `doc.mapPositions({toModel:
 * offsetsToMap(…)})` answered - `null` where the map knows no node (the prolog, the
 * description except the annotation and the history, a binary). Pure: the text, the sorted
 * range, the document the map refers to and the four points.
 */
export function classifySourceSelection(
  text: string,
  range: SourceRange,
  document: Document,
  points: readonly (ModelPoint | null)[],
): SourceClassification {
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  const sorted = { from, to };
  const [atFrom = null, atTo = null, atStartTag = null, atEndTag = null] = points;
  const index = indexDocument(document);
  const shape = tagShape(text, sorted);

  // Whole blocks: a start tag at the start, an end (or self-closing) tag at the end, both
  // naming the sibling blocks under one parent the points fall on.
  if (shape.startName && shape.endName && atStartTag && atEndTag) {
    const a = index.byId.get(atStartTag.nodeId);
    const h = index.byId.get(atEndTag.nodeId);
    if (a && h) {
      const common =
        a === h
          ? { parent: a.parent, from: a, to: a, blocks: [a] }
          : commonParentBlocks(index, a, h);
      if (
        common &&
        common.from.node.type === shape.startName &&
        common.to.node.type === shape.endName
      ) {
        const last = common.to.node;
        return {
          kind: 'blocks',
          blocks: common.blocks,
          parent: common.parent,
          anchor: { nodeId: nodeIdOf(common.from.node), offset: 0 },
          head: {
            nodeId: nodeIdOf(last),
            offset: TEXT_CONTAINERS.has(last.type) ? containerSize(last) : 0,
          },
          range: { from: from + shape.lead, to: to - shape.trail },
        };
      }
    }
  }

  // Inside one text container's content: the same container at both ends, neither end inside
  // a tag, none of the container's own tags selected (half an element).
  if (atFrom && atTo && atFrom.nodeId === atTo.nodeId) {
    const container = index.byId.get(atFrom.nodeId);
    if (
      container &&
      TEXT_CONTAINERS.has(container.node.type) &&
      atFrom.offset !== atTo.offset &&
      !insideTag(text, from) &&
      !insideTag(text, to) &&
      !containsOwnTag(text.slice(from, to), container.node.type)
    ) {
      const size = containerSize(container.node);
      const clamp = (offset: number) => Math.min(Math.max(offset, 0), size);
      const lo = clamp(Math.min(atFrom.offset, atTo.offset));
      const hi = clamp(Math.max(atFrom.offset, atTo.offset));
      return {
        kind: 'inline',
        anchor: { nodeId: atFrom.nodeId, offset: lo },
        head: { nodeId: atFrom.nodeId, offset: hi },
        container,
        range: sorted,
      };
    }
  }

  return { kind: 'source', range: sorted };
}

/** The number of text containers whose start tag lies in `xml` (the context's `paragraphs`). */
export function countContainerTags(xml: string): number {
  const pattern = new RegExp(`<(${[...TEXT_CONTAINERS].join('|')})(?:[\\s/>])`, 'g');
  return (xml.match(pattern) ?? []).length;
}

function refOf(entry: Entry): BlockRef {
  return { id: nodeIdOf(entry.node), path: pathOf(entry) };
}

/**
 * The selection snapshot of a classified Source selection (data-model §4.2, the Source
 * column): `inline` and `blocks` in FB2 form through `doc.fragmentToXml` like the Body view's,
 * `source` as the selected text verbatim (`form: 'xml'`).
 */
export async function sourceSnapshot(
  text: string,
  classification: SourceClassification,
  toXml: FragmentToXml,
): Promise<SelectionSnapshot> {
  const base = {
    openStart: false,
    openEnd: false,
    pm: null,
    range: classification.range,
  };
  if (classification.kind === 'inline') {
    const { container, anchor, head } = classification;
    const content = (container.node.content ?? []) as never[];
    const slice = sliceInline(content, anchor.offset, head.offset);
    const ref = refOf(container);
    const plain = inlineText(slice);
    return {
      ...base,
      form: 'inline',
      anchor,
      head,
      nodeIds: [ref.id],
      parent: { nodeId: ref.id, element: container.node.type },
      xml: await toXml(slice as unknown as ModelNodeJson[]),
      text: plain,
      characters: plain.length,
      paragraphs: 1,
      blocks: 1,
      hasInlineElements: hasInlineElements(slice),
      from: ref,
      to: ref,
    };
  }
  if (classification.kind === 'blocks') {
    const { blocks, parent, anchor, head } = classification;
    const nodes = blocks.map((block) => block.node);
    const texts = nodes.map((node) => plainText(node));
    return {
      ...base,
      form: 'blocks',
      anchor,
      head,
      nodeIds: blocks.map((block) => nodeIdOf(block.node)),
      parent: parent ? { nodeId: nodeIdOf(parent.node), element: parent.node.type } : null,
      xml: await toXml(nodes),
      text: texts.join('\n'),
      characters: texts.reduce((sum, t) => sum + t.length, 0),
      paragraphs: nodes.reduce((sum, node) => sum + textContainersBelow(node), 0),
      blocks: blocks.length,
      hasInlineElements: nodes.some(inlineBelow),
      from: refOf(blocks[0]!),
      to: refOf(blocks[blocks.length - 1]!),
    };
  }
  const selected = text.slice(classification.range.from, classification.range.to);
  return {
    ...base,
    form: 'xml',
    anchor: null,
    head: null,
    nodeIds: [],
    parent: null,
    xml: selected,
    text: selected,
    characters: selected.length,
    paragraphs: countContainerTags(selected),
    blocks: 0,
    hasInlineElements: false,
    from: null,
    to: null,
  };
}

function textContainersBelow(node: ModelNodeJson): number {
  if (node.type === 'text') return 0;
  let count = TEXT_CONTAINERS.has(node.type) ? 1 : 0;
  for (const child of node.content ?? []) count += textContainersBelow(child);
  return count;
}

function inlineBelow(node: ModelNodeJson): boolean {
  if (node.type === 'text') return (node.marks?.length ?? 0) > 0;
  if (node.type === 'inline-image') return true;
  return (node.content ?? []).some(inlineBelow);
}

/* ------------------------------------------------------------------------ */
/* The text path (ai-catalogue §8.1; data-model §7.5)                        */
/* ------------------------------------------------------------------------ */

/** `text` with `[from, to)` replaced by `insert` - one CodeMirror change on a copy of the text. */
export function spliceText(
  text: string,
  from: number,
  to: number,
  insert: string,
): { text: string; from: number; to: number } {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const state = EditorState.create({ doc: text });
  const transaction = state.update({ changes: { from: lo, to: hi, insert } });
  return { text: transaction.state.doc.toString(), from: lo, to: lo + insert.length };
}

/** The 1-based line and column of `offset` in `text`. */
export function lineColumnOf(text: string, offset: number): { line: number; column: number } {
  const at = Math.min(Math.max(offset, 0), text.length);
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < at; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: at - lineStart + 1 };
}

/** The offset of a 1-based line and column in `text` (clamped to the text). */
export function offsetOfLineColumn(text: string, line: number, column: number): number {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf('\n', offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return Math.min(offset + Math.max(column, 1) - 1, text.length);
}

/** The `xml.notWellFormed` issue of a text report, when the text did not parse. */
export function notWellFormedIssue(
  report: Pick<ValidationReport, 'issues'>,
): ValidationIssue | null {
  return report.issues.find((issue) => issue.code === 'xml.notWellFormed') ?? null;
}

/** A position of the parser, relative to the replacement when it lies inside it (§8.1). */
export interface RelativePosition {
  line: number;
  column: number;
  inReplacement: boolean;
}

export function relativePosition(
  text: string,
  replacement: SourceRange,
  line: number,
  column: number,
): RelativePosition {
  const offset = offsetOfLineColumn(text, line, column);
  if (offset < replacement.from || offset > replacement.to) {
    return { line, column, inReplacement: false };
  }
  const start = lineColumnOf(text, replacement.from);
  return {
    line: line - start.line + 1,
    column: line === start.line ? column - start.column + 1 : column,
    inReplacement: true,
  };
}

/** The decision of the text-path gate (data-model §7.5). */
export type TextPathOutcome =
  | { accepted: true }
  /** The whole text does not parse: `invalidXml` with the parser's position. */
  | { accepted: false; code: 'invalidXml'; rejection: ChangeRejection }
  /** Well-formed, but a schema error beyond the baseline (the multiset rule). */
  | { accepted: false; code: 'rejected'; errors: ErrorForModel[] };

/**
 * The gate of a spliced text (data-model §7.5): `xml.notWellFormed` → an `invalidXml`
 * rejection with the parser's line and column (relative to the replacement when inside it)
 * and the hints of `invalidXmlHint`; otherwise the schema errors against `baseline` by the
 * content-key multiset rule of `hook.ts` → `rejected` with the new errors, or acceptance.
 */
export function textPathOutcome(
  report: ValidationReport,
  baseline: Map<string, number>,
  spliced: { text: string; from: number; to: number },
): TextPathOutcome {
  const notWellFormed = notWellFormedIssue(report);
  if (notWellFormed) {
    const detail = String(notWellFormed.params?.message ?? 'the text is not well-formed XML');
    const line = typeof notWellFormed.line === 'number' ? notWellFormed.line : 1;
    const column = typeof notWellFormed.column === 'number' ? notWellFormed.column : 1;
    const position = relativePosition(spliced.text, spliced, line, column);
    const where = position.inReplacement ? 'of the replacement' : 'of the document text';
    const issue: ErrorForModel & { column: number } = {
      code: 'xml.notWellFormed',
      element: '',
      line: position.line,
      column: position.column,
      message: detail,
    };
    return {
      accepted: false,
      code: 'invalidXml',
      rejection: new ChangeRejection(
        'invalidXml',
        `The document text would not be well-formed XML: ${detail} (line ${position.line}, column ${position.column} ${where}).`,
        {
          stage: 'parse',
          issues: [issue],
          hint: invalidXmlHint(detail),
          expected: { line: position.line, column: position.column, relativeTo: where },
        },
      ),
    };
  }
  const errors = newErrors(baseline, report);
  if (errors.length === 0) return { accepted: true };
  return { accepted: false, code: 'rejected', errors };
}

/* ------------------------------------------------------------------------ */
/* The tool gate (ai-catalogue §8.1, §8.2, §8.4)                              */
/* ------------------------------------------------------------------------ */

export interface SourceGateState {
  /** False in Source text mode (the text was not well-formed at the start, FR-072). */
  wellFormed: boolean;
  /** False after an accepted text-path change (review C11). */
  structuredAllowed: boolean;
}

/** Why a tool is unavailable right now (the `unavailable` envelope's message and hint). */
export interface ToolGate {
  message: string;
  hint: string;
}

/**
 * The gate of the Source view: in text mode every tool but the six answers `unavailable`;
 * after a text-path change the structured change tools do (and `replace_selection` unless the
 * selection is the text selection); `run_script` always does here (C8).
 */
export function sourceToolGate(
  state: () => SourceGateState,
): (name: string, selection: ModelSelection) => ToolGate | null {
  return (name, selection) => {
    const current = state();
    if (!current.wellFormed) {
      if (TEXT_MODE_TOOLS.has(name)) return null;
      return { message: `${name} is unavailable in this request.`, hint: TEXT_MODE_HINT };
    }
    if (!current.structuredAllowed) {
      if (
        STRUCTURED_TOOLS.has(name) ||
        (name === 'replace_selection' && selection.kind !== 'source')
      ) {
        return {
          message: `${name} is unavailable for the rest of this request.`,
          hint: TEXT_CHANGED_HINT,
        };
      }
    }
    if (name === 'run_script') {
      return { message: 'Scripts run in the Body view only.', hint: SCRIPTS_BODY_ONLY_HINT };
    }
    return null;
  };
}

/* ------------------------------------------------------------------------ */
/* The binary store assertion (data-model §6.4)                               */
/* ------------------------------------------------------------------------ */

/** True when both lists hold the same binaries by id and size (order aside). */
export function sameBinaries(
  before: readonly Pick<BinaryMeta, 'id' | 'size'>[],
  after: readonly Pick<BinaryMeta, 'id' | 'size'>[],
): boolean {
  if (before.length !== after.length) return false;
  const sizes = new Map(before.map((binary) => [binary.id, binary.size]));
  return after.every((binary) => sizes.get(binary.id) === binary.size);
}

/* ------------------------------------------------------------------------ */
/* The end of an element in the text                                          */
/* ------------------------------------------------------------------------ */

/**
 * The offset after the `>` that closes the element whose start tag begins at `start` (a
 * self-closing tag, or the matching end tag by nesting depth); `null` when the text does not
 * parse that way.
 */
export function elementEndOffset(text: string, start: number): number | null {
  if (text.charAt(start) !== '<') return null;
  const tag = /<([A-Za-z_][\w.:-]*)/y;
  tag.lastIndex = start;
  const opening = tag.exec(text);
  if (!opening) return null;
  let depth = 0;
  const scan = /<\/?([A-Za-z_][\w.:-]*)(?:"[^"]*"|'[^']*'|[^"'<>])*?(\/?)>|<!--[\s\S]*?-->/g;
  scan.lastIndex = start;
  for (let match = scan.exec(text); match; match = scan.exec(text)) {
    if (match[0].startsWith('<!--')) continue;
    const closing = match[0].startsWith('</');
    const selfClosing = match[2] === '/';
    if (closing) depth -= 1;
    else if (!selfClosing) depth += 1;
    if (depth <= 0) return match.index + match[0].length;
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* The editor-bound part                                                     */
/* ------------------------------------------------------------------------ */

/** The Source view's state of a request as the loop holds it. */
export interface SourceRequestState {
  editor: SourceEditorController;
  docId: string;
  /** The text at the start, byte for byte (what the undo step restores). */
  textBefore: string;
  /** The Source session's baseline text at the start (the dirty flag after an undo). */
  baselineBefore: string | null;
  /** The position-map serial of `textBefore` (null: no map). */
  serialBefore: number | null;
  /** The model at the start (after a `commitPendingSource`, when one happened). */
  modelBefore: Document | null;
  /** Source text mode: the text was not well-formed at the start, or no structured tools. */
  textMode: boolean;
  wellFormed: boolean;
  classification: SourceClassification | null;
  /** The caret's model point and block when there is no selection (the context's `caret`). */
  caret: { point: ModelPoint; ref: BlockRef } | null;
  /** Filled by `commitSource` for the presenter: the text after the commit and its selection. */
  after: {
    text: string;
    serial: number | null;
    selection: { anchor: number; head: number };
  } | null;
}

export type PrepareSourceResult =
  | {
      kind: 'ok';
      state: SourceRequestState;
      selection: SelectionSnapshot | null;
      /** The text's own report when it is well-formed and validated as text (the baseline). */
      textReport: ValidationReport | null;
    }
  | { kind: 'failed'; failure: 'internal' | 'sourceNotWellFormed' | 'sourceRefused' }
  /** The request was cancelled while the pending text was committed or the text checked. */
  | { kind: 'cancelled' };

export interface PrepareSourceOptions {
  ctx: CommandContext;
  rpc: SessionRpc;
  editor: SourceEditorController;
  docId: string;
  /** The target offers tools: the request may use the structured tools. */
  offersTools: boolean;
  origin: 'popup' | 'panel';
  /** The selection range as the popup captured it; undefined = the editor's selection now. */
  range?: SourceRange | null;
  toXml: FragmentToXml;
  /** The request's cancel (ai-catalogue §6.15): the text check's job goes to the owner. */
  cancel?: RequestCancel;
}

/** The editor's main selection as a sorted range; null for a caret. */
export function editorSelectionRange(editor: SourceEditorController): SourceRange | null {
  const { from, to } = editor.state.selection.main;
  return from === to ? null : { from, to };
}

/**
 * The `preparing` step of a Source-view request (§8.1, §8.4; data-model §4.3): with a target
 * offering tools the pending text is committed silently (`'clean'` / `'committed'` → the
 * structured path with the model current, `'error'` → text mode, the parse error recorded by
 * the call), else the text path works on the text as it stands; the selection is mapped and
 * classified; a request without a selection is refused in text mode when the text is not
 * well-formed ("select the text to change"); a popup request on a refused range is refused.
 * A request cancelled while the pending text was committed or the text checked ends there
 * (`cancelled`); the check's validation job is handed to the owner's `cancel`, which stops it.
 */
export async function prepareSource(options: PrepareSourceOptions): Promise<PrepareSourceResult> {
  const { ctx, rpc, editor, docId, origin, toXml, cancel } = options;
  const { store } = ctx;
  const text = editor.text;
  const range = options.range === undefined ? editorSelectionRange(editor) : options.range;
  const session = sourceSession(store);
  if (range && origin === 'popup' && refusedRange(text, range)) {
    return { kind: 'failed', failure: 'sourceRefused' };
  }

  let textMode = !options.offersTools;
  let wellFormed = true;
  if (options.offersTools) {
    // The one `doc.fromXml` a request without a text change may cause (SC-005 tolerates the id
    // reissue; the text stays byte-identical): the model and the position map made current.
    const committed = await commitPendingSource(ctx, { silent: true });
    if (committed === 'unavailable') return { kind: 'failed', failure: 'internal' };
    if (cancel?.cancelled()) return { kind: 'cancelled' };
    if (committed === 'error') {
      textMode = true;
      wellFormed = false;
    }
  }
  if (editor.text !== text) return { kind: 'failed', failure: 'internal' };
  // After the commit (when one happened) the text counts as clean: what an undo restores.
  const baselineBefore = session.baseline;

  let textReport: ValidationReport | null = null;
  if (textMode && wellFormed) {
    // No structured tools: the text path works on the text as it stands - validated once as
    // text, which tells whether it is well-formed (the baseline of the text path when it is).
    // A job above 2 MiB goes to the owner's cancel; a plain request answers all the same.
    textReport = await rpc.runJob(
      'doc.validate',
      { docId, text },
      { onStart: (jobId) => cancel?.jobStarted(jobId) },
    );
    if (cancel?.cancelled()) return { kind: 'cancelled' };
    const broken = notWellFormedIssue(textReport);
    if (broken) {
      wellFormed = false;
      textReport = null;
      const line = typeof broken.line === 'number' ? broken.line : 0;
      const column = typeof broken.column === 'number' ? broken.column : 0;
      const message = String(broken.params?.message ?? '');
      actions.setSourceParseError(store, { line, column, message });
      actions.setStatusMessage(
        store,
        ctx.t('msg.xmlParseError', {
          where: ctx.t('views.source.title'),
          line,
          column,
          message,
        }),
      );
    }
  }
  if (!wellFormed && !range) return { kind: 'failed', failure: 'sourceNotWellFormed' };

  const document = store.getState().document;
  if (!document) return { kind: 'failed', failure: 'internal' };
  const index = indexDocument(document);

  // The mapping (the structured path only - text mode has no current map by definition, and
  // the text path takes the selection as text).
  let classification: SourceClassification | null = null;
  let caret: SourceRequestState['caret'] = null;
  const serial = session.serial;
  const mapPoints = async (offsets: number[]): Promise<(ModelPoint | null)[] | null> => {
    if (serial === null || session.docId !== docId) return null;
    try {
      const result = await rpc.call('doc.mapPositions', { docId, serial, toModel: offsets });
      return result.toModel;
    } catch (error) {
      if (error instanceof RpcError && error.code === RpcErrorCode.docPositionsStale) return null;
      throw error;
    }
  };
  if (range) {
    const sorted = { from: Math.min(range.from, range.to), to: Math.max(range.from, range.to) };
    const points = textMode ? null : await mapPoints(offsetsToMap(text, sorted));
    classification = points
      ? classifySourceSelection(text, sorted, document, points)
      : { kind: 'source', range: sorted };
  } else if (!textMode) {
    const head = editor.state.selection.main.head;
    const points = await mapPoints([head]);
    const point = points?.[0] ?? null;
    const entry = point ? index.byId.get(point.nodeId) : undefined;
    if (point && entry) caret = { point, ref: refOf(entry) };
  }
  if (!caret) caret = documentStartCaret(index);

  const selection = classification ? await sourceSnapshot(text, classification, toXml) : null;
  return {
    kind: 'ok',
    state: {
      editor,
      docId,
      textBefore: text,
      baselineBefore,
      serialBefore: session.serial,
      modelBefore: document,
      textMode,
      wellFormed,
      classification,
      caret,
      after: null,
    },
    selection,
    textReport,
  };
}

/** The first text container of the first body as the caret's fallback (null without one). */
function documentStartCaret(index: DocIndex): SourceRequestState['caret'] {
  const first = index.bodies[0];
  if (!first) return null;
  const find = (entry: Entry): Entry | null => {
    if (TEXT_CONTAINERS.has(entry.node.type)) return entry;
    for (const child of entry.node.content ?? []) {
      if (child.type === 'text') continue;
      const id = nodeIdOf(child);
      const childEntry = id ? index.byId.get(id) : undefined;
      if (!childEntry) continue;
      const found = find(childEntry);
      if (found) return found;
    }
    return null;
  };
  const entry = find(first) ?? first;
  return { point: { nodeId: nodeIdOf(entry.node), offset: 0 }, ref: refOf(entry) };
}

/** The catalogue's selection for a Source request (`selectionHolder`'s initial value). */
export function sourceModelSelection(
  state: SourceRequestState,
  snapshot: SelectionSnapshot | null,
): ModelSelection {
  const classification = state.classification;
  if (classification && snapshot) {
    if (classification.kind === 'inline') {
      return { kind: 'inline', anchor: classification.anchor, head: classification.head };
    }
    if (classification.kind === 'blocks') {
      return {
        kind: 'blocks',
        anchor: classification.anchor,
        head: classification.head,
        nodeIds: snapshot.nodeIds,
        openStart: false,
        openEnd: false,
      };
    }
    return {
      kind: 'source',
      from: classification.range.from,
      to: classification.range.to,
      text: snapshot.xml,
    };
  }
  const point = state.caret?.point ?? { nodeId: '', offset: 0 };
  return { kind: 'none', anchor: point, head: point };
}

/* ------------------------------------------------------------------------ */
/* The text path bound to a session                                          */
/* ------------------------------------------------------------------------ */

/**
 * The hook's text-path members of a change (`ChangeSpec.validate` / `settle`): the pending
 * text validated whole and promoted when accepted - the request then stays on the text
 * (`structuredAllowed` false) -, dropped when rejected with the selection put back.
 */
export function textPathSpec(
  session: RequestSession,
  holder: { get(): ModelSelection; set(selection: ModelSelection): void },
): {
  validate: () => Promise<ValidationReport>;
  settle: (accepted: boolean) => void;
  form: 'text';
} {
  return {
    // The text's report names its tables by path and line (feature 006, Δ§6.10, C66).
    form: 'text',
    validate: async () => {
      const source = session.source;
      if (!source?.pending) throw new Error('no pending Source text to validate');
      const report = await session.validateText(source.pending.text);
      const outcome = textPathOutcome(report, session.baseline, source.pending);
      // A text that does not parse is refused here; the schema errors of one that does are
      // the hook's multiset diff of this very report (the same `rejected` envelope as a copy).
      if (!outcome.accepted && outcome.code === 'invalidXml') throw outcome.rejection;
      return report;
    },
    settle: (accepted) => {
      const source = session.source;
      if (!source) return;
      const pending = source.pending;
      source.pending = null;
      if (!pending) return;
      if (!accepted) {
        // The tool had moved the selection onto the replacement: back to the selected text.
        holder.set({
          kind: 'source',
          from: source.from,
          to: source.to,
          text: source.text.slice(source.from, source.to),
        });
        return;
      }
      source.text = pending.text;
      source.from = pending.from;
      source.to = pending.to;
      source.changed = true;
      session.structuredAllowed = false;
    },
  };
}

/**
 * The `replaceSourceText` dependency of the catalogue (`replace_selection` on a `source`
 * selection, and the fast path): the range is refused when it intersects a protected part
 * (`notAllowed`, C11), else the fence-stripped replacement is spliced into the session's text
 * as the pending text; the hook's `validate` of `textPathSpec` decides.
 */
export function sourceTextReplacer(
  session: RequestSession,
  selection: () => ModelSelection,
): (xml: string) => Promise<{ from: number; to: number }> {
  return (xml) => {
    const source = session.source;
    const current = selection();
    if (!source || current.kind !== 'source') {
      throw new ToolError('internal', 'the selection is not a Source text selection');
    }
    if (refusedRange(source.text, current)) {
      throw new ToolError('notAllowed', REFUSED_RANGE_MESSAGE, {
        hint: 'Select XML inside the body of the book (sections, paragraphs, poems) and replace that.',
      });
    }
    const insert = stripFence(xml);
    const spliced = spliceText(source.text, current.from, current.to, insert);
    source.pending = spliced;
    return Promise.resolve({ from: spliced.from, to: spliced.to });
  };
}

/* ------------------------------------------------------------------------ */
/* The commit and the presenter (ai-catalogue §8.3; data-model §6.4)          */
/* ------------------------------------------------------------------------ */

export type SourceCommitResult =
  | CommitResult
  | { kind: 'failed'; failure: { kind: 'binariesChanged' } }
  | { kind: 'failed'; failure: { kind: 'invalidAtEnd'; errors: ErrorForModel[] } };

interface FromXmlAnswer {
  document: Document;
  serial?: number;
  remap?: RemapTable;
}

/**
 * The commit of a Source-view request (§8.3): a text-path change → the accepted text is the
 * new Source text, **one** `doc.fromXml` makes the model current (ids reissued) and the binary
 * store is asserted unchanged (a mismatch → `failed`, nothing committed); structured changes →
 * the copy validated a last time and re-rendered with `doc.toXml({positions: true})`; either
 * way the model is published as the one snapshot step (the presenter puts the text in the
 * editor with the selection on the replacement / the caret at the first change). A request
 * cancelled before or during the commit's parse or validation publishes nothing (`cancelled`,
 * ai-catalogue §6.15): neither the model nor the remap of the parse reaches the editor.
 */
export async function commitSource(args: {
  ctx: CommandContext;
  rpc: SessionRpc;
  session: RequestSession;
  state: SourceRequestState;
  /** The id of the first node a structured change touched (the caret goes there). */
  firstChangedNodeId: string | null;
  /** The ids of the inserted nodes of a fast-path replacement (selected afterwards). */
  insertedIds: string[];
}): Promise<SourceCommitResult> {
  const { ctx, rpc, session, state } = args;
  if (session.ended) return { kind: 'lost' };
  if (session.cancelled) return session.discardCancelled();
  const source = session.source;
  const docId = state.docId;
  if (source?.changed) {
    let answer: FromXmlAnswer;
    try {
      answer = (await rpc.call('doc.fromXml', {
        docId,
        text: source.text,
        positions: true,
      })) as FromXmlAnswer;
    } catch (error) {
      if (session.cancelled) return session.discardCancelled();
      if (error instanceof RpcError && error.code === RpcErrorCode.docParseError) {
        const data = (error.data ?? {}) as { line?: number; message?: string };
        session.discard();
        return {
          kind: 'failed',
          failure: {
            kind: 'invalidAtEnd',
            errors: [
              {
                code: 'xml.notWellFormed',
                element: '',
                message: data.message ?? error.message,
                ...(typeof data.line === 'number' ? { line: data.line } : {}),
              },
            ],
          },
        };
      }
      throw error;
    }
    // A cancel while the text was parsed: the remap would clear the Body view's history and
    // move the selection to nodes that never reach the editor.
    if (session.cancelled) return session.discardCancelled();
    if (!sameBinaries(session.before.binaries, answer.document.binaries)) {
      session.discard();
      return { kind: 'failed', failure: { kind: 'binariesChanged' } };
    }
    state.after = {
      text: source.text,
      serial: typeof answer.serial === 'number' ? answer.serial : null,
      selection: { anchor: source.from, head: source.to },
    };
    applyRemap(ctx, answer.remap);
    return session.publish(answer.document);
  }
  if (!session.copy.changed) {
    session.after = null;
    session.run.commit(null);
    return { kind: 'unchanged' };
  }
  const report = await session.validate();
  // A cancel while the copy was validated (a plain request below 2 MiB answers all the same).
  if (session.cancelled) return session.discardCancelled();
  const errors = newErrors(session.baseline, report);
  if (errors.length > 0) {
    session.after = undefined;
    session.discard();
    return { kind: 'failed', failure: { kind: 'invalidAtEnd', errors } };
  }
  const after = session.copy.release();
  const rendered = await rpc.call('doc.toXml', {
    docId,
    document: after,
    elideBinaries: true,
    positions: true,
  });
  const serial = typeof rendered.serial === 'number' ? rendered.serial : null;
  const selection = await selectionAfterStructured(rpc, docId, serial, rendered.text, args);
  state.after = { text: rendered.text, serial, selection };
  return session.publish(after);
}

/** The selection in the re-rendered text: the inserted blocks whole, else the caret at the first change. */
async function selectionAfterStructured(
  rpc: SessionRpc,
  docId: string,
  serial: number | null,
  text: string,
  args: { firstChangedNodeId: string | null; insertedIds: string[]; state: SourceRequestState },
): Promise<{ anchor: number; head: number }> {
  const fallback = args.state.classification?.range.from ?? 0;
  const first = args.insertedIds[0] ?? args.firstChangedNodeId;
  if (serial === null || !first) return { anchor: fallback, head: fallback };
  const last = args.insertedIds[args.insertedIds.length - 1] ?? null;
  try {
    const points: ModelPoint[] = [{ nodeId: first, offset: 0 }];
    if (last && last !== first) points.push({ nodeId: last, offset: 0 });
    const result = await rpc.call('doc.mapPositions', { docId, serial, toSource: points });
    const start = result.toSource[0];
    if (typeof start !== 'number') return { anchor: fallback, head: fallback };
    if (args.insertedIds.length === 0) return { anchor: start, head: start };
    // The replacement selected: from the first inserted block's start tag to the end of the last.
    const anchor = tagStartBefore(text, start);
    const lastStart = typeof result.toSource[1] === 'number' ? result.toSource[1] : start;
    const end = elementEndOffset(text, tagStartBefore(text, lastStart));
    return { anchor, head: end ?? start };
  } catch {
    return { anchor: fallback, head: fallback };
  }
}

/** The `<` of the tag an offset points at or into (the mapped start of an element). */
function tagStartBefore(text: string, offset: number): number {
  if (text.charAt(offset) === '<') return offset;
  const lt = text.lastIndexOf('<', offset);
  const gt = text.lastIndexOf('>', offset - 1);
  return lt >= 0 && lt > gt ? lt : offset;
}

/**
 * The presenter of a Source-view request (`RunSessionOptions.present`): the model shown as
 * usual (the Body controller headless or mounted, the store), then the Source text put back -
 * the committed text at the commit and on redo, the text before the request on undo, byte for
 * byte - with the Source session made consistent (baseline, model, serial) so that the text
 * counts as clean when it matches the model, and the selection on the replacement.
 */
export function sourcePresenter(
  store: AppStore,
  state: SourceRequestState,
): (document: Document, phase: PresentPhase, showDefault: () => void) => void {
  return (document, phase, showDefault) => {
    showDefault();
    const editor = state.editor;
    const session = sourceSession(store);
    if (phase === 'commit' || phase === 'redo') {
      const after = state.after;
      if (!after) return;
      session.docId = state.docId;
      session.text = after.text;
      session.baseline = after.text;
      session.model = document;
      session.serial = phase === 'commit' ? after.serial : null;
      session.pendingCaret = null;
      session.pendingPoints = null;
      editor.replaceWholeText(after.text, after.selection);
      return;
    }
    // undo (or a discard that has to show the start state): the text before the request.
    session.docId = state.docId;
    session.text = state.textBefore;
    session.baseline = state.baselineBefore ?? state.textBefore;
    session.model = state.modelBefore;
    session.serial = null;
    session.pendingCaret = null;
    session.pendingPoints = null;
    const range = state.classification?.range;
    editor.replaceWholeText(
      state.textBefore,
      range ? { anchor: range.from, head: range.to } : undefined,
    );
    if (store.getState().sourceDirty !== (session.text !== session.baseline)) {
      actions.setSourceDirty(store, session.text !== session.baseline);
    }
  };
}

/** The id of the first node a request's accepted changes touched (the caret's place). */
export function firstChangedNodeId(session: Pick<RequestSession, 'changes'>): string | null {
  for (const record of session.changes) {
    if (record.status !== 'accepted' || !record.outcome?.accepted) continue;
    const result = record.outcome.result as Record<string, unknown> | undefined;
    const id = firstIdIn(result);
    if (id) return id;
  }
  return null;
}

function firstIdIn(result: Record<string, unknown> | undefined): string | null {
  if (!result) return null;
  // `focus` and then `table` (feature 006, Δ§8.3): after an `edit_table` the caret lands in the
  // focus cell.
  const candidates = ['node', 'nodes', 'inserted', 'blocks', 'changed', 'parent', 'focus', 'table'];
  for (const key of candidates) {
    const value = result[key];
    const entry = Array.isArray(value) ? value[0] : value;
    const id = (entry as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}
