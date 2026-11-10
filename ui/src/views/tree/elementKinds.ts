/**
 * Feature 011 (US2; D33-D39, FR-010-FR-016; contracts/tree.md §2): the one table of the Document
 * tree's element kinds - which rows exist and where, their icons, whether they hold rows and start
 * closed, and the entries of the tree bar's *Elements* menu with the original's starting choices
 * (FictionBook Editor 2.7: titles, epigraphs and cites unticked). The rows (`treeModel.ts`), the
 * menu (`TreeMenuBar.tsx`), the icons and the open/closed start all read this table.
 */

/** A row kind: the model's element type, or one of the two description blocks (feature 004). */
export type TreeRowKind =
  | 'annotationBlock'
  | 'historyBlock'
  | 'body'
  | 'section'
  | 'title'
  | 'epigraph'
  | 'annotation'
  | 'image'
  | 'inline-image'
  | 'poem'
  | 'stanza'
  | 'cite'
  | 'subtitle'
  | 'table'
  | 'th'
  | 'td'
  // Feature 011 (US11, D41): a row a tree script shows (contracts/script-api.md); never an element.
  | 'script';

/** An entry of the *Elements* menu (its id is the key of the `view.treeElements` setting). */
export type ElementEntryId =
  | 'section'
  | 'body'
  | 'picture'
  | 'annotation'
  | 'history'
  | 'poem'
  | 'stanza'
  | 'title'
  | 'epigraph'
  | 'quote'
  | 'subtitle'
  | 'table'
  | 'headerCell'
  | 'cell';

export interface ElementEntry {
  id: ElementEntryId;
  /** The FB2 element(s) it stands for, named in the entry's tooltip. */
  fb2: string;
  /** Ticked when the user has not chosen (the original's starting choice). */
  shownByDefault: boolean;
}

/** The *Elements* menu in the original's order, without its tr, Stylesheet and Style (D34). */
export const ELEMENT_ENTRIES: readonly ElementEntry[] = [
  { id: 'section', fb2: 'section', shownByDefault: true },
  { id: 'body', fb2: 'body', shownByDefault: true },
  { id: 'picture', fb2: 'image', shownByDefault: true },
  { id: 'annotation', fb2: 'annotation', shownByDefault: true },
  { id: 'history', fb2: 'history', shownByDefault: true },
  { id: 'poem', fb2: 'poem', shownByDefault: true },
  { id: 'stanza', fb2: 'stanza', shownByDefault: true },
  { id: 'title', fb2: 'title', shownByDefault: false },
  { id: 'epigraph', fb2: 'epigraph', shownByDefault: false },
  { id: 'quote', fb2: 'cite', shownByDefault: false },
  { id: 'subtitle', fb2: 'subtitle', shownByDefault: true },
  { id: 'table', fb2: 'table', shownByDefault: true },
  { id: 'headerCell', fb2: 'th', shownByDefault: true },
  { id: 'cell', fb2: 'td', shownByDefault: true },
];

export interface RowKindInfo {
  /** The *Elements* entry that shows or hides the kind; null for script rows, always shown. */
  entry: ElementEntryId | null;
  /** Image of the original's `struct.bmp` list (ui/public/icons/tree/<icon>.png). */
  icon: string;
  /** Whether rows of the kind hold rows of what they contain. */
  holdsRows: boolean;
  /** Whether such a row starts closed (FR-013a: holders of stanzas, cells and block contents). */
  startsClosed: boolean;
}

export const ROW_KIND_INFO: Readonly<Record<TreeRowKind, RowKindInfo>> = {
  // The book's annotation and history hold the rows of what they contain, closed at first.
  annotationBlock: { entry: 'annotation', icon: 'struct-12', holdsRows: true, startsClosed: true },
  historyBlock: { entry: 'history', icon: 'struct-15', holdsRows: true, startsClosed: true },
  body: { entry: 'body', icon: 'struct-00', holdsRows: true, startsClosed: false },
  section: { entry: 'section', icon: 'struct-00', holdsRows: true, startsClosed: false },
  title: { entry: 'title', icon: 'struct-27', holdsRows: false, startsClosed: false },
  epigraph: { entry: 'epigraph', icon: 'struct-18', holdsRows: true, startsClosed: true },
  annotation: { entry: 'annotation', icon: 'struct-12', holdsRows: true, startsClosed: true },
  image: { entry: 'picture', icon: 'struct-21', holdsRows: false, startsClosed: false },
  'inline-image': { entry: 'picture', icon: 'struct-21', holdsRows: false, startsClosed: false },
  poem: { entry: 'poem', icon: 'struct-03', holdsRows: true, startsClosed: true },
  stanza: { entry: 'stanza', icon: 'struct-03', holdsRows: true, startsClosed: true },
  cite: { entry: 'quote', icon: 'struct-09', holdsRows: true, startsClosed: true },
  subtitle: { entry: 'subtitle', icon: 'struct-06', holdsRows: false, startsClosed: false },
  table: { entry: 'table', icon: 'struct-30', holdsRows: true, startsClosed: true },
  // D37: a picture inside a cell has its row under its cell's.
  th: { entry: 'headerCell', icon: 'struct-27', holdsRows: true, startsClosed: false },
  td: { entry: 'cell', icon: 'struct-27', holdsRows: true, startsClosed: false },
  // The script's own icon when it has one (`TreeRow.iconUrl`), else the subtitle's stars.
  script: { entry: null, icon: 'struct-06', holdsRows: false, startsClosed: false },
};

/** The model element types that make rows (the two blocks are added by the index itself). */
export const ELEMENT_ROW_KINDS: ReadonlySet<string> = new Set<TreeRowKind>([
  'body',
  'section',
  'title',
  'epigraph',
  'annotation',
  'image',
  'inline-image',
  'poem',
  'stanza',
  'cite',
  'subtitle',
  'table',
  'th',
  'td',
]);

/** The entries shown: the user's choices over the original's defaults; unknown keys ignored. */
export function shownEntries(
  choices: Readonly<Record<string, boolean>> | undefined,
): ReadonlySet<ElementEntryId> {
  const shown = new Set<ElementEntryId>();
  for (const entry of ELEMENT_ENTRIES) {
    const chosen = choices?.[entry.id];
    if (typeof chosen === 'boolean' ? chosen : entry.shownByDefault) shown.add(entry.id);
  }
  return shown;
}

/** The entries shown when the user never chose (the original's starting choices). */
export const DEFAULT_SHOWN_ENTRIES: ReadonlySet<ElementEntryId> = shownEntries(undefined);

/** Whether rows of `kind` are shown under `shown`. */
export function kindShown(kind: TreeRowKind, shown: ReadonlySet<ElementEntryId>): boolean {
  const entry = ROW_KIND_INFO[kind].entry;
  return entry === null || shown.has(entry);
}

/** A stable key of a shown set (part of the row cache's key). */
export function shownSignature(shown: ReadonlySet<ElementEntryId>): string {
  return ELEMENT_ENTRIES.filter((entry) => shown.has(entry.id))
    .map((entry) => entry.id)
    .join(',');
}
