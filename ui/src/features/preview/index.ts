/**
 * Feature 011 (US10; D44; FR-020i; PD1): the command *View → Preview* (Shift+F5; F5 stays Fast
 * mode), on the toolbar and as a small button of the status bar. Preview opens at the caret's
 * element in the Body view, at the selected element in the Source view, else at the book's start.
 */
import type { Command } from '@/app/commands';
import { isModalJobRunning } from '@/app/modalJob';
import type { FeatureContext } from '@/app/services';
import { cmdKeys } from '@/features/editing/common';
import { getTreeFeature } from '@/features/tree';

import { openPreview } from './previewState';

export const PREVIEW_COMMAND = 'view.preview';
export const PREVIEW_ICON = 'preview';

export function registerPreviewFeature(ctx: FeatureContext): void {
  const command: Command = {
    id: PREVIEW_COMMAND,
    group: 'view',
    ...cmdKeys(PREVIEW_COMMAND, 'menu.view.preview'),
    icon: PREVIEW_ICON,
    enabled: (context) => context.store.getState().document !== null && !isModalJobRunning(),
    unavailableReason: (context) =>
      context.store.getState().document === null ? context.t('preview.reason.noDocument') : null,
    run: (context) => {
      const state = context.store.getState();
      const nodeId =
        state.activeView === 'source'
          ? (getTreeFeature(context.store).selectedId ?? state.selectionNodeId)
          : state.selectionNodeId;
      openPreview({ nodeId: nodeId ?? null });
    },
  };
  ctx.commands.replace(command);
}
