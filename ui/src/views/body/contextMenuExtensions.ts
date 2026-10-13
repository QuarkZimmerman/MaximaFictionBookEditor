/**
 * Context menu model (T067): entry types, the extension slots other stories fill (`spelling`
 * for suggestions / Add to dictionary, `image` for "Save image as..."), and the "Select
 * <element>" entries for the ancestors of the caret.
 */

import { NodeSelection, TextSelection } from 'prosemirror-state';

import { fb2NameFor } from '@/editor/schema';

import type { BodyEditorController } from './bodyEditor';

export interface ContextMenuEntry {
  id: string;
  label: string;
  enabled?: boolean;
  run: () => void;
}

export type ContextMenuSeparator = { separator: true; id: string };
export type ContextMenuItem = ContextMenuEntry | ContextMenuSeparator;

/** Extension points: other features add entries for the current selection. */
export interface ContextMenuExtensions {
  spelling?: (controller: BodyEditorController) => ContextMenuItem[];
  image?: (controller: BodyEditorController) => ContextMenuItem[];
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
    const name = fb2NameFor(node.type);
    entries.push({
      id: `select-${depth}`,
      label: label(name),
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
