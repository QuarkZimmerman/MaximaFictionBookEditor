/**
 * Transfer feature registrar (feature 004, User Stories 4 and 5; research R3.4): the
 * description import of File > Import (`file.importDescription`) and the FBD export of
 * File > Export (`file.exportFbd`). Both are File commands available with a connected core
 * and an open document, blocked while a script runs (the registry's default policy,
 * FR-036 / FR-043), without a default hotkey; the menu entries are static submenu items
 * (`app/menus.ts`) in place of the plugin placeholders of release 0.0.3.
 */

import type { Command, CommandContext } from '@/app/commands';
import type { FeatureContext } from '@/app/services';

import { cmdKeys } from '../editing/common';
import { exportFbd } from './exportFbd';
import { exportMarkdown } from './exportMarkdown';
import { importDescription } from './importDescription';

export { exportDefaultPath, exportFbd, exportFileTypes } from './exportFbd';
export { importDescription, importFileTypes } from './importDescription';
export {
  applyEntries,
  entryLabel,
  entryValueText,
  importableEntries,
  type ImportableEntry,
} from './importEntries';
export { equalDescriptions, isUntouchedNewDocument } from './untouched';

const connectedWithDocument = (ctx: CommandContext): boolean =>
  ctx.rpc !== null &&
  ctx.store.getState().connection === 'connected' &&
  ctx.store.getState().document !== null;

export function registerTransferFeature(ctx: FeatureContext): void {
  const commands: Command[] = [
    {
      id: 'file.importDescription',
      group: 'file',
      ...cmdKeys('file.importDescription', 'menu.file.importDescription'),
      enabled: connectedWithDocument,
      run: async (context) => {
        await importDescription(context);
      },
    },
    {
      id: 'file.exportFbd',
      group: 'file',
      ...cmdKeys('file.exportFbd', 'menu.file.exportFbd'),
      enabled: connectedWithDocument,
      run: async (context) => {
        await exportFbd(context);
      },
    },
    // Feature 011 (US5, US6): the Markdown exports, after Export as FBD.
    {
      id: 'file.exportMarkdown',
      group: 'file',
      ...cmdKeys('file.exportMarkdown', 'menu.file.exportMarkdown'),
      enabled: connectedWithDocument,
      run: async (context) => {
        await exportMarkdown(context, 'md');
      },
    },
    {
      id: 'file.exportMarkdownZip',
      group: 'file',
      ...cmdKeys('file.exportMarkdownZip', 'menu.file.exportMarkdownZip'),
      enabled: connectedWithDocument,
      run: async (context) => {
        await exportMarkdown(context, 'zip');
      },
    },
  ];
  for (const command of commands) ctx.commands.replace(command);
}
