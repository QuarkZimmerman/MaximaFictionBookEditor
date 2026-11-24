/**
 * Feature 019 (T025, FR-001, FR-024): static entry point for Tools -> Batch Converter...
 * Stays lightweight in the main bundle and dynamically loads `./openDialog` (`batch-converter`
 * lazy chunk) only when the user actually invokes the command.
 */

import type { CommandContext, CommandRegistry } from '@/app/commands';
import { cmdKeys } from '@/features/editing/common';

export const BATCH_CONVERTER_COMMAND = 'tools.batchConverter';

const isConnected = (ctx: CommandContext): boolean =>
  ctx.rpc !== null && ctx.store.getState().connection === 'connected';

export function registerBatchFeature(commands: CommandRegistry): void {
  commands.replace({
    id: BATCH_CONVERTER_COMMAND,
    group: 'tools',
    ...cmdKeys(BATCH_CONVERTER_COMMAND, 'menu.tools.batchConverter'),
    enabled: isConnected,
    run: async (ctx) => {
      if (!ctx.rpc) return;
      const { openBatchConverterDialog } = await import('./openDialog');
      await openBatchConverterDialog(ctx);
    },
  });
}
