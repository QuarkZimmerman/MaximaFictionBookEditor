/**
 * The table section of the Body context menu (feature 006, FR-040, FR-043; decision 2; C28,
 * C29; U12; data-model §9.3): the `prepare` and `table` slots of `contextMenuExtensions`.
 *
 * - `prepare` applies the right-click rule (C28) before the menu renders: a click in a cell
 *   that does not hold the selection - not a cell of the block, not the cell of the caret or
 *   of a text selection - first puts a caret at the clicked position in that cell (a selection
 *   change, no undo step); a click inside the block keeps the block (the table plugin keeps
 *   the native selection where it is); a click anywhere else leaves the selection as it is.
 * - `table` builds the section, which holds no direct command entry (decision 2) and no
 *   accelerators (U12): *Table…* (`insert.table`), always present - shown unavailable, not
 *   hidden (FR-043); until US1 it mirrors the registry state of today's `insert.table` at the
 *   caret and runs it, US1 evaluates it at the clicked point -, and, for a click in a table,
 *   *Table structure ▸* with the entries of `TABLE_STRUCTURE_ITEMS`, each running its command
 *   on the clicked table, which `prepare` made the caret's.
 */

import { TextSelection } from 'prosemirror-state';

import {
  commandLabel,
  unavailableTitle,
  type CommandContext,
  type CommandRegistry,
} from '@/app/commands';
import { TABLE_STRUCTURE_ITEMS, type MenuItemSpec } from '@/app/menus';
import { CellBlockSelection, cellRefAround } from '@/editor/table/selection';
import type { BodyEditorController } from '@/views/body/bodyEditor';
import type {
  ContextMenuClick,
  ContextMenuEntry,
  ContextMenuItem,
} from '@/views/body/contextMenuExtensions';

/** The right-click rule (C28): a caret in a clicked cell that does not hold the selection. */
export function prepareTableContextMenu(
  controller: BodyEditorController,
  click: ContextMenuClick,
): void {
  const state = controller.editorState;
  if (!state || click.pos === null || click.pos < 0 || click.pos > state.doc.content.size) return;
  const $click = state.doc.resolve(click.pos);
  const clicked = cellRefAround($click);
  if (!clicked) return;
  const { selection } = state;
  if (selection instanceof CellBlockSelection) {
    if (selection.cellPositions().includes(clicked.cellPos)) return;
  } else {
    const holders = [cellRefAround(selection.$anchor), cellRefAround(selection.$head)];
    if (holders.some((cell) => cell?.cellPos === clicked.cellPos)) return;
  }
  controller.apply(state.tr.setSelection(TextSelection.create(state.doc, click.pos)));
}

/** True when the clicked position lies in a table. */
function inTable(controller: BodyEditorController, click: ContextMenuClick): boolean {
  const state = controller.editorState;
  if (!state || click.pos === null || click.pos < 0 || click.pos > state.doc.content.size) {
    return false;
  }
  const $click = state.doc.resolve(click.pos);
  for (let depth = $click.depth; depth >= 1; depth -= 1) {
    if ($click.node(depth).type.name === 'table') return true;
  }
  // Right before a table node (its border): the node after the position.
  return $click.nodeAfter?.type.name === 'table';
}

/** An entry running a registry command, its state and reason from the registry. */
function commandEntry(
  registry: CommandRegistry,
  ctx: CommandContext,
  commandId: string,
  entryId: string,
  label: string,
): ContextMenuEntry {
  const spec = registry.get(commandId);
  const enabled = registry.isEnabled(commandId, ctx);
  const reason = enabled ? null : registry.unavailableReason(commandId, ctx);
  return {
    id: entryId,
    label,
    enabled,
    title: spec && reason ? unavailableTitle(spec, reason, ctx.t) : undefined,
    run: () => void registry.execute(commandId, ctx),
  };
}

/** The *Table structure* entries: `<name>` ids (the command id after its first dot), no `&`. */
function structureItems(registry: CommandRegistry, ctx: CommandContext): ContextMenuItem[] {
  return TABLE_STRUCTURE_ITEMS.map((item: MenuItemSpec, index): ContextMenuItem => {
    if (item.kind !== 'command') return { separator: true, id: `sep-structure-${index}` };
    const spec = registry.get(item.commandId);
    const name = item.commandId.slice(item.commandId.indexOf('.') + 1);
    const label = spec ? commandLabel(spec, ctx.t) : name;
    return commandEntry(registry, ctx, item.commandId, name, label);
  });
}

/** The table section: *Table…* always, *Table structure ▸* for a click in a table. */
export function tableContextMenuItems(
  registry: CommandRegistry,
  controller: BodyEditorController,
  click: ContextMenuClick,
  ctx: CommandContext,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    commandEntry(registry, ctx, 'insert.table', 'insert.table', ctx.t('tables.contextMenu.table')),
  ];
  if (inTable(controller, click)) {
    items.push({
      id: 'tableStructure',
      label: ctx.t('tables.contextMenu.structure'),
      items: structureItems(registry, ctx),
      run: () => {},
    });
  }
  return items;
}
