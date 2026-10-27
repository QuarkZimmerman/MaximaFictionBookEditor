/**
 * Document Tree model (T084): the rows of the "Document structure" panel built from the document
 * JSON, after the original `CTreeView::MakeNode` / `CElementDescMnr` (reference `FBE/TreeView.cpp`,
 * `FBE/ElementDescMnr.cpp`): bodies and sections are containers; titles, epigraphs, annotations,
 * images, poems, cites and tables are leaf rows. Captions follow `U::FindTitle` /
 * `GetImageFileName`: the body's `name` or title, the section's title text, the image href
 * without `#`, otherwise the first text of the element, and `<type>` when there is no text.
 *
 * Rows are cached per top-level section object (the model is immutable, so an edit replaces only
 * the objects on the path to the change): a keystroke in a 10 MB book rebuilds one section.
 *
 * Feature 004 (US2, FR-013): two depth-0 rows precede the bodies whatever the document holds -
 * "Annotation" (`desc:annotation`) and "History" (`desc:history`), the Body view's blocks over
 * `title-info/annotation` and `document-info/history`. They are not sections: Move, Merge and
 * Delete are unavailable for them (`features/tree`), View and View Source work.
 *
 * Feature 006 (US8, FR-058; decision 8; C58; I18; data-model §3.6): a table row carries the
 * summary of an irregular table (`tableProblems`), and the rows of a cite, an annotation and an
 * epigraph - whose children have no rows - and the two block rows carry the summaries of the
 * irregular tables below them, in document order (`containedTables`), so the tree marks the
 * repair candidates of a long book. The source book's annotation has no row: its tables are
 * marked in the Description view only. The summaries are cached with the section's rows.
 */

import type { ModelNodeJson } from '@/editor/fromModel';
import { FIXED_BLOCK_IDS, type BlockKind } from '@/editor/schema';
import { gridOfModel, type TableSummary } from '@/editor/table/grid';
import { descriptionBlockOf, locateNode } from '@/features/treeOps';
import type { Document, TableNode } from '@/model/document';

export type TreeRowKind =
  | 'annotationBlock'
  | 'historyBlock'
  | 'body'
  | 'section'
  | 'title'
  | 'epigraph'
  | 'annotation'
  | 'image'
  | 'poem'
  | 'cite'
  | 'table';

/** The row kinds of the two description blocks (never sections: no Move / Merge / Delete). */
export const BLOCK_ROW_KINDS: ReadonlySet<TreeRowKind> = new Set<TreeRowKind>([
  'annotationBlock',
  'historyBlock',
]);

/** Captions of the two block rows (`tree.node.annotation` / `tree.node.history`). */
export interface BlockCaptions {
  annotation: string;
  history: string;
}

export const ROW_KINDS: ReadonlySet<string> = new Set<TreeRowKind>([
  'body',
  'section',
  'title',
  'epigraph',
  'annotation',
  'image',
  'poem',
  'cite',
  'table',
]);

/** Image file of the original `struct.bmp` image list for each row kind (`ElementDescMnr.cpp`). */
export const ROW_ICONS: Readonly<Record<TreeRowKind, string>> = {
  annotationBlock: 'struct-12',
  historyBlock: 'struct-15',
  body: 'struct-00',
  section: 'struct-00',
  poem: 'struct-03',
  cite: 'struct-09',
  annotation: 'struct-12',
  epigraph: 'struct-18',
  image: 'struct-21',
  title: 'struct-27',
  table: 'struct-30',
};

export interface TreeRow {
  /** nodeId of the element. */
  id: string;
  kind: TreeRowKind;
  caption: string;
  depth: number;
  parentId: string | null;
  childIds: string[];
  /** A table row: the summary of its table when it is irregular (feature 006, FR-058). */
  tableProblems?: TableSummary;
  /**
   * A cite, annotation or epigraph row and the two block rows: the summaries of the irregular
   * tables below the element, which have no rows of their own, in document order (decision 8).
   */
  containedTables?: TableSummary[];
}

export interface TreeIndex {
  rows: ReadonlyMap<string, TreeRow>;
  /** Depth-0 row ids: the two block rows, then the bodies. */
  roots: readonly string[];
  /** Every row id in document (pre-order) order. */
  order: readonly string[];
  /** Number of section rows. */
  sectionCount: number;
}

export const EMPTY_TREE_INDEX: TreeIndex = {
  rows: new Map(),
  roots: [],
  order: [],
  sectionCount: 0,
};

export const CAPTION_MAX_LENGTH = 80;

/* ------------------------------------------------------------------------ */
/* Captions                                                                 */
/* ------------------------------------------------------------------------ */

function nodeIdOf(node: ModelNodeJson): string | null {
  const id = node.attrs?.nodeId;
  return typeof id === 'string' && id ? id : null;
}

/** Collapses white space (`U::NormalizeInplace`) and truncates long captions. */
export function normalizeCaption(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= CAPTION_MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, CAPTION_MAX_LENGTH - 1).trimEnd()}\u2026`;
}

/** The text of the first `limit` characters of a node's descendants. */
export function firstText(node: ModelNodeJson, limit = CAPTION_MAX_LENGTH * 2): string {
  let out = '';
  const visit = (current: ModelNodeJson): boolean => {
    if (current.type === 'text') {
      out += current.text ?? '';
      return out.length < limit;
    }
    if (current.type === 'inline-image' || current.type === 'image') return true;
    for (const child of current.content ?? []) {
      if (!visit(child)) return false;
      if (child.type !== 'text' && out.length > 0) out += ' ';
    }
    return true;
  };
  visit(node);
  return out;
}

/** Text of the element's own `title` child (`U::FindTitle`), or ''. */
export function titleText(node: ModelNodeJson): string {
  const title = (node.content ?? []).find((child) => child.type === 'title');
  return title ? firstText(title) : '';
}

function rawCaption(node: ModelNodeJson, kind: TreeRowKind): string {
  switch (kind) {
    case 'body': {
      const name = node.attrs?.name;
      return (typeof name === 'string' && name) || titleText(node);
    }
    case 'section':
      return titleText(node);
    case 'poem':
      return titleText(node) || firstText(node);
    case 'image': {
      const href = node.attrs?.href;
      if (typeof href === 'string' && href) return href.replace(/^#/, '');
      const alt = node.attrs?.alt ?? node.attrs?.title;
      return typeof alt === 'string' ? alt : '';
    }
    default:
      return firstText(node);
  }
}

export function captionFor(node: ModelNodeJson, kind: TreeRowKind): string {
  return normalizeCaption(rawCaption(node, kind)) || `<${kind}>`;
}

/* ------------------------------------------------------------------------ */
/* Index                                                                    */
/* ------------------------------------------------------------------------ */

interface SubtreeRows {
  depth: number;
  parentId: string | null;
  rows: TreeRow[];
  sectionCount: number;
}

/** Rows of a top-level section (and of a whole body), keyed by the immutable node object. */
const subtreeCache = new WeakMap<object, SubtreeRows>();

function isRowNode(node: ModelNodeJson): node is ModelNodeJson & { type: TreeRowKind } {
  return ROW_KINDS.has(node.type) && nodeIdOf(node) !== null;
}

/** The kinds of row whose children have no rows: they stand for the tables inside them. */
const CONTAINER_KINDS: ReadonlySet<TreeRowKind> = new Set<TreeRowKind>([
  'cite',
  'annotation',
  'epigraph',
]);

/** The summary of an irregular table, null for a regular one (the Body view's, I21). */
function irregularSummary(table: ModelNodeJson): TableSummary | null {
  const grid = gridOfModel(table as unknown as TableNode);
  return grid.regular ? null : grid.summary;
}

/** The summaries of the irregular tables anywhere below `node`, in document order. */
function irregularTablesIn(node: ModelNodeJson): TableSummary[] {
  const found: TableSummary[] = [];
  const visit = (current: ModelNodeJson) => {
    for (const child of current.content ?? []) {
      if (child.type === 'table') {
        const summary = irregularSummary(child);
        if (summary) found.push(summary);
      } else if (child.type !== 'text' && child.type !== 'raw-xml') {
        visit(child);
      }
    }
  };
  visit(node);
  return found;
}

function collectRows(
  node: ModelNodeJson,
  depth: number,
  parentId: string | null,
  out: TreeRow[],
  counter: { sections: number },
): TreeRow | null {
  if (!isRowNode(node)) return null;
  const id = nodeIdOf(node)!;
  const kind = node.type as TreeRowKind;
  const row: TreeRow = { id, kind, caption: captionFor(node, kind), depth, parentId, childIds: [] };
  if (kind === 'table') {
    const summary = irregularSummary(node);
    if (summary) row.tableProblems = summary;
  } else if (CONTAINER_KINDS.has(kind)) {
    const contained = irregularTablesIn(node);
    if (contained.length > 0) row.containedTables = contained;
  }
  out.push(row);
  if (kind === 'section') counter.sections += 1;
  if (kind === 'body' || kind === 'section') {
    for (const child of node.content ?? []) {
      const childRow = collectRows(child, depth + 1, id, out, counter);
      if (childRow) row.childIds.push(childRow.id);
    }
  }
  return row;
}

function subtreeRows(node: ModelNodeJson, depth: number, parentId: string | null): SubtreeRows {
  const cached = subtreeCache.get(node);
  if (cached && cached.depth === depth && cached.parentId === parentId) return cached;
  const rows: TreeRow[] = [];
  const counter = { sections: 0 };
  collectRows(node, depth, parentId, rows, counter);
  const built: SubtreeRows = { depth, parentId, rows, sectionCount: counter.sections };
  subtreeCache.set(node, built);
  return built;
}

/** The irregular tables of a description annotation (or the history), per annotation object. */
const blockTablesCache = new WeakMap<object, TableSummary[] | null>();

function blockTables(annotation: object | undefined): TableSummary[] | undefined {
  if (!annotation) return undefined;
  let cached = blockTablesCache.get(annotation);
  if (cached === undefined) {
    const found = irregularTablesIn(annotation as ModelNodeJson);
    cached = found.length > 0 ? found : null;
    blockTablesCache.set(annotation, cached);
  }
  return cached ?? undefined;
}

/** The block row of `kind` (always present; the caption is the tree node's text). */
function blockRow(
  kind: BlockKind,
  captions: BlockCaptions,
  description: Document['description'] | undefined,
): TreeRow {
  const row: TreeRow = {
    id: FIXED_BLOCK_IDS[kind],
    kind: kind === 'annotation' ? 'annotationBlock' : 'historyBlock',
    caption: captions[kind],
    depth: 0,
    parentId: null,
    childIds: [],
  };
  const contained = blockTables(
    kind === 'annotation' ? description?.titleInfo.annotation : description?.documentInfo.history,
  );
  if (contained) row.containedTables = contained;
  return row;
}

/**
 * Builds the tree index of a document: the Annotation and History rows, then the bodies ->
 * sections -> ... `captions` are the texts of the two block rows in the interface language.
 */
export function buildTreeIndex(
  document: (Pick<Document, 'bodies'> & Partial<Pick<Document, 'description'>>) | null,
  captions: BlockCaptions,
): TreeIndex {
  if (!document) return EMPTY_TREE_INDEX;
  const rows = new Map<string, TreeRow>();
  const roots: string[] = [];
  const order: string[] = [];
  let sectionCount = 0;
  const add = (row: TreeRow) => {
    rows.set(row.id, row);
    order.push(row.id);
  };
  for (const kind of ['annotation', 'history'] as const) {
    const row = blockRow(kind, captions, document.description);
    roots.push(row.id);
    add(row);
  }
  for (const body of document.bodies) {
    const json = body as unknown as ModelNodeJson;
    const bodyId = nodeIdOf(json);
    if (!bodyId) continue;
    const bodyRow: TreeRow = {
      id: bodyId,
      kind: 'body',
      caption: captionFor(json, 'body'),
      depth: 0,
      parentId: null,
      childIds: [],
    };
    roots.push(bodyId);
    add(bodyRow);
    for (const child of json.content ?? []) {
      if (!isRowNode(child)) continue;
      // Top-level sections are cached per object; header rows of the body are cheap.
      const subtree = subtreeRows(child, 1, bodyId);
      const first = subtree.rows[0];
      if (!first) continue;
      bodyRow.childIds.push(first.id);
      for (const row of subtree.rows) add(row);
      sectionCount += subtree.sectionCount;
    }
  }
  return { rows, roots, order, sectionCount };
}

/* ------------------------------------------------------------------------ */
/* Navigation helpers                                                       */
/* ------------------------------------------------------------------------ */

/** Row ids from the root body down to (excluding) `id`. */
export function ancestorRows(index: TreeIndex, id: string): string[] {
  const out: string[] = [];
  let current = index.rows.get(id)?.parentId ?? null;
  while (current) {
    out.unshift(current);
    current = index.rows.get(current)?.parentId ?? null;
  }
  return out;
}

export function isRowWithin(index: TreeIndex, id: string, ancestorId: string): boolean {
  let current: string | null = id;
  while (current) {
    if (current === ancestorId) return true;
    current = index.rows.get(current)?.parentId ?? null;
  }
  return false;
}

/**
 * The row that represents the element `nodeId`: the element's own row when it has one, else the
 * nearest ancestor shown in the tree (a paragraph -> its section, a verse -> its poem); a node
 * under the description's annotation or history maps to its block row (feature 004).
 */
export function rowForNode(
  index: TreeIndex,
  document: (Pick<Document, 'bodies'> & Partial<Pick<Document, 'description'>>) | null,
  nodeId: string | null,
): string | null {
  if (!nodeId || !document) return null;
  if (index.rows.has(nodeId)) return nodeId;
  const located = locateNode(document, nodeId);
  if (located) {
    for (let i = located.ancestors.length - 1; i >= 0; i -= 1) {
      const id = located.ancestors[i]!.attrs?.nodeId;
      if (typeof id === 'string' && index.rows.has(id)) return id;
    }
    return null;
  }
  const block = document.description ? descriptionBlockOf(document.description, nodeId) : null;
  return block ? FIXED_BLOCK_IDS[block] : null;
}

/**
 * The row of the Body selection: `rowForNode` for the selection's node, else - an empty block
 * holds a UI paragraph the model does not know - the block row the selection's structural path
 * names (`title-info/annotation[1]/...`, `document-info/history[1]/...`).
 */
export function rowForSelection(
  index: TreeIndex,
  document: (Pick<Document, 'bodies'> & Partial<Pick<Document, 'description'>>) | null,
  nodeId: string | null,
  path: string,
): string | null {
  const own = rowForNode(index, document, nodeId);
  if (own) return own;
  if (path.startsWith('title-info/annotation[1]')) return FIXED_BLOCK_IDS.annotation;
  if (path.startsWith('document-info/history[1]')) return FIXED_BLOCK_IDS.history;
  return null;
}

/** Visible rows in display order given the collapsed containers. */
export function visibleRows(index: TreeIndex, collapsed: ReadonlySet<string>): TreeRow[] {
  const out: TreeRow[] = [];
  const visit = (id: string) => {
    const row = index.rows.get(id);
    if (!row) return;
    out.push(row);
    if (collapsed.has(id)) return;
    for (const child of row.childIds) visit(child);
  };
  for (const root of index.roots) visit(root);
  return out;
}

/* ------------------------------------------------------------------------ */
/* Panel constants                                                          */
/* ------------------------------------------------------------------------ */

export const TREE_ROW_HEIGHT = 22;

export interface TreeMenuEntry {
  id: string;
  commandId: string;
  labelKey: string;
}

/** `IDR_DOCUMENT_TREE` menu of the original (View, View Source | Move Right, Move With Children, Move Left | Merge, Delete). */
export const TREE_MENU: readonly (TreeMenuEntry | 'separator')[] = [
  { id: 'view', commandId: 'tree.view', labelKey: 'tree.menu.view' },
  { id: 'viewSource', commandId: 'tree.viewSource', labelKey: 'tree.menu.viewSource' },
  'separator',
  { id: 'moveRight', commandId: 'tree.moveRight', labelKey: 'tree.menu.moveRight' },
  {
    id: 'moveWithChildren',
    commandId: 'tree.moveWithChildren',
    labelKey: 'tree.menu.moveWithChildren',
  },
  { id: 'moveLeft', commandId: 'tree.moveLeft', labelKey: 'tree.menu.moveLeft' },
  'separator',
  { id: 'merge', commandId: 'tree.merge', labelKey: 'tree.menu.merge' },
  { id: 'delete', commandId: 'tree.delete', labelKey: 'tree.menu.delete' },
];

/** `IDR_DOCUMENT_TREE TOOLBAR` buttons (Right, Right smart, Left, Merge, Delete). */
export const TREE_TOOLBAR: readonly {
  op: 'moveRight' | 'moveWithChildren' | 'moveLeft' | 'merge' | 'delete';
  testId: string;
  icon: string;
  labelKey: string;
}[] = [
  {
    op: 'moveRight',
    testId: 'tree-toolbar-right',
    icon: 'id_dt_right_one',
    labelKey: 'tree.toolbar.right',
  },
  {
    op: 'moveWithChildren',
    testId: 'tree-toolbar-right-smart',
    icon: 'id_dt_right_smart',
    labelKey: 'tree.toolbar.rightSmart',
  },
  {
    op: 'moveLeft',
    testId: 'tree-toolbar-left',
    icon: 'id_dt_left',
    labelKey: 'tree.toolbar.left',
  },
  {
    op: 'merge',
    testId: 'tree-toolbar-merge',
    icon: 'id_dt_merge',
    labelKey: 'tree.toolbar.merge',
  },
  {
    op: 'delete',
    testId: 'tree-toolbar-delete',
    icon: 'id_dt_delete',
    labelKey: 'tree.toolbar.delete',
  },
];

export function treeIconUrl(name: string): string {
  return `${import.meta.env.BASE_URL}icons/tree/${name}.png`;
}
