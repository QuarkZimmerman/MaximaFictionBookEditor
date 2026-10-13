/**
 * Recent Files and caret restore (T054).
 *
 * - `RecentFilesStore` mirrors the core's `doc.recent` list (<= 10 entries, newest first; the
 *   core maintains it on open/save and prunes missing files on open failure) and registers one
 *   `file.recent<N>` command per entry so the File > Recent Files submenu can show them as
 *   ordinary menu items (`recentMenuItems()` builds the `MenuItemSpec[]`). Entries the core has
 *   flagged as missing (`exists === false`) are disabled (greyed).
 * - Caret restore (FR-008): with `restorePosition` on, `rememberCaret()` stores the active view's
 *   caret through `doc.caret` when a document is closed/saved and `restoreCaret()` asks for it
 *   after an open and moves the view's selection (retrying while the view mounts).
 */

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import type { MenuItemSpec } from '@/app/menus';
import type { RpcClient } from '@/rpc/client';
import type { Caret, RecentFile } from '@/rpc/types';
import { requestViewSwitch } from '@/views/source/sourceSession';

export const MAX_RECENT = 10;

export function recentCommandId(index: number): string {
  return `file.recent${index + 1}`;
}

/** Display label: `1. /path/to/book.fb2` (numbered like the original MRU list). */
export function recentLabel(file: RecentFile, index: number): string {
  return `${index + 1}. ${file.path}`;
}

export class RecentFilesStore {
  private items: RecentFile[] = [];
  private readonly listeners = new Set<() => void>();
  private registered: string[] = [];

  constructor(
    private readonly registry: CommandRegistry,
    private readonly open: (ctx: CommandContext, path: string) => Promise<boolean>,
  ) {}

  get files(): readonly RecentFile[] {
    return this.items;
  }

  /** Arrow property so it can be handed to `useSyncExternalStore` unbound. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Reloads the list from the core (ignores failures: the menu just keeps the old list). */
  async refresh(rpc: RpcClient | null): Promise<void> {
    if (!rpc) return;
    try {
      const files = await rpc.call('doc.recent');
      this.set(Array.isArray(files) ? files : []);
    } catch {
      // older core or transient failure: keep what we have
    }
  }

  /** Replaces the list (also used by tests) and re-registers the menu commands. */
  set(files: RecentFile[]): void {
    this.items = files.slice(0, MAX_RECENT);
    for (const id of this.registered) this.registry.unregister(id);
    this.registered = [];
    this.items.forEach((file, index) => {
      const id = recentCommandId(index);
      const command: Command = {
        id,
        group: 'file',
        label: recentLabel(file, index),
        tooltipKey: 'menu.file.openThisDocument',
        descriptionKey: 'menu.file.openThisDocument',
        enabled: (ctx) =>
          file.exists !== false &&
          ctx.rpc !== null &&
          ctx.store.getState().connection === 'connected',
        run: async (ctx) => {
          await this.open(ctx, file.path);
        },
      };
      this.registry.replace(command);
      this.registered.push(id);
    });
    for (const listener of [...this.listeners]) listener();
  }

  async clear(rpc: RpcClient | null): Promise<void> {
    if (rpc) await rpc.call('doc.clearRecent');
    this.set([]);
  }

  /** Items for the dynamic `recent` submenu (empty = the "No Recent Files" placeholder). */
  menuItems(): MenuItemSpec[] {
    return this.items.map((_file, index) => ({
      kind: 'command' as const,
      commandId: recentCommandId(index),
    }));
  }
}

/* ------------------------------------------------------------------------ */
/* Caret restore                                                            */
/* ------------------------------------------------------------------------ */

function restorePositionEnabled(ctx: CommandContext): boolean {
  return ctx.store.getState().settings?.other.restorePosition ?? true;
}

/** Caret of the active view, or null when nothing is selected. */
export function currentCaret(ctx: CommandContext): Caret | null {
  const { activeView } = ctx.store.getState();
  return ctx.carets?.get(activeView) ?? null;
}

/** Stores the active caret for `docId` through `doc.caret` (no-op when the setting is off). */
export async function rememberCaret(ctx: CommandContext, docId: string): Promise<void> {
  if (!ctx.rpc || !restorePositionEnabled(ctx)) return;
  const caret = currentCaret(ctx);
  if (!caret) return;
  try {
    await ctx.rpc.call('doc.caret', { docId, caret });
  } catch {
    // remembering the position is best effort
  }
}

/** Moves the selection to `caret`, waiting for the owning view to mount. */
export async function applyCaret(
  ctx: CommandContext,
  caret: Caret,
  attempts = 20,
): Promise<boolean> {
  if (!ctx.carets) return false;
  if (ctx.store.getState().activeView !== caret.view) {
    if (!(await requestViewSwitch(ctx, caret.view))) return false;
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (ctx.carets.set(caret)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

/** Restores the remembered caret of a freshly opened document (FR-008). */
export async function restoreCaret(ctx: CommandContext, docId: string): Promise<boolean> {
  if (!ctx.rpc || !restorePositionEnabled(ctx)) return false;
  let caret: Caret | undefined;
  try {
    ({ caret } = await ctx.rpc.call('doc.caret', { docId }));
  } catch {
    return false;
  }
  if (!caret || !caret.view) return false;
  if (ctx.store.getState().docId !== docId) return false; // another document was opened meanwhile
  if (caret.view === 'body' && ctx.store.getState().sourceOnly) return false;
  return applyCaret(ctx, caret);
}
