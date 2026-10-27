/**
 * The popover of an irregular table's warning mark (feature 006, US8; FR-057's click, FR-034,
 * FR-045, FR-048; US8 sc.9; I16, I17; data-model §3.5, §6.5; research R6.4): a small modeless
 * dialog below the mark, as the assistant's Ask popup is placed (`ui/src/ai/AskPopup.tsx`),
 * listing the table's problems with *Repair table* and *Close*.
 *
 * - The title is "Irregular table" (`dialog.tableMark.title`), or, for a table with an id, the
 *   mark's name in Validate's named variant (C61).
 * - *Repair table* repairs the mark's own table - found by its node id, whatever table holds the
 *   caret - as one undo step (`planCommandAt` with `planRepair`). It is disabled while a script or
 *   an assistant request holds the run lock, and on a table too large to edit, with the reason as
 *   its title; the initial focus is then on *Close*, since a disabled button takes none.
 * - The popover closes on Escape, on a mousedown outside it, and - checked on every change of the
 *   store or of the target - when its table no longer exists or has become regular.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import type { CommandContext } from '@/app/commands';
import { Dialog, type DialogButton } from '@/dialogs';
import { findNodeById } from '@/editor/schema';
import { planCommandAt } from '@/editor/table/commands';
import { gridOfNode } from '@/editor/table/grid';
import { checkRepair, planRepair } from '@/editor/table/ops';
import { isRunLocked, type AppStore } from '@/model/store';

import { describeTableMark } from './marks';
import { reasonText } from './reasons';
import type { TableEditTarget } from './target';

/** Where the mark was clicked: its table's node id and the mark's rectangle. */
export interface MarkActivation {
  tableNodeId: string;
  anchor: { left: number; bottom: number };
}

/** The table with that node id in the target's document, with its position; null when gone. */
function findTable(target: TableEditTarget, tableNodeId: string) {
  const state = target.state;
  if (!state || !tableNodeId) return null;
  const found = findNodeById(state.doc, tableNodeId);
  return found && found.node.type.name === 'table' ? found : null;
}

/** A counter bumped on every change of the store or of the target (its selection, its document). */
function useRevision(store: AppStore, target: TableEditTarget): number {
  const revision = useRef(0);
  const subscribe = useCallback(
    (listener: () => void) => {
      const bump = () => {
        revision.current += 1;
        listener();
      };
      const offStore = store.subscribe(bump);
      const offTarget = target.subscribe(bump);
      return () => {
        offStore();
        offTarget();
      };
    },
    [store, target],
  );
  const snapshot = useCallback(() => revision.current, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

interface TableMarkPopoverProps {
  ctx: CommandContext;
  target: TableEditTarget;
  tableNodeId: string;
  anchor: MarkActivation['anchor'];
  onClose: () => void;
}

// eslint-disable-next-line react-refresh/only-export-components -- the opener lives with its popover
function TableMarkPopover({ ctx, target, tableNodeId, anchor, onClose }: TableMarkPopoverProps) {
  const { t, store } = ctx;
  useRevision(store, target);
  const rootRef = useRef<HTMLDivElement>(null);
  const found = findTable(target, tableNodeId);
  const grid = found ? gridOfNode(found.node) : null;
  const gone = !found || !grid || grid.regular;

  // The table repaired, changed into a regular one or removed: nothing left to show.
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);

  // A mousedown outside the popover closes it (capture phase, as the Ask popup does).
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const root = rootRef.current?.closest('.mfbe-dialog');
      if (!root || root.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [onClose]);

  if (gone) return null;
  const texts = describeTableMark(grid.summary, t);
  const state = store.getState();
  const refusal = checkRepair({ table: found.node, grid });
  const reason =
    isRunLocked(state) && state.runLock
      ? t(`commands.unavailable.runLock.${state.runLock.kind}`)
      : refusal
        ? reasonText(refusal, t)
        : null;

  const repair = () => {
    const now = findTable(target, tableNodeId);
    if (!now || isRunLocked(store.getState())) return;
    target.run(planCommandAt(now.pos, planRepair, { nextId: () => target.nextNodeId() }));
    onClose();
  };

  const buttons: DialogButton[] = [
    {
      id: 'repair',
      label: t('dialog.tableMark.repair'),
      onClick: repair,
      disabled: reason !== null,
      ...(reason !== null ? { title: reason } : {}),
    },
    { id: 'close', label: t('dialog.buttons.close'), onClick: onClose },
  ];

  return (
    <Dialog
      title={grid.summary.id ? texts.name : t('dialog.tableMark.title')}
      buttons={buttons}
      defaultButtonId="repair"
      cancelButtonId="close"
      {...(reason !== null ? { initialFocus: '[data-button-id="close"]' } : {})}
      testId="dialog-table-mark"
      className="mfbe-table-mark-popover"
      closeLabel={t('dialog.buttons.close')}
      modeless
      position={{ left: anchor.left - 8, top: anchor.bottom + 4 }}
    >
      <div ref={rootRef} className="mfbe-table-mark-popover-body">
        <ul className="mfbe-table-mark-problems" data-testid="dialog-table-mark-problems">
          {texts.parts.map((part, index) => (
            <li key={`${index}-${part}`}>{part}</li>
          ))}
        </ul>
        <p className="mfbe-table-mark-hint">{t('dialog.tableMark.hint')}</p>
      </div>
    </Dialog>
  );
}

/** The close function of the popover on the screen: one at a time. */
let closeCurrent: (() => void) | null = null;

/**
 * Opens the popover of the mark of the table `tableNodeId` of `target` below `anchor`, closing
 * one already open; resolves when it closes.
 */
export async function openTableMarkPopover(
  ctx: CommandContext,
  target: TableEditTarget,
  info: MarkActivation,
): Promise<void> {
  closeCurrent?.();
  let mine: (() => void) | null = null;
  await ctx.dialogs.openCustom<void>(
    (close) => {
      mine ??= () => close();
      closeCurrent = mine;
      return (
        <TableMarkPopover
          ctx={ctx}
          target={target}
          tableNodeId={info.tableNodeId}
          anchor={info.anchor}
          onClose={() => close()}
        />
      );
    },
    { modeless: true },
  );
  if (closeCurrent === mine) closeCurrent = null;
}
