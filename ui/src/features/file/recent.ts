/**
 * Recent Files and Restore position (T054; feature 004 US8).
 *
 * - `RecentFilesStore` mirrors the core's `doc.recent` list (<= 10 entries, newest first; the
 *   core maintains it on open/save and prunes missing files on open failure) and registers one
 *   `file.recent<N>` command per entry so the File > Recent Files submenu can show them as
 *   ordinary menu items (`recentMenuItems()` builds the `MenuItemSpec[]`). Entries the core has
 *   flagged as missing (`exists === false`) are disabled (greyed).
 * - Restore position (FR-100 / FR-101; research R5.6, R5.7): with `restorePosition` on,
 *   `rememberPosition()` sends the **Body** controller's caret - whatever the active view - as a
 *   structural path and offset through `doc.position` whenever a document with a file leaves
 *   the editor (New, Open, Recent Files, a forwarded file, the changed-on-disk reload, every
 *   save, Exit, the window's close request, the restart); `restorePosition()` asks for the
 *   remembered position after an open, resolves it against the model the UI shows
 *   (`resolvePosition`: the same character of the paragraph now at that place, clamped) and
 *   places the Body caret without switching the view - at once when the Body view is active,
 *   otherwise in the controller's kept state, scrolled into view when the view mounts. The
 *   record lives in the core's `positions.json` (100 files, independent of the Recent Files
 *   list); the core gates every record and answer on the setting.
 */

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import type { MenuItemSpec } from '@/app/menus';
import { FIXED_BLOCK_IDS } from '@/editor/schema';
import { resolvePosition, type StructuralPosition } from '@/editor/structuralPath';
import type { RpcClient } from '@/rpc/client';
import type { RecentFile, RememberedPosition } from '@/rpc/types';
import { getBodyController, hasBodyController } from '@/views/body/bodyEditor';

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
/* Restore position (feature 004 US8)                                       */
/* ------------------------------------------------------------------------ */

/**
 * False only while the settings are known and "Restore position" is off. Before they arrive
 * (the start-up open can race `settings.get`, research R5.1 H6) nothing is assumed: the core
 * gates every record and every answer on the setting, so asking it is always right.
 */
function restorePositionEnabled(ctx: CommandContext): boolean {
  return ctx.store.getState().settings?.other.restorePosition !== false;
}

/**
 * Sends the Body controller's caret for `docId` through `doc.position` (FR-100). Skipped when
 * the setting is known to be off, the document has no file (a never-saved document remembers
 * nothing), the session is Source-only (a malformed file takes no Body caret) or the Body view
 * was never shown for this document and its caret never placed (the previous record for the
 * path stays). Best effort: a failure is not reported.
 */
export async function rememberPosition(ctx: CommandContext, docId: string): Promise<void> {
  if (!ctx.rpc || !restorePositionEnabled(ctx)) return;
  const state = ctx.store.getState();
  if (state.path === null || state.sourceOnly || state.docId !== docId) return;
  if (!hasBodyController(ctx.store)) return;
  const controller = getBodyController(ctx.store);
  if (!controller.bodyShown) return;
  const position = controller.getPosition();
  if (!position) return;
  try {
    await ctx.rpc.call('doc.position', { docId, position });
  } catch {
    // remembering the position is best effort
  }
}

/**
 * Places the Body caret at `position` - the remembered one of `docId` (`doc.position`) or the
 * `pending` one handed over by the changed-on-disk reload, which wins without asking the core
 * (the reload keeps the in-session caret whatever the setting, FR-101). The path is resolved
 * against the document the UI shows (`resolvePosition`): a paragraph that no longer exists
 * falls back to the one now at that place, clamped, silently. The view is never switched:
 * placed, scrolled and focused at once when the Body view is mounted, otherwise set in the
 * controller's kept state and scrolled into view when the view mounts. False when nothing is
 * remembered, another document was opened meanwhile, the session is Source-only or the
 * document has no node to go to.
 */
export async function restorePosition(
  ctx: CommandContext,
  docId: string,
  pending: StructuralPosition | null = null,
): Promise<boolean> {
  if (!ctx.rpc) return false;
  let position: RememberedPosition | null = pending;
  if (!position) {
    if (!restorePositionEnabled(ctx)) return false;
    try {
      position = (await ctx.rpc.call('doc.position', { docId })).position ?? null;
    } catch {
      return false;
    }
  }
  if (!position) return false;
  const state = ctx.store.getState();
  if (state.docId !== docId || state.sourceOnly || !state.document) return false;
  if (!hasBodyController(ctx.store)) return false;
  const resolved = resolvePosition(state.document, position);
  if (!resolved.nodeId) return false;
  // The description blocks carry fixed ids in the editor document (data-model §0.1).
  const { annotation } = state.document.description.titleInfo;
  const { history } = state.document.description.documentInfo;
  const nodeId =
    annotation?.attrs.nodeId === resolved.nodeId
      ? FIXED_BLOCK_IDS.annotation
      : history?.attrs.nodeId === resolved.nodeId
        ? FIXED_BLOCK_IDS.history
        : resolved.nodeId;
  return getBodyController(ctx.store).setCaret({ view: 'body', nodeId, offset: resolved.offset });
}
