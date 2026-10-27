/**
 * Document model JSON -> ProseMirror nodes (T048).
 *
 * The body JSON of `document-model.d.ts` is already ProseMirror-shaped (`type`, `attrs`,
 * `content`, `text`, `marks`); this module maps the FB2 type names to the schema's node names
 * (`schema.ts`), fills attribute defaults and validates every node against the schema.
 *
 * It never throws on real-world input: problems are collected in a `ConversionReport`
 * (path, message) and the conversion degrades gracefully -
 *  - a node whose content violates the schema is still created (unchecked) so nothing is lost
 *    and the Body view can show it read-only;
 *  - a node of an unknown type, or one that cannot be created at all, becomes a `raw_xml`
 *    "unknown element" node carrying the original JSON in its `original` attribute, which
 *    `toModel.ts` emits back verbatim (lossless round trip);
 *  - attributes the schema does not declare are kept in the PM-only `extraAttrs` attribute.
 */

import { Fragment, Mark, Node as PMNode, type NodeType } from 'prosemirror-model';

import type {
  AnnotationNode,
  BodyNode,
  Document,
  Mark as ModelMark,
  RawXmlNode,
  TextNode,
} from '@/model/document';

import { fb2Schema, nodeTypeFor } from './schema';

/* ------------------------------------------------------------------------ */
/* Types                                                                    */
/* ------------------------------------------------------------------------ */

/** Loosely typed model node as it arrives over JSON (the union of all node shapes). */
export interface ModelNodeJson {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ModelNodeJson[];
  text?: string;
  marks?: ModelMark[];
}

export interface ConversionProblem {
  /** Model path such as `bodies[0]/section[2]/p[5]` (1-based element indexes like the core). */
  path: string;
  message: string;
  nodeId?: string;
}

export interface ConversionReport {
  problems: ConversionProblem[];
  /** Structural (non-text) nodes converted. */
  nodeCount: number;
}

export interface ConversionResult<N> {
  node: N;
  report: ConversionReport;
}

export function createReport(): ConversionReport {
  return { problems: [], nodeCount: 0 };
}

/* ------------------------------------------------------------------------ */
/* Conversion                                                               */
/* ------------------------------------------------------------------------ */

function childPath(parent: string, child: ModelNodeJson, index: number): string {
  return parent ? `${parent}/${child.type}[${index + 1}]` : `${child.type}[${index + 1}]`;
}

function convertMarks(
  marks: ModelMark[] | undefined,
  report: ConversionReport,
  path: string,
): readonly Mark[] {
  if (!marks || marks.length === 0) return Mark.none;
  const out: Mark[] = [];
  for (const mark of marks) {
    const type = fb2Schema.marks[mark.type];
    if (!type) {
      report.problems.push({ path, message: `unknown mark type "${mark.type}" dropped` });
      continue;
    }
    const attrs = 'attrs' in mark && mark.attrs ? (mark.attrs as Record<string, unknown>) : {};
    try {
      out.push(type.create(attrs));
    } catch (error) {
      report.problems.push({ path, message: `mark "${mark.type}": ${String(error)}` });
    }
  }
  return out;
}

function convertText(json: ModelNodeJson, report: ConversionReport, path: string): PMNode | null {
  const text = json.text ?? '';
  if (text.length === 0) {
    // ProseMirror forbids empty text nodes; dropping it loses nothing.
    return null;
  }
  return fb2Schema.text(text, convertMarks(json.marks, report, path));
}

/** Splits the JSON attrs into the ones the node type declares and the unknown rest. */
function splitAttrs(type: NodeType, attrs: Record<string, unknown> | undefined) {
  const known: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'extraAttrs' || key === 'original') continue; // PM-only names never come from the core
      if (type.spec.attrs && key in type.spec.attrs) known[key] = value;
      else extra[key] = value;
    }
  }
  if (Object.keys(extra).length > 0) known.extraAttrs = extra;
  return known;
}

function unknownElement(
  json: ModelNodeJson,
  inline: boolean,
  report: ConversionReport,
  path: string,
  message: string,
): PMNode {
  report.problems.push({ path, message, nodeId: nodeIdOf(json) });
  const type = inline ? fb2Schema.nodes.raw_xml_inline! : fb2Schema.nodes.raw_xml!;
  const xml = typeof json.attrs?.xml === 'string' ? json.attrs.xml : `<${json.type}/>`;
  // An inline one keeps the marks of the node it stands for (feature 006, FR-067).
  const marks = inline ? convertMarks(json.marks, report, path) : undefined;
  return type.create(
    { nodeId: nodeIdOf(json) ?? null, xml, original: JSON.stringify(json) },
    null,
    marks,
  );
}

/** Node types whose model nodes carry marks besides text: the inline atoms (FR-067). */
function isInlineAtom(type: NodeType): boolean {
  return type === fb2Schema.nodes.inline_image || type === fb2Schema.nodes.raw_xml_inline;
}

function nodeIdOf(json: ModelNodeJson): string | undefined {
  const id = json.attrs?.nodeId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Converts one model node. `inlineContext` tells whether the node sits in inline content
 * (decides which `raw-xml` variant to use and how unknown nodes are wrapped).
 */
export function nodeFromModel(
  json: ModelNodeJson,
  report: ConversionReport = createReport(),
  path = json.type,
  inlineContext = false,
): PMNode | null {
  if (json.type === 'text') return convertText(json, report, path);

  const isRaw = json.type === 'raw-xml';
  const inline = isRaw ? json.attrs?.inline === true || inlineContext : false;
  const type = nodeTypeFor(json.type, inline);
  if (!type) {
    return unknownElement(json, inlineContext, report, path, `unknown node type "${json.type}"`);
  }
  report.nodeCount += 1;

  const attrs = splitAttrs(type, json.attrs);
  if (isRaw) {
    // `inline` is encoded in the node type, not kept as an attribute.
    delete attrs.inline;
    if (attrs.extraAttrs && typeof attrs.extraAttrs === 'object') {
      const extra = { ...(attrs.extraAttrs as Record<string, unknown>) };
      delete extra.inline;
      if (Object.keys(extra).length === 0) delete attrs.extraAttrs;
      else attrs.extraAttrs = extra;
    }
  }

  const children: PMNode[] = [];
  const childInline = type.inlineContent;
  (json.content ?? []).forEach((child, index) => {
    const converted = nodeFromModel(child, report, childPath(path, child, index), childInline);
    if (converted) children.push(converted);
  });
  if (type.isLeaf && children.length > 0) {
    report.problems.push({
      path,
      message: `leaf node "${json.type}" had ${children.length} children (dropped)`,
      nodeId: nodeIdOf(json),
    });
    children.length = 0;
  }

  const fragment = Fragment.from(children);
  // An inline image or inline raw XML keeps the link and the formatting around it (feature
  // 006, FR-067); no block node takes marks.
  const marks = isInlineAtom(type) ? convertMarks(json.marks, report, path) : undefined;
  try {
    return type.createChecked(attrs, fragment, marks);
  } catch (error) {
    // Content or attributes violate the schema: keep the node (unchecked) and report it.
    report.problems.push({
      path,
      message: String(error instanceof Error ? error.message : error),
      nodeId: nodeIdOf(json),
    });
    try {
      return type.create(attrs, fragment, marks);
    } catch (fatal) {
      return unknownElement(json, inlineContext, report, path, String(fatal));
    }
  }
}

/** Body JSON -> `body` node (never throws). */
export function bodyFromModel(
  body: BodyNode,
  report: ConversionReport = createReport(),
  path = 'bodies[1]',
): PMNode {
  const node = nodeFromModel(body as unknown as ModelNodeJson, report, path);
  if (node && node.type === fb2Schema.nodes.body) return node;
  // Not a body at all (unknown shape): wrap it so the document still loads.
  const wrapped = node ?? fb2Schema.nodes.raw_xml!.create({ xml: '<body/>' });
  return fb2Schema.nodes.body!.create(null, fb2Schema.nodes.section!.create(null, wrapped));
}

/** Annotation / history JSON -> `annotation` node (for the Description rich fields). */
export function annotationFromModel(
  annotation: AnnotationNode | undefined,
  report: ConversionReport = createReport(),
  path = 'annotation',
): PMNode {
  if (!annotation) return fb2Schema.nodes.annotation!.create(null);
  const node = nodeFromModel(annotation as unknown as ModelNodeJson, report, path);
  if (node && node.type === fb2Schema.nodes.annotation) return node;
  return fb2Schema.nodes.annotation!.create(null, node ? [node] : []);
}

/** All bodies of a document -> `doc` node (whole-book mode). */
export function docFromModel(model: Pick<Document, 'bodies'>): ConversionResult<PMNode> {
  const report = createReport();
  const bodies = model.bodies.map((body, index) =>
    bodyFromModel(body, report, `bodies[${index + 1}]`),
  );
  return { node: fb2Schema.nodes.doc!.create(null, bodies), report };
}

/** A `doc` node holding exactly the given bodies (windowing helper). */
export function docFromBodies(bodies: PMNode[]): PMNode {
  return fb2Schema.nodes.doc!.create(null, bodies);
}

export type { RawXmlNode, TextNode };
