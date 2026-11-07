/**
 * Feature 010, US8 (FR-080): File > Import > Markdown File... - the command, registered with the
 * file feature it hands the new book to. The import itself loads lazily (`importFlow.ts`), so the
 * converter and the fonts stay out of the main bundle until the first import.
 */

import type { CommandRegistry } from '@/app/commands';
import { cmdKeys } from '@/features/editing/common';
import type { FileFeature } from '@/features/file/fileCommands';

export const IMPORT_MARKDOWN_COMMAND = 'file.importMarkdown';

export function registerMarkdownImport(commands: CommandRegistry, files: FileFeature): void {
  commands.replace({
    id: IMPORT_MARKDOWN_COMMAND,
    group: 'file',
    ...cmdKeys(IMPORT_MARKDOWN_COMMAND, 'menu.file.importMarkdown'),
    enabled: (ctx) => ctx.rpc !== null,
    run: async (ctx) => {
      const { importMarkdown } = await import('./importFlow');
      await importMarkdown(ctx, files);
    },
  });
}
