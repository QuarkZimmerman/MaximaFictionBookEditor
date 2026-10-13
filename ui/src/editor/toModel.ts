/**
 * ProseMirror nodes -> document model JSON (T048), the inverse of `fromModel.ts`.
 *
 * Emits exactly the shape the core's JSON codec writes so a round trip is deep-equal:
 *  - structural nodes: `{type, attrs, content?}` - `attrs` always present without `null`
 *    values and without the PM-only `nodeId`-less defaults; `content` present for every
 *    non-leaf type (even when empty) and absent for leaf types (`empty-line`, `image`,
 *    `inline-image`, `raw-xml`);
 *  - text nodes: `{type: 'text', text, marks?}` with `marks` only when non-empty, in the
 *    canonical (schema rank) order; marks carry `attrs` only when they have any;
 *  - `raw_xml` / `raw_xml_inline` become `raw-xml` with `inline: true|false`; a node created
 *    from an unknown/unconvertible model node (`original` attribute) is emitted verbatim;
 *  - `extraAttrs` (attributes the schema did not know) are merged back into `attrs`.
 */

import type { Mark, Node as PMNode } from 'prosemirror-model';

import type { AnnotationNode, BodyNode, Mark as ModelMark } from '@/model/document';

import type { ModelNodeJson } from './fromModel';
import { LEAF_MODEL_TYPES, fb2NameFor } from './schema';

/** Attribute keys that never leave the editor. */
const PM_ONLY_ATTRS: ReadonlySet<string> = new Set(['extraAttrs', 'original']);

function markToModel(mark: Mark): ModelMark {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mark.attrs)) {
    if (value !== null && value !== undefined) attrs[key] = value;
  }
  const out: Record<string, unknown> = { type: mark.type.name };
  if (Object.keys(attrs).length > 0) out.attrs = attrs;
  return out as ModelMark;
}

function attrsToModel(node: PMNode): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.attrs)) {
    if (PM_ONLY_ATTRS.has(key)) continue;
    if (value === null || value === undefined) continue;
    attrs[key] = value;
  }
  const extra = node.attrs.extraAttrs;
  if (extra && typeof extra === 'object') {
    for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
      if (!(key in attrs)) attrs[key] = value;
    }
  }
  return attrs;
}

/** Converts one node (text, structural or raw-xml). */
export function nodeToModel(node: PMNode): ModelNodeJson {
  if (node.isText) {
    const out: ModelNodeJson = { type: 'text', text: node.text ?? '' };
    if (node.marks.length > 0) out.marks = node.marks.map(markToModel);
    return out;
  }

  const typeName = node.type.name;
  if (typeName === 'raw_xml' || typeName === 'raw_xml_inline') {
    const original = node.attrs.original;
    if (typeof original === 'string') {
      try {
        return JSON.parse(original) as ModelNodeJson;
      } catch {
        // fall through to the regular raw-xml shape
      }
    }
    const attrs = attrsToModel(node);
    attrs.inline = typeName === 'raw_xml_inline';
    return { type: 'raw-xml', attrs };
  }

  const fb2Type = fb2NameFor(node.type);
  const out: ModelNodeJson = { type: fb2Type, attrs: attrsToModel(node) };
  if (!LEAF_MODEL_TYPES.has(fb2Type)) {
    const content: ModelNodeJson[] = [];
    node.forEach((child) => {
      content.push(nodeToModel(child));
    });
    out.content = content;
  }
  return out;
}

/** `body` node -> BodyNode JSON. */
export function bodyToModel(node: PMNode): BodyNode {
  if (node.type.name !== 'body') {
    throw new Error(`bodyToModel: expected a body node, got "${node.type.name}"`);
  }
  return nodeToModel(node) as unknown as BodyNode;
}

/** `annotation` node -> AnnotationNode JSON (undefined when the annotation is empty). */
export function annotationToModel(node: PMNode): AnnotationNode | undefined {
  if (node.childCount === 0) return undefined;
  return nodeToModel(node) as unknown as AnnotationNode;
}

/** Every body of a `doc` node (whole-book mode) -> BodyNode[] JSON. */
export function docToBodies(doc: PMNode): BodyNode[] {
  const bodies: BodyNode[] = [];
  doc.forEach((child) => {
    if (child.type.name === 'body') bodies.push(bodyToModel(child));
  });
  return bodies;
}
