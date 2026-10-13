/**
 * Non-breaking space and typographic symbols (T068, FR-039).
 *
 *  - `edit.insertNbsp` inserts U+00A0 at the caret (shown with the configurable display
 *    character by `editor/plugins/nbsp.ts`); default hotkey Ctrl+Shift+Space.
 *  - `symbol.<N>` commands come from the core's `resources.symbols` (the `symbols.ini` table:
 *    code point, English / Russian label, optional default hotkey); each inserts its character
 *    into the Body editor, or into the focused text field as the original sent `WM_CHAR` to the
 *    focused window. The core method is optional: a missing method (-32601) yields no symbols.
 */

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import type { HotkeyMap } from '@/app/hotkeys';
import { NBSP } from '@/editor/plugins/nbsp';
import type { AppStore } from '@/model/store';
import { RpcError, type RpcClient } from '@/rpc/client';
import { RpcErrorCode, type SymbolEntry } from '@/rpc/types';
import type { BodyEditorController } from '@/views/body/bodyEditor';

import { bodyController, bodyEditable, editingKeys } from './editing/common';

export const INSERT_NBSP_COMMAND = 'edit.insertNbsp';
export const INSERT_NBSP_DEFAULT_HOTKEY = 'Mod+Shift+Space';

/** Inserts `text` where the user types: the Body editor or the focused text field. */
export function insertCharacter(ctx: Pick<CommandContext, 'store'>, text: string): boolean {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? start;
    active.setRangeText(text, start, end, 'end');
    active.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  const controller = bodyController(ctx.store);
  if (!controller || !bodyEditable(ctx)) return false;
  return insertIntoBody(controller, text);
}

export function insertIntoBody(controller: BodyEditorController, text: string): boolean {
  const state = controller.editorState;
  if (!state || !state.selection.$from.parent.inlineContent) return false;
  controller.apply(state.tr.insertText(text).scrollIntoView());
  controller.focus();
  return true;
}

function canInsert(ctx: CommandContext): boolean {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return true;
  const state = bodyController(ctx.store)?.editorState;
  return !!state && bodyEditable(ctx) && state.selection.$from.parent.inlineContent;
}

/** Label of a symbol in the interface language (English fallback). */
export function symbolLabel(entry: SymbolEntry, language: string): string {
  const names = entry.names ?? {};
  return (
    names[language] ??
    names.en ??
    Object.values(names)[0] ??
    `U+${entry.codepoint.toString(16).toUpperCase()}`
  );
}

export function symbolCommand(index: number, entry: SymbolEntry, store: AppStore): Command {
  const char = String.fromCodePoint(entry.codepoint);
  const isCombining =
    (entry.codepoint >= 0x0300 && entry.codepoint <= 0x036f) ||
    (entry.codepoint >= 0x1dc0 && entry.codepoint <= 0x1dff) ||
    (entry.codepoint >= 0x20d0 && entry.codepoint <= 0x20ff) ||
    (entry.codepoint >= 0xfe20 && entry.codepoint <= 0xfe2f);
  const shown = isCombining ? `\u25CC${char}` : char;
  return {
    id: `symbol.${index}`,
    group: 'symbols',
    get label() {
      return `${symbolLabel(entry, store.getState().uiLanguage)} (${shown})`;
    },
    get tooltip() {
      return symbolLabel(entry, store.getState().uiLanguage);
    },
    descriptionKey: 'cmd.symbol.description',
    labelParams: { name: symbolLabel(entry, store.getState().uiLanguage), char: shown },
    enabled: canInsert,
    run: (ctx) => {
      insertCharacter(ctx, char);
    },
  };
}

export class SymbolsFeature {
  private loaded = false;
  private unregister: (() => void)[] = [];
  entries: SymbolEntry[] = [];

  constructor(
    private readonly registry: CommandRegistry,
    private readonly hotkeys: HotkeyMap,
    private readonly store: AppStore,
  ) {}

  /** Loads `resources.symbols` once; a core without the method leaves the list empty. */
  async load(rpc: RpcClient): Promise<SymbolEntry[]> {
    if (this.loaded) return this.entries;
    this.loaded = true;
    try {
      this.entries = await rpc.call('resources.symbols');
    } catch (error) {
      if (!(error instanceof RpcError) || error.code !== RpcErrorCode.methodNotFound) {
        this.loaded = false; // transient failure: try again later
      }
      this.entries = [];
    }
    this.register();
    return this.entries;
  }

  private register(): void {
    for (const off of this.unregister) off();
    this.unregister = [];
    const defaults: { commandId: string; keys: string }[] = [];
    this.entries.forEach((entry, i) => {
      const command = symbolCommand(i + 1, entry, this.store);
      this.registry.replace(command);
      this.unregister.push(() => this.registry.unregister(command.id));
      if (entry.defaultHotkey) defaults.push({ commandId: command.id, keys: entry.defaultHotkey });
    });
    if (defaults.length > 0) this.hotkeys.addDefaults(defaults);
  }
}

export function registerSymbolCommands(registry: CommandRegistry, hotkeys: HotkeyMap): void {
  const nbsp: Command = {
    id: INSERT_NBSP_COMMAND,
    group: 'edit',
    ...editingKeys('insertNbsp'),
    enabled: canInsert,
    run: (ctx) => {
      insertCharacter(ctx, NBSP);
    },
  };
  registry.replace(nbsp);
  hotkeys.addDefaults([{ commandId: INSERT_NBSP_COMMAND, keys: INSERT_NBSP_DEFAULT_HOTKEY }]);
}
