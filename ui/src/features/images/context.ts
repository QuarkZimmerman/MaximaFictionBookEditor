/**
 * Command context capture for the image flows that start outside a command: the paste and
 * drag-and-drop handlers and the context menu's "Save image as..." need the RPC client, the
 * dialogs and `t()`, which only `CommandContext` carries. The feature registrar receives no
 * context (`FeatureContext` = commands, undo, carets, store, hotkeys), so the image commands
 * remember the latest context they are evaluated / run with (the toolbar evaluates their
 * enable state on every state change) and the DOM-level flows pick it up from here.
 *
 * Coordinator hook: should `FeatureContext` grow a `getCommandContext()` accessor, replace the
 * `rememberCommandContext()` calls by it and delete this module.
 */

import type { CommandContext } from '@/app/commands';
import type { AppStore } from '@/model/store';

const contexts = new WeakMap<AppStore, CommandContext>();

/** Called by the image commands with the context they are evaluated or run with. */
export function rememberCommandContext(ctx: CommandContext): void {
  contexts.set(ctx.store, ctx);
}

/** The most recent command context seen for `store` (null before the first evaluation). */
export function latestCommandContext(store: AppStore): CommandContext | null {
  return contexts.get(store) ?? null;
}
