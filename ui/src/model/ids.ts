/**
 * Book ids and link counts in the model layer (feature 006; I12; C8; data-model §0 "Book ids",
 * §10.2; research R2.8): shared helpers for FR-015's count of links that would lose their
 * target, FR-022's uniqueness of ids and FR-067's linked atoms. They read the store's document,
 * which every Body and Description change updates, so a check covers the whole book although
 * the Body editor holds a window of it.
 *
 * This module imports nothing from `ui/src/features` or `ui/src/app` (C8): the table engine,
 * the paste router and the assistant receive the ids by injection (`PlanContext.bookIds`,
 * `ClipboardOptions.bookIds`).
 */

import type { AnnotationNode, BodyNode, Document, Mark } from './document';

/** A model node as the walkers see it (the union of every node shape). */
interface LooseNode {
  type?: unknown;
  attrs?: Record<string, unknown> | null;
  content?: unknown;
  marks?: Mark[];
}

function contentOf(node: LooseNode): LooseNode[] {
  return Array.isArray(node.content) ? (node.content as LooseNode[]) : [];
}

/* ------------------------------------------------------------------------ */
/* Book ids                                                                 */
/* ------------------------------------------------------------------------ */

const treeIds = new WeakMap<object, ReadonlySet<string>>();
const documentIds = new WeakMap<object, ReadonlySet<string>>();

/** The `id`s of a body or annotation tree, memoised per tree object; raw XML not looked into. */
function idsOfTree(tree: BodyNode | AnnotationNode): ReadonlySet<string> {
  let ids = treeIds.get(tree);
  if (ids) return ids;
  const found = new Set<string>();
  const visit = (node: LooseNode) => {
    if (node.type === 'raw-xml' || node.type === 'text') return;
    const id = node.attrs?.id;
    if (typeof id === 'string' && id !== '') found.add(id);
    for (const child of contentOf(node)) visit(child);
  };
  visit(tree as unknown as LooseNode);
  ids = found;
  treeIds.set(tree, ids);
  return ids;
}

/**
 * Every FB2 id of the book (one `xs:ID` space, `resources/schema/FictionBook.xsd:225`): the
 * `id`s of the bodies, of the book's and the source book's annotations and of the history, and
 * every binary's `id`. Ids inside raw XML are not collected. Memoised per body and annotation
 * object, and per document object.
 */
export function collectBookIds(doc: Document): ReadonlySet<string> {
  let ids = documentIds.get(doc);
  if (ids) return ids;
  const found = new Set<string>();
  const add = (tree: BodyNode | AnnotationNode | undefined) => {
    if (!tree) return;
    for (const id of idsOfTree(tree)) found.add(id);
  };
  for (const body of doc.bodies) add(body);
  add(doc.description.titleInfo.annotation);
  add(doc.description.srcTitleInfo?.annotation);
  add(doc.description.documentInfo.history);
  for (const binary of doc.binaries) {
    if (typeof binary.id === 'string' && binary.id !== '') found.add(binary.id);
  }
  ids = found;
  documentIds.set(doc, ids);
  return ids;
}

/* ------------------------------------------------------------------------ */
/* Link counts                                                              */
/* ------------------------------------------------------------------------ */

type LinkMark = Extract<Mark, { type: 'link' }>;

function linkOf(node: LooseNode): LinkMark | null {
  const marks = Array.isArray(node.marks) ? node.marks : [];
  return (marks.find((mark) => mark?.type === 'link') as LinkMark | undefined) ?? null;
}

function sameLink(a: LinkMark, b: LinkMark): boolean {
  return (
    a.attrs?.href === b.attrs?.href &&
    (a.attrs?.type ?? null) === (b.attrs?.type ?? null) &&
    (a.attrs?.xlinkType ?? null) === (b.attrs?.xlinkType ?? null)
  );
}

function isInline(node: LooseNode): boolean {
  return (
    node.type === 'text' ||
    node.type === 'inline-image' ||
    (node.type === 'raw-xml' && node.attrs?.inline === true)
  );
}

/**
 * The links of the book whose `href` is `#<id>` for one of `ids`, in the bodies, both
 * annotations and the history. A link is a run of adjacent inline nodes that carry one and the
 * same link mark - text, inline images and inline raw XML alike (FR-067, data-model §12.4) -,
 * so a linked picture is a link, a link over text and a picture counts once, and two separate
 * links to one id count two.
 */
export function countLinksTo(doc: Document, ids: Iterable<string>): number {
  const targets = new Set<string>();
  for (const id of ids) targets.add(`#${id}`);
  if (targets.size === 0) return 0;
  let count = 0;
  const visit = (node: LooseNode) => {
    const children = contentOf(node);
    if (children.some(isInline)) {
      let previous: LinkMark | null = null;
      for (const child of children) {
        const link = linkOf(child);
        if (link && !(previous && sameLink(previous, link))) {
          if (typeof link.attrs?.href === 'string' && targets.has(link.attrs.href)) count += 1;
        }
        previous = link;
      }
      return;
    }
    for (const child of children) {
      if (child.type !== 'raw-xml') visit(child);
    }
  };
  const trees: (BodyNode | AnnotationNode | undefined)[] = [
    ...doc.bodies,
    doc.description.titleInfo.annotation,
    doc.description.srcTitleInfo?.annotation,
    doc.description.documentInfo.history,
  ];
  for (const tree of trees) {
    if (tree) visit(tree as unknown as LooseNode);
  }
  return count;
}
