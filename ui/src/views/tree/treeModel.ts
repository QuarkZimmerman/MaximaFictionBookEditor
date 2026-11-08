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
 *
 * Feature 011 (US2; D33-D39, FR-010-FR-016; contracts/tree.md): the rows follow the original's
 * table of element kinds (`elementKinds.ts`): every element of a shown kind has a row under the row
 * of the nearest element above it that has one, a hidden kind passes its contents' rows (and the
 * summaries of its irregular tables) up; tables hold their cells' rows, poems their stanzas; titles,
 * epigraphs and cites start hidden; the pictures of special characters (`#ch-…`) have no rows.
 */

import type { ModelNodeJson } from '@/editor/fromModel';
import { FIXED_BLOCK_IDS, type BlockKind } from '@/editor/schema';
import { gridOfModel, type TableSummary } from '@/editor/table/grid';
import { descriptionBlockOf, locateNode } from '@/features/treeOps';
import type { Document, TableNode } from '@/model/document';

import {
  DEFAULT_SHOWN_ENTRIES,
  ELEMENT_ROW_KINDS,
  kindShown,
  ROW_KIND_INFO,
  shownSignature,
  type ElementEntryId,
  type TreeRowKind,
} from './elementKinds';

export type { TreeRowKind } from './elementKinds';

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

/** The model element types that can make rows (`elementKinds.ts`). */
export const ROW_KINDS: ReadonlySet<string> = ELEMENT_ROW_KINDS;

/** Image file of the original `struct.bmp` image list for each row kind (`ElementDescMnr.cpp`). */
export const ROW_ICONS: Readonly<Record<TreeRowKind, string>> = Object.fromEntries(
  Object.entries(ROW_KIND_INFO).map(([kind, info]) => [kind, info.icon]),
) as Record<TreeRowKind, string>;

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
  /** Feature 010 (D8): a picture without an image (`#undefined`); the tree says "Empty picture". */
  emptyPicture?: boolean;
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
    case 'stanza':
      // Feature 011 (D36): a stanza without a title says <stanza>, as a section says <section>.
      return titleText(node);
    case 'poem':
      return titleText(node) || firstText(node);
    case 'image':
    case 'inline-image': {
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
  signature: string;
  /** The rows of the element and of everything below it, in document order. */
  rows: TreeRow[];
  /** The ids of the rows directly under the parent (the element's own row, or its contents'). */
  topIds: string[];
  /** Summaries of irregular tables without rows of their own, passed up to the parent's row. */
  passedTables: TableSummary[];
  sectionCount: number;
}

/** Rows of a body's top-level element, keyed by the immutable node object. */
const subtreeCache = new WeakMap<object, SubtreeRows>();

/** A picture the Markdown import made of a special character (feature 010, D37): no row (D38). */
function isCharacterPicture(node: ModelNodeJson): boolean {
  const href = node.attrs?.href;
  return typeof href === 'string' && href.startsWith('#ch-');
}

/** The row kind of a model element, or null for elements that never make a row. */
function rowKindOf(node: ModelNodeJson): TreeRowKind | null {
  if (!ELEMENT_ROW_KINDS.has(node.type) || nodeIdOf(node) === null) return null;
  if (node.type === 'inline-image' && isCharacterPicture(node)) return null;
  return node.type as TreeRowKind;
}

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

function newRow(
  node: ModelNodeJson,
  kind: TreeRowKind,
  id: string,
  depth: number,
  parentId: string | null,
): TreeRow {
  const row: TreeRow = { id, kind, caption: captionFor(node, kind), depth, parentId, childIds: [] };
  if (kind === 'image' || kind === 'inline-image') {
    const href = node.attrs?.href;
    if (
      href === undefined ||
      href === null ||
      href === '' ||
      href === '#' ||
      href === '#undefined'
    ) {
      row.emptyPicture = true;
    }
  }
  if (kind === 'table') {
    const summary = irregularSummary(node);
    if (summary) row.tableProblems = summary;
  }
  return row;
}

interface Walk {
  shown: ReadonlySet<ElementEntryId>;
  rows: TreeRow[];
  sections: number;
}

/**
 * Rows of `node` and below: its own row when its kind is shown (then its contents' rows below it
 * when the kind holds rows), otherwise its contents' rows in its place. Returns the ids of the rows
 * that stand directly under `parentId`, and the irregular tables that have no row of their own.
 */
function collectRows(
  node: ModelNodeJson,
  depth: number,
  parentId: string | null,
  walk: Walk,
): { topIds: string[]; passedTables: TableSummary[] } {
  if (node.type === 'text' || node.type === 'raw-xml' || node.type === 'raw-xml-inline') {
    return { topIds: [], passedTables: [] };
  }
  const kind = rowKindOf(node);
  if (kind && kindShown(kind, walk.shown)) {
    const id = nodeIdOf(node)!;
    const row = newRow(node, kind, id, depth, parentId);
    walk.rows.push(row);
    if (kind === 'section') walk.sections += 1;
    if (ROW_KIND_INFO[kind].holdsRows) {
      const contained: TableSummary[] = [];
      for (const child of node.content ?? []) {
        const inner = collectRows(child, depth + 1, id, walk);
        row.childIds.push(...inner.topIds);
        contained.push(...inner.passedTables);
      }
      if (contained.length > 0) row.containedTables = contained;
    } else if (kind !== 'table') {
      // A leaf row (title, subtitle, picture, cell) stands for what it holds.
      const contained = irregularTablesIn(node);
      if (contained.length > 0) row.containedTables = contained;
    }
    return { topIds: [id], passedTables: [] };
  }
  // A hidden kind, or an element without a row: its contents' rows stand in its place.
  const topIds: string[] = [];
  const passedTables: TableSummary[] = [];
  if (node.type === 'table') {
    const summary = irregularSummary(node);
    if (summary) passedTables.push(summary);
  }
  for (const child of node.content ?? []) {
    const inner = collectRows(child, depth, parentId, walk);
    topIds.push(...inner.topIds);
    passedTables.push(...inner.passedTables);
  }
  return { topIds, passedTables };
}

function subtreeRows(
  node: ModelNodeJson,
  depth: number,
  parentId: string | null,
  shown: ReadonlySet<ElementEntryId>,
  signature: string,
): SubtreeRows {
  const cached = subtreeCache.get(node);
  if (
    cached &&
    cached.depth === depth &&
    cached.parentId === parentId &&
    cached.signature === signature
  ) {
    return cached;
  }
  const walk: Walk = { shown, rows: [], sections: 0 };
  const { topIds, passedTables } = collectRows(node, depth, parentId, walk);
  const built: SubtreeRows = {
    depth,
    parentId,
    signature,
    rows: walk.rows,
    topIds,
    passedTables,
    sectionCount: walk.sections,
  };
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

/** The block row of `kind` (the caption is the tree node's text). */
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
 * Builds the tree index of a document: the Annotation and History rows, then the bodies and
 * what they hold, as the *Elements* choices `shown` say (the original's defaults when omitted).
 * `captions` are the texts of the two block rows in the interface language.
 */
export function buildTreeIndex(
  document: (Pick<Document, 'bodies'> & Partial<Pick<Document, 'description'>>) | null,
  captions: BlockCaptions,
  shown: ReadonlySet<ElementEntryId> = DEFAULT_SHOWN_ENTRIES,
): TreeIndex {
  if (!document) return EMPTY_TREE_INDEX;
  const signature = shownSignature(shown);
  const rows = new Map<string, TreeRow>();
  const roots: string[] = [];
  const order: string[] = [];
  let sectionCount = 0;
  const add = (row: TreeRow) => {
    rows.set(row.id, row);
    order.push(row.id);
  };
  for (const kind of ['annotation', 'history'] as const) {
    if (!kindShown(kind === 'annotation' ? 'annotationBlock' : 'historyBlock', shown)) continue;
    const row = blockRow(kind, captions, document.description);
    roots.push(row.id);
    add(row);
  }
  for (const body of document.bodies) {
    const json = body as unknown as ModelNodeJson;
    const bodyId = nodeIdOf(json);
    if (!bodyId) continue;
    const bodyShown = kindShown('body', shown);
    let bodyRow: TreeRow | null = null;
    if (bodyShown) {
      bodyRow = newRow(json, 'body', bodyId, 0, null);
      roots.push(bodyId);
      add(bodyRow);
    }
    const contained: TableSummary[] = [];
    for (const child of json.content ?? []) {
      // The body's top-level elements are cached per object: an edit rebuilds one of them.
      const subtree = subtreeRows(
        child,
        bodyRow ? 1 : 0,
        bodyRow ? bodyId : null,
        shown,
        signature,
      );
      if (bodyRow) bodyRow.childIds.push(...subtree.topIds);
      else roots.push(...subtree.topIds);
      for (const row of subtree.rows) add(row);
      contained.push(...subtree.passedTables);
      sectionCount += subtree.sectionCount;
    }
    if (bodyRow && contained.length > 0) bodyRow.containedTables = contained;
  }
  return { rows, roots, order, sectionCount };
}

/* ------------------------------------------------------------------------ */
/* Navigation helpers                                                       */
/* ------------------------------------------------------------------------ */

/** Row ids from the root body down to (excluding) `id`. */
/**
 * The rows above `id`, the outermost first. The walk stops at a row it has seen and after as many
 * steps as there are rows, so repeated element names or a parent cycle can never make it endless
 * (feature 008, FR-022: the 0.0.5 freeze was such a walk).
 */
export function ancestorRows(index: TreeIndex, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let current = index.rows.get(id)?.parentId ?? null;
  while (current && !seen.has(current) && out.length < index.rows.size) {
    seen.add(current);
    out.unshift(current);
    current = index.rows.get(current)?.parentId ?? null;
  }
  return out;
}

/** Whether `ancestorId` is `id` or one of its ancestors; bounded like `ancestorRows`. */
export function isRowWithin(index: TreeIndex, id: string, ancestorId: string): boolean {
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current) && seen.size <= index.rows.size) {
    if (current === ancestorId) return true;
    seen.add(current);
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
  op: 'moveUp' | 'moveDown' | 'moveRight' | 'moveWithChildren' | 'moveLeft' | 'merge' | 'delete';
  testId: string;
  icon: string;
  labelKey: string;
}[] = [
  // Feature 010 (D21): Move Up and Move Down first.
  { op: 'moveUp', testId: 'tree-toolbar-up', icon: 'id_dt_up', labelKey: 'tree.toolbar.up' },
  {
    op: 'moveDown',
    testId: 'tree-toolbar-down',
    icon: 'id_dt_down',
    labelKey: 'tree.toolbar.down',
  },
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
