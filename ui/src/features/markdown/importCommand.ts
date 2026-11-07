/**
 * Feature 010, US8 (FR-080): File > Import > Markdown File... - the command, registered with the
 * file feature it hands the new book to. The converter, with markdown-it, and the fonts load only
 * at the first import (`run.ts`, `pictures.ts`); the flow itself is small and stays in the main
 * bundle - a second lazy chunk sharing the main bundle's modules with the assistant's would split
 * them into a chunk the start-up loads (SC-013).
 */

import type { CommandRegistry } from '@/app/commands';
import { cmdKeys } from '@/features/editing/common';
import type { FileFeature } from '@/features/file/fileCommands';

import { importMarkdown } from './importFlow';

export const IMPORT_MARKDOWN_COMMAND = 'file.importMarkdown';

export function registerMarkdownImport(commands: CommandRegistry, files: FileFeature): void {
  commands.replace({
    id: IMPORT_MARKDOWN_COMMAND,
    group: 'file',
    ...cmdKeys(IMPORT_MARKDOWN_COMMAND, 'menu.file.importMarkdown'),
    enabled: (ctx) => ctx.rpc !== null,
    run: async (ctx) => {
      await importMarkdown(ctx, files);
    },
  });
}
