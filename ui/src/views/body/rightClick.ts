/**
 * Feature 010, US5 (spec D16, research DP-14): the Body view's right-click rule. A right-click in
 * the text outside the selection first moves the caret to the clicked point, so that every entry of
 * the menu acts on what was clicked - *Select paragraph* selects the clicked paragraph; a click on a
 * picture selects the picture; a right-click inside the selection keeps it. Table cells keep
 * feature 006's rule (the tables feature's `prepare`, which runs first).
 */

import { NodeSelection, TextSelection } from 'prosemirror-state';

import type { BodyEditorController } from './bodyEditor';
import type { ContextMenuClick } from './contextMenuExtensions';

export function applyRightClick(controller: BodyEditorController, click: ContextMenuClick): void {
  const state = controller.editorState;
  if (!state || click.pos === null || click.pos < 0 || click.pos > state.doc.content.size) return;
  const $click = state.doc.resolve(click.pos);
  for (let depth = $click.depth; depth >= 1; depth -= 1) {
    if ($click.node(depth).type.name === 'table') return; // the tables feature's rule
  }
  const { selection } = state;
  const inside = click.inside ?? null;
  const picture = inside !== null ? state.doc.nodeAt(inside) : null;
  if (picture && picture.isAtom && NodeSelection.isSelectable(picture)) {
    if (!(selection instanceof NodeSelection && selection.from === inside)) {
      controller.apply(state.tr.setSelection(NodeSelection.create(state.doc, inside!)));
    }
    return;
  }
  if (!selection.empty && click.pos >= selection.from && click.pos <= selection.to) return;
  const target = TextSelection.near($click);
  if (selection.empty && target.head === selection.head) return;
  controller.apply(state.tr.setSelection(target));
}
