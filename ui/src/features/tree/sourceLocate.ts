/**
 * "View Source" of the Document Tree (T084, US5 scenario 3): finds the line/column of a tree
 * element in the serialised XML text of the document.
 *
 * The core gives no node -> line map (`doc.toXml` returns the text only), so the position is
 * derived from the model: the serialiser writes the bodies in model order, therefore the n-th
 * `<type` tag after the first `<body` tag belongs to the n-th node of that type in a pre-order
 * walk of the bodies (inline images count as `<image` too). When the element carries an XML
 * `id` attribute, the `id="..."` occurrence after the body start is used instead (ids are
 * unique, FR-012). Unknown elements (`raw-xml`) that happen to contain the same tag name would
 * shift the count - acceptable for a navigation aid, and the element's own `id` wins anyway.
 *
 * The Annotation and History rows of feature 004 (US2) name description elements: the first
 * `<annotation` inside `<title-info>` (the source title info's annotation is skipped) and the
 * only `<history`; when the element is not in the file (an empty block), the view lands on its
 * parent block (`<title-info`, `<document-info`).
 */

import type { ModelNodeJson } from '@/editor/fromModel';
import { FIXED_BLOCK_IDS } from '@/editor/schema';
import type { Document } from '@/model/document';

import { locateNode } from '../treeOps';

export interface SourcePosition {
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  /** 0-based offset of the `<` of the element's opening tag. */
  offset: number;
}

/** XML element name of a model node type (`inline-image` -> `image`). */
export function xmlTagOf(type: string): string {
  return type === 'inline-image' ? 'image' : type;
}

/** 0-based count of nodes serialised as `<tag` before `nodeId` in a pre-order walk of the bodies. */
export function tagOrdinal(model: Pick<Document, 'bodies'>, nodeId: string): number | null {
  const located = locateNode(model, nodeId);
  if (!located) return null;
  const tag = xmlTagOf(located.node.type);
  let count = 0;
  let found = false;
  const visit = (node: ModelNodeJson): void => {
    if (found || node.type === 'text') return;
    if (xmlTagOf(node.type) === tag) {
      if (node.attrs?.nodeId === nodeId) {
        found = true;
        return;
      }
      count += 1;
    }
    for (const child of node.content ?? []) {
      visit(child);
      if (found) return;
    }
  };
  for (const body of model.bodies) {
    visit(body as unknown as ModelNodeJson);
    if (found) break;
  }
  return found ? count : null;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/** Offset of the n-th (0-based) `<tag` opening tag at or after `from`, or -1. */
export function nthTagOffset(text: string, tag: string, n: number, from = 0): number {
  const re = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
  re.lastIndex = from;
  let index = 0;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    if (index === n) return match.index;
    index += 1;
  }
  return -1;
}

/** Offset of the first `<tag` at or after `from` and before `end`, or -1. */
function tagBetween(text: string, tag: string, from: number, end: number): number {
  const offset = nthTagOffset(text, tag, 0, Math.max(0, from));
  return offset >= 0 && offset < end ? offset : -1;
}

/**
 * The description element of a block row (feature 004): the title-info annotation or the
 * history, else - the element is absent - its parent block; null without a description.
 */
function locateDescriptionBlock(text: string, nodeId: string): SourcePosition | null {
  const descriptionEnd = text.search(/<\/description\s*>|<body(?=[\s/>])/);
  const end = descriptionEnd < 0 ? text.length : descriptionEnd;
  const parentTag = nodeId === FIXED_BLOCK_IDS.annotation ? 'title-info' : 'document-info';
  const parent = tagBetween(text, parentTag, 0, end);
  if (parent < 0) return null;
  const close = text.indexOf(`</${parentTag}`, parent);
  const parentEnd = close < 0 ? end : Math.min(close, end);
  const own = nodeId === FIXED_BLOCK_IDS.annotation ? 'annotation' : 'history';
  const offset = tagBetween(text, own, parent, parentEnd);
  const at = offset >= 0 ? offset : parent;
  return { ...lineColumnAt(text, at), offset: at };
}

/** Position of the tree element `nodeId` in `text` (the serialised document), or null. */
export function locateInSource(
  text: string,
  model: Pick<Document, 'bodies'>,
  nodeId: string,
): SourcePosition | null {
  if (nodeId === FIXED_BLOCK_IDS.annotation || nodeId === FIXED_BLOCK_IDS.history) {
    return locateDescriptionBlock(text, nodeId);
  }
  const located = locateNode(model, nodeId);
  if (!located) return null;
  const bodyStart = Math.max(0, text.search(/<body(?=[\s/>])/));

  const id = located.node.attrs?.id;
  if (typeof id === 'string' && id) {
    for (const quoted of [`id="${escapeAttribute(id)}"`, `id='${escapeAttribute(id)}'`]) {
      const at = text.indexOf(quoted, bodyStart);
      if (at >= 0) {
        const open = text.lastIndexOf('<', at);
        if (open >= 0) return { ...lineColumnAt(text, open), offset: open };
      }
    }
  }

  const ordinal = tagOrdinal(model, nodeId);
  if (ordinal === null) return null;
  const offset = nthTagOffset(text, xmlTagOf(located.node.type), ordinal, bodyStart);
  if (offset < 0) return null;
  return { ...lineColumnAt(text, offset), offset };
}
