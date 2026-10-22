/**
 * Pure document helpers of the assistant's catalogue (feature 005 T044; ai-catalogue §3):
 * an index of the working copy's structural nodes with their structural paths (the 004
 * grammar, root prefixes `body[n]`, `title-info/annotation[1]`, `src-title-info/annotation[1]`,
 * `document-info/history[1]`), node references (a path or a nodeId), the outline tree, the leaf
 * blocks of a part (`Block` of `read_part`), inline content arithmetic in model offsets and the
 * classification of a selection into the kinds of §3.2. Nothing here touches the SDK, the RPC
 * client or the store; everything is computed from the Document JSON and cached per document
 * object (a working copy hands out a new root after every write, so the cache expires with it).
 */

import type { ModelNodeJson } from '@/editor/fromModel';
import { contentSize } from '@/editor/structuralPath';
import type { Document, InlineNode, Mark } from '@/model/document';
import { plainText } from '@/scripting/api-impl';

/** The text containers of FB2: a model offset counts inside one of these. */
export const TEXT_CONTAINERS: ReadonlySet<string> = new Set([
  'p',
  'subtitle',
  'text-author',
  'v',
  'td',
  'th',
  'date',
]);

/** Node references of the §3 grammar that are resolved as paths; anything else is an id. */
export const PATH_REFERENCE =
  /^(body\[[1-9]\d*\]|title-info\/annotation\[1\]|src-title-info\/annotation\[1\]|document-info\/history\[1\])(\/[a-z-]+\[[1-9]\d*\])*$/;

/** `NodeInfo` of ai-catalogue §3: id, structural path, type and the text size where it has one. */
export interface NodeInfo {
  id: string;
  path: string;
  type: string;
  characters?: number;
}

/** `OutlineEntry` of ai-catalogue §2.1: bodies and sections, nested, titles whole (review C13). */
export interface OutlineEntry {
  id: string;
  path: string;
  type: 'body' | 'section';
  name?: string;
  title: string;
  characters: number;
  paragraphs: number;
  images: number;
  children: OutlineEntry[];
}

/** One unit of `read_part` in the `text` format (ai-catalogue §3.1). */
export type Block =
  | { id: string; path: string; type: string; text: string }
  | { id: string; path: string; type: 'image'; href: string; alt?: string }
  | { id: string; path: string; type: 'empty-line' }
  | { id: string; path: string; type: 'raw-xml'; xml: string };

/** A structural node of the document with its place: parent entry and root prefix. */
export interface Entry {
  node: ModelNodeJson;
  parent: Entry | null;
  /** The structural root the node lies under (`body[2]`, `title-info/annotation[1]`, …). */
  root: string;
  /** Depth 0 = a root node (a body, the annotation, the history). */
  depth: number;
}

export interface DocIndex {
  byId: Map<string, Entry>;
  /** The bodies in order (the outline's top level). */
  bodies: Entry[];
  /** Every root: the bodies, then the description's annotation / history nodes present. */
  roots: Entry[];
}

const indexCache = new WeakMap<Document, DocIndex>();

function nodeIdOf(node: ModelNodeJson): string {
  const id = node.attrs?.nodeId;
  return typeof id === 'string' ? id : '';
}

/** The index of the document's structural nodes, cached per document object. */
export function indexDocument(document: Document): DocIndex {
  const cached = indexCache.get(document);
  if (cached) return cached;
  const byId = new Map<string, Entry>();
  const bodies: Entry[] = [];
  const roots: Entry[] = [];
  const visit = (node: ModelNodeJson, parent: Entry | null, root: string, depth: number) => {
    const entry: Entry = { node, parent, root, depth };
    const id = nodeIdOf(node);
    if (id) byId.set(id, entry);
    for (const child of node.content ?? []) {
      if (child.type !== 'text') visit(child, entry, root, depth + 1);
    }
    return entry;
  };
  document.bodies.forEach((body, i) => {
    const entry = visit(body as unknown as ModelNodeJson, null, `body[${i + 1}]`, 0);
    bodies.push(entry);
    roots.push(entry);
  });
  const description = document.description;
  const descRoots: [ModelNodeJson | undefined, string][] = [
    [
      description.titleInfo.annotation as unknown as ModelNodeJson | undefined,
      'title-info/annotation[1]',
    ],
    [
      description.srcTitleInfo?.annotation as unknown as ModelNodeJson | undefined,
      'src-title-info/annotation[1]',
    ],
    [
      description.documentInfo.history as unknown as ModelNodeJson | undefined,
      'document-info/history[1]',
    ],
  ];
  for (const [node, root] of descRoots) {
    if (node) roots.push(visit(node, null, root, 0));
  }
  const index: DocIndex = { byId, bodies, roots };
  indexCache.set(document, index);
  return index;
}

/** The children of an entry's node as entries (text nodes skipped). */
export function childEntries(index: DocIndex, entry: Entry): Entry[] {
  const out: Entry[] = [];
  for (const child of entry.node.content ?? []) {
    if (child.type === 'text') continue;
    const id = nodeIdOf(child);
    const found = id ? index.byId.get(id) : undefined;
    out.push(found ?? { node: child, parent: entry, root: entry.root, depth: entry.depth + 1 });
  }
  return out;
}

/** The siblings list holding the entry's node (the bodies for a body). */
export function siblingsOf(index: DocIndex, entry: Entry): Entry[] {
  if (entry.parent) return childEntries(index, entry.parent);
  return index.roots.filter((root) => root.root.startsWith('body['));
}

/** 1-based index of `node` among the siblings of the same type (the 004 path rule). */
function sameTypeIndex(siblings: readonly ModelNodeJson[], node: ModelNodeJson): number {
  let count = 0;
  for (const sibling of siblings) {
    if (sibling.type === node.type) count += 1;
    if (sibling === node) break;
  }
  return Math.max(1, count);
}

/** The structural path of an entry: its root prefix, then `type[i]` per ancestor level. */
export function pathOf(entry: Entry): string {
  const segments: string[] = [];
  let current: Entry | null = entry;
  while (current && current.parent) {
    const siblings = current.parent.node.content ?? [];
    segments.unshift(`${current.node.type}[${sameTypeIndex(siblings, current.node)}]`);
    current = current.parent;
  }
  segments.unshift(entry.root);
  return segments.join('/');
}

/** UTF-16 code units of the text content below `node` (inline atoms not counted). */
export function characterCount(node: ModelNodeJson): number {
  if (node.type === 'text') return (node.text ?? '').length;
  let count = 0;
  for (const child of node.content ?? []) count += characterCount(child);
  return count;
}

function countType(node: ModelNodeJson, types: ReadonlySet<string>): number {
  if (node.type === 'text') return 0;
  let count = types.has(node.type) ? 1 : 0;
  for (const child of node.content ?? []) count += countType(child, types);
  return count;
}

const PARAGRAPH_TYPES: ReadonlySet<string> = new Set(['p']);
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image', 'inline-image']);

export function paragraphCount(node: ModelNodeJson): number {
  return countType(node, PARAGRAPH_TYPES);
}

export function imageCount(node: ModelNodeJson): number {
  return countType(node, IMAGE_TYPES);
}

/** The `NodeInfo` of an entry (`characters` for every node that has text below it). */
export function nodeInfo(entry: Entry): NodeInfo {
  const info: NodeInfo = { id: nodeIdOf(entry.node), path: pathOf(entry), type: entry.node.type };
  if (entry.node.type !== 'image' && entry.node.type !== 'empty-line') {
    info.characters = characterCount(entry.node);
  }
  return info;
}

/**
 * Resolves a node reference string: a match of `PATH_REFERENCE` is walked as a path (exact
 * segments, no clamping), anything else is looked up as an id. `null` when nothing matches.
 */
export function resolveReference(index: DocIndex, reference: string): Entry | null {
  if (!PATH_REFERENCE.test(reference)) return index.byId.get(reference) ?? null;
  const segments = reference.split('/');
  let current: Entry | undefined;
  let rest: string[];
  if (segments[0]!.startsWith('body[')) {
    const n = Number(/\[(\d+)\]/.exec(segments[0]!)![1]);
    current = index.bodies[n - 1];
    rest = segments.slice(1);
  } else {
    const root = `${segments[0]}/${segments[1]}`;
    current = index.roots.find((entry) => entry.root === root);
    rest = segments.slice(2);
  }
  for (const segment of rest) {
    if (!current) return null;
    const match = /^([a-z-]+)\[(\d+)\]$/.exec(segment)!;
    const candidates = childEntries(index, current).filter((e) => e.node.type === match[1]);
    current = candidates[Number(match[2]) - 1];
  }
  return current ?? null;
}

/** The plain text of a title node (its paragraphs joined with a space), `''` when absent. */
function titleText(node: ModelNodeJson): string {
  const title = (node.content ?? []).find((child) => child.type === 'title');
  if (!title) return '';
  return (title.content ?? [])
    .map((child) => plainText(child))
    .filter((text) => text.length > 0)
    .join(' ');
}

/**
 * The outline entry of a body or a section and its descendants (ai-catalogue §2.1), `depth`
 * levels deep (`undefined` = unlimited; 1 = the entry alone, its `children` empty).
 */
export function outlineEntry(index: DocIndex, entry: Entry, depth?: number): OutlineEntry {
  const node = entry.node;
  const out: OutlineEntry = {
    id: nodeIdOf(node),
    path: pathOf(entry),
    type: node.type === 'body' ? 'body' : 'section',
    title: titleText(node),
    characters: characterCount(node),
    paragraphs: paragraphCount(node),
    images: imageCount(node),
    children: [],
  };
  const name = node.attrs?.name;
  if (node.type === 'body' && typeof name === 'string' && name) out.name = name;
  if (depth === undefined || depth > 1) {
    out.children = childEntries(index, entry)
      .filter((child) => child.node.type === 'section')
      .map((child) => outlineEntry(index, child, depth === undefined ? undefined : depth - 1));
  }
  return out;
}

/** The whole outline: every body with its sections. */
export function outline(index: DocIndex, depth?: number): OutlineEntry[] {
  return index.bodies.map((body) => outlineEntry(index, body, depth));
}

/** True for the nodes `read_part` lists as blocks in the `text` format. */
export function isLeafBlock(node: ModelNodeJson): boolean {
  return (
    TEXT_CONTAINERS.has(node.type) ||
    node.type === 'image' ||
    node.type === 'empty-line' ||
    node.type === 'raw-xml'
  );
}

/** The leaf blocks of a part in document order (the part itself when it is one). */
export function leafBlocks(index: DocIndex, entry: Entry): Entry[] {
  if (isLeafBlock(entry.node)) return [entry];
  const out: Entry[] = [];
  for (const child of childEntries(index, entry)) out.push(...leafBlocks(index, child));
  return out;
}

/** The `Block` of a leaf entry (ai-catalogue §3.1 `read_part`, format `text`). */
export function blockOf(entry: Entry): Block {
  const node = entry.node;
  const id = nodeIdOf(node);
  const path = pathOf(entry);
  if (node.type === 'image') {
    const href = typeof node.attrs?.href === 'string' ? node.attrs.href : '';
    const alt = node.attrs?.alt;
    return typeof alt === 'string' && alt
      ? { id, path, type: 'image', href, alt }
      : { id, path, type: 'image', href };
  }
  if (node.type === 'empty-line') return { id, path, type: 'empty-line' };
  if (node.type === 'raw-xml') {
    return {
      id,
      path,
      type: 'raw-xml',
      xml: typeof node.attrs?.xml === 'string' ? node.attrs.xml : '',
    };
  }
  return { id, path, type: node.type, text: plainText(node) };
}

/* ------------------------------------------------------------------------ */
/* Inline content arithmetic (model offsets of the 004 contract)             */
/* ------------------------------------------------------------------------ */

/** Splits inline content at a model offset: text nodes are cut, atoms fall whole on one side. */
export function splitInline(
  content: readonly InlineNode[],
  offset: number,
): [InlineNode[], InlineNode[]] {
  const before: InlineNode[] = [];
  const after: InlineNode[] = [];
  let position = 0;
  for (const child of content) {
    const size = child.type === 'text' ? child.text.length : 1;
    if (position + size <= offset) {
      before.push(child);
    } else if (position >= offset) {
      after.push(child);
    } else {
      // A text node cut by the offset.
      const cut = offset - position;
      const text = (child as { text: string; marks?: Mark[] }).text;
      const marks = (child as { marks?: Mark[] }).marks;
      before.push({ type: 'text', text: text.slice(0, cut), ...(marks ? { marks } : {}) });
      after.push({ type: 'text', text: text.slice(cut), ...(marks ? { marks } : {}) });
    }
    position += size;
  }
  return [before, after];
}

/** The marks at a model offset: those of the text ending there, else of the text starting there. */
export function marksAt(content: readonly InlineNode[], offset: number): Mark[] | undefined {
  let position = 0;
  let previous: Mark[] | undefined;
  for (const child of content) {
    const size = child.type === 'text' ? child.text.length : 1;
    if (child.type === 'text') {
      if (offset > position && offset <= position + size) return child.marks;
      if (offset === position) return previous ?? child.marks;
      previous = child.marks;
    } else {
      previous = undefined;
    }
    position += size;
  }
  return previous;
}

/** The inline content between two model offsets of one container. */
export function sliceInline(
  content: readonly InlineNode[],
  from: number,
  to: number,
): InlineNode[] {
  const [, tail] = splitInline(content, Math.min(from, to));
  const [middle] = splitInline(tail, Math.abs(to - from));
  return middle;
}

/** The plain text of inline nodes (atoms as U+FFFC). */
export function inlineText(content: readonly InlineNode[]): string {
  return content.map((child) => (child.type === 'text' ? child.text : '\uFFFC')).join('');
}

/** True when a mark or an inline atom lies in the content. */
export function hasInlineElements(content: readonly InlineNode[]): boolean {
  return content.some((child) => child.type !== 'text' || (child.marks?.length ?? 0) > 0);
}

/** Joins adjacent text nodes with equal marks (keeps the model tidy after a splice). */
export function normalizeInline(content: readonly InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const child of content) {
    if (child.type === 'text' && child.text.length === 0) continue;
    const last = out[out.length - 1];
    if (
      last &&
      last.type === 'text' &&
      child.type === 'text' &&
      JSON.stringify(last.marks ?? []) === JSON.stringify(child.marks ?? [])
    ) {
      out[out.length - 1] = { ...last, text: last.text + child.text };
    } else {
      out.push(child);
    }
  }
  return out;
}

/** The model offset size of a text container's content. */
export function containerSize(node: ModelNodeJson): number {
  return contentSize(node as { type: string; content?: unknown[] });
}

/** The first / last text container below an entry (the entry itself when it is one). */
export function edgeTextContainer(
  index: DocIndex,
  entry: Entry,
  edge: 'first' | 'last',
): Entry | null {
  if (TEXT_CONTAINERS.has(entry.node.type)) return entry;
  const children = childEntries(index, entry);
  const ordered = edge === 'first' ? children : [...children].reverse();
  for (const child of ordered) {
    const found = edgeTextContainer(index, child, edge);
    if (found) return found;
  }
  return null;
}

/** The ancestors of an entry from the root down to the entry itself. */
export function ancestry(entry: Entry): Entry[] {
  const chain: Entry[] = [];
  for (let current: Entry | null = entry; current; current = current.parent) chain.unshift(current);
  return chain;
}

/**
 * The sibling blocks under the deepest common ancestor of two entries: the ancestor itself
 * (null for two bodies) and the children of it that hold `a` and `b`, in document order.
 */
export function commonParentBlocks(
  index: DocIndex,
  a: Entry,
  b: Entry,
): { parent: Entry | null; from: Entry; to: Entry; blocks: Entry[] } | null {
  const chainA = ancestry(a);
  const chainB = ancestry(b);
  let depth = 0;
  while (
    depth < chainA.length &&
    depth < chainB.length &&
    chainA[depth]!.node === chainB[depth]!.node
  ) {
    depth += 1;
  }
  if (depth === 0) {
    // Two different roots: bodies are siblings, description roots are not.
    if (!a.root.startsWith('body[') || !b.root.startsWith('body[')) return null;
    const bodies = index.bodies;
    const ia = bodies.findIndex((e) => e.node === chainA[0]!.node);
    const ib = bodies.findIndex((e) => e.node === chainB[0]!.node);
    const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
    return { parent: null, from: bodies[lo]!, to: bodies[hi]!, blocks: bodies.slice(lo, hi + 1) };
  }
  const parent = chainA[depth - 1]!;
  const siblings = childEntries(index, parent);
  const blockA = depth < chainA.length ? chainA[depth]! : parent;
  const blockB = depth < chainB.length ? chainB[depth]! : parent;
  if (blockA === parent || blockB === parent) {
    // One point lies in the other's ancestor: the selected block is the ancestor itself.
    const self = index.byId.get(nodeIdOf(parent.node)) ?? parent;
    const grand = self.parent;
    const list = grand ? childEntries(index, grand) : index.bodies;
    const i = list.findIndex((e) => e.node === self.node);
    return { parent: grand, from: self, to: self, blocks: i >= 0 ? [list[i]!] : [self] };
  }
  const ia = siblings.findIndex((e) => e.node === blockA.node);
  const ib = siblings.findIndex((e) => e.node === blockB.node);
  const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
  return { parent, from: siblings[lo]!, to: siblings[hi]!, blocks: siblings.slice(lo, hi + 1) };
}

export { nodeIdOf };
