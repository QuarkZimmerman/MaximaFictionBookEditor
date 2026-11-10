/**
 * Feature 012 (D1, D14, D32; research DP-1): File > Import > EPUB File... and File > Export > Export as
 * EPUB.... The two commands are static and small; each loads its part - the lazy chunk `epub-import`
 * or `epub-export` (folder rules in vite.config.ts, checked by tests/unit/epub/chunk.test.ts) - with
 * import() on its first use only, never at start-up and never with the other. Both are one-time
 * operations (011 D32, D33): nothing of them is kept once they end.
 */

import type { CommandContext, CommandRegistry } from '@/app/commands';
import { cmdKeys } from '@/features/editing/common';
import type { FileFeature } from '@/features/file/fileCommands';

export const IMPORT_EPUB_COMMAND = 'file.importEpub';
export const EXPORT_EPUB_COMMAND = 'file.exportEpub';

const connectedWithDocument = (ctx: CommandContext): boolean =>
  ctx.rpc !== null &&
  ctx.store.getState().connection === 'connected' &&
  ctx.store.getState().document !== null;

export function registerEpubFeature(commands: CommandRegistry, files: FileFeature): void {
  commands.replace({
    id: IMPORT_EPUB_COMMAND,
    group: 'file',
    ...cmdKeys(IMPORT_EPUB_COMMAND, 'menu.file.importEpub'),
    enabled: (ctx) => ctx.rpc !== null,
    run: async (ctx) => {
      const { importEpub } = await import('./import/job');
      await importEpub(ctx, files);
    },
  });
  commands.replace({
    id: EXPORT_EPUB_COMMAND,
    group: 'file',
    ...cmdKeys(EXPORT_EPUB_COMMAND, 'menu.file.exportEpub'),
    enabled: connectedWithDocument,
    run: async (ctx) => {
      const { exportEpub } = await import('./export/job');
      await exportEpub(ctx);
    },
  });
}
