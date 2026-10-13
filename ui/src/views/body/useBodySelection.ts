/**
 * React access to the Body controller's selection context (Links bar, Table bar).
 */

import { useSyncExternalStore } from 'react';

import { useAppServices } from '@/app/services';
import type { SelectionContext } from '@/editor/plugins/selectionPath';
import { useAppState } from '@/model/store';

import { getBodyController, hasBodyController, type BodyEditorController } from './bodyEditor';

const EMPTY: SelectionContext | null = null;

/** The Body controller's selection context (null without a controller / document). */
export function useBodySelectionContext(): {
  controller: BodyEditorController | null;
  context: SelectionContext | null;
} {
  const { store } = useAppServices();
  const hasDocument = useAppState((s) => s.document !== null, store);
  const controller = hasBodyController(store) ? getBodyController(store) : null;
  const context = useSyncExternalStore(
    controller?.subscribeContext ?? (() => () => {}),
    () => (controller && hasDocument ? controller.getContext() : EMPTY),
    () => EMPTY,
  );
  return { controller, context };
}
