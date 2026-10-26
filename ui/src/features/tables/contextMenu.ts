/**
 * The table section of the Body context menu and of the Description fields' menu (feature 006,
 * FR-040, FR-043, FR-044; decision 2; C28, C29; U12; data-model §9.3): the right-click rule and
 * the section's items on a `TableEditTarget` - the Body adapter in the `prepare` and `table`
 * slots of `contextMenuExtensions`, a rich field's adapter in `FieldContextMenu` (US10).
 *
 * - `prepare` applies the right-click rule (C28) before the menu renders: a click in a cell
 *   that does not hold the selection - not a cell of the block, not the cell of the caret or
 *   of a text selection - first puts a caret at the clicked position in that cell (a selection
 *   change, no undo step); a click inside the block keeps the block (the table plugin keeps
 *   the native selection where it is); a click anywhere else leaves the selection as it is.
 * - `table` builds the section, which holds no direct command entry (decision 2) and no
 *   accelerators (U12): *Table…* (`insert.table`), always present - shown unavailable, not
 *   hidden (FR-043) - and judged at the clicked point (US1, FR-040, C28): at the caret a click
 *   there would make, or at the selection's end when the click lies inside a non-empty
 *   selection (which is kept, the spec's edge case); opening the menu moves nothing, running
 *   the entry first puts that caret (a selection change, no undo step) and then runs
 *   `insert.table`. For a click in a table it adds *Table structure ▸* with the entries of
 *   `TABLE_STRUCTURE_ITEMS`, each running its command on the clicked table, which `prepare`
 *   made the caret's.
 */

import { TextSelection, type EditorState } from 'prosemirror-state';

import {
  commandLabel,
  unavailableTitle,
  type CommandContext,
  type CommandRegistry,
} from '@/app/commands';
import { TABLE_STRUCTURE_ITEMS, type MenuItemSpec } from '@/app/menus';
import { findTablePoint } from '@/editor/commands/tableInsertion';
import { CellBlockSelection, cellRefAround } from '@/editor/table/selection';
import { isRunLocked } from '@/model/store';
import type {
  ContextMenuClick,
  ContextMenuEntry,
  ContextMenuItem,
} from '@/views/body/contextMenuExtensions';

import { reasonText } from './reasons';
import type { TableEditTarget } from './target';

/**
 * The right-click rule (C28) on `target`: a click in a cell that does not hold the selection puts
 * a caret at the clicked position (a selection change through `target.setSelection`, no undo
 * step); a click inside the block keeps it; a click elsewhere moves nothing.
 */
export function prepareTableClick(target: TableEditTarget, click: ContextMenuClick): void {
  const state = target.state;
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
  target.setSelection(state.tr.setSelection(TextSelection.create(state.doc, click.pos)));
}

/** True when the clicked position lies in a table. */
function inTable(state: EditorState | null, click: ContextMenuClick): boolean {
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

/**
 * Where *Table…* is judged for `click` (C28): the caret `TextSelection.near` makes at the
 * clicked position, which the entry moves to when it runs; or, for a click inside a non-empty
 * selection (a block of cells included) or without a position, the selection's end, the
 * selection kept (`moveTo` null).
 */
function tableClickPoint(
  state: EditorState,
  click: ContextMenuClick,
): { at: number; moveTo: number | null } {
  const { selection } = state;
  const pos = click.pos;
  const outside = pos === null || pos < 0 || pos > state.doc.content.size;
  const inSelection =
    selection instanceof CellBlockSelection ||
    (!selection.empty && pos !== null && pos >= selection.from && pos <= selection.to);
  if (outside || inSelection) return { at: selection.to, moveTo: null };
  const caret = TextSelection.near(state.doc.resolve(pos));
  return { at: caret.to, moveTo: caret.head };
}

/**
 * *Table…*: enabled exactly where FR-004 finds a point at the clicked place and the target is
 * editable; otherwise disabled with the reason - the run lock's, `noTarget`'s or
 * `noTablePlace`'s - as `title` (and, through `PopupMenu`, `aria-description`).
 */
function insertTableEntry(
  registry: CommandRegistry,
  target: TableEditTarget,
  click: ContextMenuClick,
  ctx: CommandContext,
): ContextMenuEntry {
  const spec = registry.get('insert.table');
  const state = target.state;
  let enabled = false;
  let reason: string | null = null;
  let moveTo: number | null = null;
  if (spec && !spec.stub) {
    if (isRunLocked(ctx.store.getState()) && spec.duringScriptRun !== 'allowed') {
      reason = registry.unavailableReason('insert.table', ctx);
    } else if (!target.editable || !state) {
      reason = reasonText('noTarget', { command: 'insert.table' }, ctx.t);
    } else {
      const point = tableClickPoint(state, click);
      moveTo = point.moveTo;
      enabled = findTablePoint(state.doc, point.at) !== null;
      if (!enabled) reason = reasonText('noTablePlace', undefined, ctx.t);
    }
  }
  return {
    id: 'insert.table',
    label: ctx.t('tables.contextMenu.table'),
    enabled,
    title: spec && reason ? unavailableTitle(spec, reason, ctx.t) : undefined,
    run: () => {
      const current = target.state;
      if (current && moveTo !== null && moveTo <= current.doc.content.size) {
        target.setSelection(
          current.tr.setSelection(TextSelection.near(current.doc.resolve(moveTo))),
        );
      }
      void registry.execute('insert.table', ctx);
    },
  };
}

/**
 * The table section on `target`: *Table…* always, *Table structure ▸* for a click in a table;
 * the entries run their commands on the active target, which the menu's opener made `target`.
 */
export function tableSectionItems(
  registry: CommandRegistry,
  target: TableEditTarget,
  click: ContextMenuClick,
  ctx: CommandContext,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [insertTableEntry(registry, target, click, ctx)];
  if (inTable(target.state, click)) {
    items.push({
      id: 'tableStructure',
      label: ctx.t('tables.contextMenu.structure'),
      items: structureItems(registry, ctx),
      run: () => {},
    });
  }
  return items;
}
