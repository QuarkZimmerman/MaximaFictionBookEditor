/**
 * Central Package editing mode command and view allow-list (feature 022, D1; FR-016 to FR-020).
 *
 * Every menu item, toolbar button, and hotkey passes through `CommandRegistry.isEnabled` /
 * `isVisible`, which delegates to this single policy while `store.editorMode === 'package'`.
 * Keeping Package mode restrictions in one place guarantees FB2-only features (Body, Styles,
 * Scripts, Structure Tree ops, Exports, non-FBD Imports, Table editing, Words, Spellcheck) cannot
 * leak into Package mode and automatically restore 100% when switching back to FB2 mode.
 */

import type { ViewId } from '@/rpc/types';

/** Main view tabs visible in Package editing mode (FR-016: Body and Styles are hidden). */
export const PACKAGE_MODE_VIEWS: readonly ViewId[] = ['description', 'source'];

/** Commands that remain available in Package editing mode (subject to their own predicates). */
export const PACKAGE_MODE_ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  // File lifecycle (FR-001, FR-003, FR-017, FR-020, FR-022)
  'file.new',
  'file.newPackage',
  'file.open',
  'file.save',
  'file.saveAs',
  'file.validate',
  'file.importDescription',
  'file.exit',

  // Description form field editing (FR-020; edit.find / findNext / replace stay disabled)
  'edit.undo',
  'edit.redo',
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'edit.pastePlain',

  // Applicable View toggles & read-only Source folding (FR-015, FR-016, FR-019, FR-020)
  'view.toolbarCommands',
  'view.statusBar',
  'view.tree', // toggles the left Package Files sidebar in Package mode
  'view.description',
  'view.source',
  'ai.toggle',
  'source.collapse1',
  'source.collapse2',
  'source.collapse3',
  'source.collapse4',
  'source.collapse5',
  'source.collapse6',
  'source.collapse7',
  'source.collapse8',
  'source.collapse9',
  'source.expand1',
  'source.expand2',
  'source.expand3',
  'source.expand4',
  'source.expand5',
  'source.expand6',
  'source.expand7',
  'source.expand8',
  'source.expand9',

  // Global tools explicitly enabled in Package mode (FR-020)
  'tools.settings',
  'tools.batchConverter',

  // Help (FR-020)
  'help.checkVersion',
  'help.about',
]);

/** Commands that require an active payload entry in Package mode to run. */
export const PACKAGE_MODE_ENTRY_REQUIRED_COMMANDS: ReadonlySet<string> = new Set([
  'file.validate',
  'file.importDescription',
]);

/** View commands hidden from the View switcher in Package mode (FR-016). */
export const PACKAGE_MODE_HIDDEN_COMMANDS: ReadonlySet<string> = new Set([
  'view.body',
  'view.styles',
]);

export function isCommandAllowedInPackageMode(commandId: string): boolean {
  // Dynamic Recent Files entries (`file.recent1`..`file.recent10`) remain usable to switch files/packages.
  if (/^file\.recent\d+$/.test(commandId)) return true;
  // All user scripts (`script.*`, `scripts.*`) are unconditionally disabled (FR-018).
  if (commandId.startsWith('script.') || commandId.startsWith('scripts.')) return false;
  return PACKAGE_MODE_ALLOWED_COMMANDS.has(commandId);
}

export function isCommandVisibleInPackageMode(commandId: string): boolean {
  return !PACKAGE_MODE_HIDDEN_COMMANDS.has(commandId);
}

export function requiresActivePackageEntry(commandId: string): boolean {
  return PACKAGE_MODE_ENTRY_REQUIRED_COMMANDS.has(commandId);
}
