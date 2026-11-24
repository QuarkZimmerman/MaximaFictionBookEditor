/**
 * Feature 019 (T036, T053): lazy entry point of the `batch-converter` chunk.
 * Queries `app.info` (for `cpuCores`), ensures `settings` are populated, and loads persisted
 * Batch Converter settings fresh from disk (`batch.settings.get`) before opening the modal dialog.
 */

import { createElement } from 'react';

import type { CommandContext } from '@/app/commands';
import { actions } from '@/model/store';

import { BatchConverterDialog } from './BatchConverterDialog';

export async function openBatchConverterDialog(ctx: CommandContext): Promise<void> {
  const { rpc, store } = ctx;
  if (!rpc) return;

  const [info, loadedSettings, batchPersisted, ocrReport] = await Promise.all([
    rpc.call('app.info').catch(() => null),
    store.getState().settings
      ? Promise.resolve(store.getState().settings)
      : rpc
          .call('settings.get')
          .then((s) => {
            actions.setSettings(store, s);
            return s;
          })
          .catch(() => null),
    rpc.call('batch.settings.get', {}).catch(() => null),
    rpc.call('ocr.report').catch(() => null),
  ]);

  const cpuCores = info?.cpuCores ?? 1;
  const canCloseRef = { current: true };

  await ctx.dialogs.openCustom<void>(
    (close) =>
      createElement(BatchConverterDialog, {
        ctx,
        cpuCores,
        initialSettings: loadedSettings,
        initialPersisted: batchPersisted?.settings ?? null,
        initialOcrReport: ocrReport,
        canCloseRef,
        onClose: () => close(),
      }),
    { canClose: () => canCloseRef.current },
  );
}
