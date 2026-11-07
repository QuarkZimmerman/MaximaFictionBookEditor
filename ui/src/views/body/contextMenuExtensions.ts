/**
 * Context menu model (T067): entry types, the extension slots other stories fill (`spelling`
 * for suggestions / Add to dictionary, `image` for "Save image as...", `ai` for "Ask AI...",
 * and the tables feature's `prepare` and `table`), and the "Select <element>" entries for the
 * ancestors of the caret.
 */

import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { NodeSelection, TextSelection } from 'prosemirror-state';

import type { CommandContext } from '@/app/commands';
import { blockKindOf, fb2NameFor } from '@/editor/schema';

import type { BodyEditorController } from './bodyEditor';

export interface ContextMenuEntry {
  id: string;
  label: string;
  enabled?: boolean;
  /** Why the entry is unavailable (feature 006, FR-043): shown while it is disabled. */
  title?: string;
  /** The entries of the submenu the entry opens instead of running (one level, FR-040). */
  items?: ContextMenuItem[];
  run: () => void;
}

export type ContextMenuSeparator = { separator: true; id: string };
export type ContextMenuItem = ContextMenuEntry | ContextMenuSeparator;

/**
 * Where the menu was asked for (feature 006, data-model §9.3): the pointer in the viewport and
 * the document position under it (`posAtCoords`), null outside the editor's content.
 */
export interface ContextMenuClick {
  x: number;
  y: number;
  pos: number | null;
  /** Feature 010 (D16): the position of the leaf node the pointer is on (a picture), else null. */
  inside?: number | null;
}

/** Extension points: other features add entries for the current selection. */
export interface ContextMenuExtensions {
  spelling?: (controller: BodyEditorController) => ContextMenuItem[];
  image?: (controller: BodyEditorController) => ContextMenuItem[];
  /** "Ask AI..." (feature 005 FR-030): registered only while the assistant is on. */
  ai?: (controller: BodyEditorController) => ContextMenuItem[];
  /**
   * Runs before the menu renders (feature 006, C28): the tables feature's right-click rule,
   * which puts the caret into a clicked cell that does not hold the selection.
   */
  prepare?: (controller: BodyEditorController, click: ContextMenuClick) => void;
  /**
   * The table section after today's entries (feature 006, FR-040; decision 2): *Table…* and,
   * for a click in a table, *Table structure ▸*; `ctx` is the context the menu evaluates and
   * runs its command entries with.
   */
  table?: (
    controller: BodyEditorController,
    click: ContextMenuClick,
    ctx: CommandContext,
  ) => ContextMenuItem[];
}

export const contextMenuExtensions: ContextMenuExtensions = {};

/** Registers the entries another feature contributes (spelling suggestions, Save image as). */
export function registerContextMenuExtension<K extends keyof ContextMenuExtensions>(
  slot: K,
  provider: ContextMenuExtensions[K],
): () => void {
  contextMenuExtensions[slot] = provider;
  return () => {
    if (contextMenuExtensions[slot] === provider) delete contextMenuExtensions[slot];
  };
}

export function isSeparator(item: ContextMenuItem): item is ContextMenuSeparator {
  return 'separator' in item;
}

/** The click of a `contextmenu` event at (x, y) over the controller's editor. */
export function contextMenuClick(
  controller: BodyEditorController,
  x: number,
  y: number,
): ContextMenuClick {
  let pos: number | null = null;
  let inside: number | null = null;
  try {
    const found = controller.editorView?.posAtCoords({ left: x, top: y });
    pos = found?.pos ?? null;
    inside = found && found.inside >= 0 ? found.inside : null;
  } catch {
    // jsdom and a detached view measure nothing.
  }
  return { x, y, pos, inside };
}

/** Feature 010 (D15): the words the *Select …* entries name elements by (`editing.element.*`). */
const ELEMENT_KEYS: Readonly<Record<string, string>> = {
  p: 'paragraph',
  title: 'title',
  section: 'section',
  body: 'body',
  epigraph: 'epigraph',
  annotation: 'annotation',
  history: 'history',
  poem: 'poem',
  stanza: 'stanza',
  v: 'verse',
  cite: 'quote',
  'text-author': 'textAuthor',
  subtitle: 'subtitle',
  date: 'date',
  table: 'table',
  tr: 'row',
  td: 'cell',
  th: 'cell',
};

/** The key of an element's name: a notes body is "notes", an unknown element its FB2 name. */
export function elementKey(node: ProseMirrorNode): string {
  // The description's blocks in the Body view: the annotation and the History block.
  const block = blockKindOf(node.type.name);
  if (block) return block;
  const name = fb2NameFor(node.type);
  if (name === 'body' && node.attrs.name === 'notes') return 'notes';
  return ELEMENT_KEYS[name] ?? name;
}

/** "Select <element>" entries for every ancestor of the caret, innermost first. */
export function selectEntries(
  controller: BodyEditorController,
  label: (element: string) => string,
): ContextMenuEntry[] {
  const state = controller.editorState;
  if (!state) return [];
  const $head = state.selection.$head;
  const entries: ContextMenuEntry[] = [];
  for (let depth = $head.depth; depth >= 1; depth -= 1) {
    const node = $head.node(depth);
    const pos = $head.before(depth);
    entries.push({
      id: `select-${depth}`,
      label: label(elementKey(node)),
      run: () => {
        const current = controller.editorState;
        if (!current) return;
        const selection = NodeSelection.isSelectable(node)
          ? NodeSelection.create(current.doc, pos)
          : TextSelection.between(
              current.doc.resolve(pos + 1),
              current.doc.resolve(pos + node.nodeSize - 1),
              -1,
            );
        controller.apply(current.tr.setSelection(selection).scrollIntoView());
        controller.focus();
      },
    });
  }
  return entries;
}
