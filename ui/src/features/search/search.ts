/**
 * Find / Replace session (T066, data-model.md §2.3): the options, the replacement string, the
 * histories of the last 20 search and replacement strings (persisted in the session settings
 * through `settings.set`), the dialogs and the Edit menu commands (`edit.find`, `edit.findNext`,
 * `edit.replace`).
 *
 * The session is view-agnostic: each view registers a `SearchTarget` (the Body target lives in
 * `bodyTarget.ts`; the Source view (US4) and the Description fields (US3) register theirs).
 * Messages follow the original editor: the Find dialog reports "Cannot find the string '%s'.",
 * the Replace dialog "Finished searching for '%s'." and Replace All "%d replacement(s) done."
 * (or "Finished searching" when nothing matched); search wraps around the document.
 */

import { createElement } from 'react';

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import type { Dialogs } from '@/dialogs/types';
import { FindDialog } from '@/dialogs/FindDialog';
import { ReplaceDialog } from '@/dialogs/ReplaceDialog';
import { actions, type AppStore } from '@/model/store';
import type { UndoCoordinator } from '@/model/undo';
import type { ViewId } from '@/rpc/types';

import { cmdKeys } from '../editing/common';

export interface FindOptions {
  query: string;
  wholeWord: boolean;
  matchCase: boolean;
  regex: boolean;
  direction: 'up' | 'down';
}

export const DEFAULT_FIND_OPTIONS: FindOptions = {
  query: '',
  wholeWord: false,
  matchCase: false,
  regex: false,
  direction: 'down',
};

/** How a search starts: from the selection (Find Next) or from the incremental-search anchor. */
export type FindMode = 'next' | 'fromAnchor';

/** What a view offers to the Find / Replace session. */
export interface SearchTarget {
  readonly view: ViewId;
  /** Selects the next occurrence (wrapping around); false when there is none. */
  findNext(options: FindOptions, mode?: FindMode): boolean;
  /** Replaces the current match when the selection still is that match; false otherwise. */
  replaceCurrent(options: FindOptions, replacement: string): boolean;
  /** Replaces every occurrence in the view's document; returns the count. */
  replaceAll(options: FindOptions, replacement: string): number;
  /** Selected text, offered as the initial "Find what". */
  selectedText(): string;
  /** Incremental search: remember / restore / forget the selection the search started from. */
  markAnchor(): void;
  restoreAnchor(): void;
  clearAnchor(): void;
}

export const HISTORY_LIMIT = 20;

export interface SearchSessionOptions {
  store: AppStore;
  undo: UndoCoordinator;
}

export class SearchSession {
  readonly store: AppStore;
  readonly undo: UndoCoordinator;
  private readonly targets = new Map<ViewId, SearchTarget>();
  options: FindOptions = { ...DEFAULT_FIND_OPTIONS };
  replacement = '';
  /** True after a successful find in the Replace dialog (the next Replace acts on it). */
  matchValid = false;
  private readonly listeners = new Set<() => void>();

  constructor(options: SearchSessionOptions) {
    this.store = options.store;
    this.undo = options.undo;
  }

  registerTarget(target: SearchTarget): () => void {
    this.targets.set(target.view, target);
    return () => {
      if (this.targets.get(target.view) === target) this.targets.delete(target.view);
    };
  }

  /** The target of the active view, if it has one. */
  activeTarget(): SearchTarget | null {
    return this.targets.get(this.store.getState().activeView) ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /* ----------------------------------------------------------------- history */

  get findHistory(): string[] {
    return this.store.getState().settings?.session.findHistory ?? [];
  }

  get replaceHistory(): string[] {
    return this.store.getState().settings?.session.replaceHistory ?? [];
  }

  /** Moves `value` to the front of a history list (≤ 20 entries) and persists it. */
  async remember(ctx: CommandContext, kind: 'find' | 'replace', value: string): Promise<void> {
    if (!value) return;
    const current = kind === 'find' ? this.findHistory : this.replaceHistory;
    const next = [value, ...current.filter((item) => item !== value)].slice(0, HISTORY_LIMIT);
    if (current.length === next.length && current.every((item, i) => item === next[i])) return;
    const settings = ctx.store.getState().settings;
    if (settings) {
      const session = {
        ...settings.session,
        [kind === 'find' ? 'findHistory' : 'replaceHistory']: next,
      };
      ctx.store.setState({ settings: { ...settings, session } });
    }
    if (ctx.rpc) {
      try {
        await ctx.rpc.call('settings.set', {
          patch: { session: { [kind === 'find' ? 'findHistory' : 'replaceHistory']: next } },
        });
      } catch {
        // the history is a convenience; losing it is harmless
      }
    }
    this.emit();
  }

  /* ----------------------------------------------------------------- actions */

  /** Find Next (F3 / dialog): true when a match was selected. Shows no message itself. */
  find(options: FindOptions, mode: FindMode = 'next'): boolean {
    this.options = { ...options };
    const target = this.activeTarget();
    if (!target || !options.query) return false;
    const found = target.findNext(options, mode);
    this.matchValid = found;
    this.emit();
    return found;
  }

  /** Replace: replaces the current match (if valid) then finds the next one. */
  replace(options: FindOptions, replacement: string): { replaced: boolean; found: boolean } {
    this.options = { ...options };
    this.replacement = replacement;
    const target = this.activeTarget();
    if (!target) return { replaced: false, found: false };
    const replaced = this.matchValid ? target.replaceCurrent(options, replacement) : false;
    const found = target.findNext(options, 'next');
    this.matchValid = found;
    this.emit();
    return { replaced, found };
  }

  /** Replace All as one undo entry (`label`); returns the number of replacements. */
  replaceAll(options: FindOptions, replacement: string, label = 'Replace All'): number {
    this.options = { ...options };
    this.replacement = replacement;
    const target = this.activeTarget();
    if (!target || !options.query) return 0;
    this.undo.beginGroup(label);
    let count: number;
    try {
      count = target.replaceAll(options, replacement);
    } finally {
      this.undo.endGroup();
    }
    this.matchValid = false;
    this.emit();
    return count;
  }

  /* ----------------------------------------------------------------- dialogs */

  initialQuery(): string {
    const selected = this.activeTarget()?.selectedText() ?? '';
    const singleLine = selected.includes('\n') ? '' : selected;
    return singleLine || this.options.query;
  }

  async openFind(ctx: CommandContext): Promise<void> {
    const dialogs: Dialogs = ctx.dialogs;
    await dialogs.openCustom<void>((close) =>
      createElement(FindDialog, { session: this, ctx, onClose: () => close() }),
    );
  }

  async openReplace(ctx: CommandContext): Promise<void> {
    this.matchValid = false;
    await ctx.dialogs.openCustom<void>((close) =>
      createElement(ReplaceDialog, { session: this, ctx, onClose: () => close() }),
    );
  }

  /** F3: repeats the last search; "Cannot find the string" when nothing matches. */
  async findNextCommand(ctx: CommandContext): Promise<void> {
    if (!this.options.query) {
      await this.openFind(ctx);
      return;
    }
    if (!this.find(this.options, 'next')) await this.reportNotFound(ctx, 'find');
  }

  async reportNotFound(ctx: CommandContext, kind: 'find' | 'replace'): Promise<void> {
    await ctx.dialogs.showMessage({
      text: ctx.t(kind === 'find' ? 'msg.searchFailed' : 'msg.searchFinished', {
        text: this.options.query,
      }),
      caption: ctx.t('app.name'),
      icon: 'warning',
      testId: 'dialog-search-message',
    });
  }

  async reportReplaceAll(ctx: CommandContext, count: number): Promise<void> {
    if (count > 0) {
      await ctx.dialogs.showMessage({
        text: ctx.t('msg.replacementsDone', { count }),
        caption: ctx.t('dialog.replace.replaceAllCaption'),
        icon: 'info',
        testId: 'dialog-replace-all-done',
      });
      actions.setStatusMessage(ctx.store, ctx.t('msg.replacementsDone', { count }));
    } else {
      await this.reportNotFound(ctx, 'replace');
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Commands                                                                 */
/* ------------------------------------------------------------------------ */

const sessions = new WeakMap<AppStore, SearchSession>();

export function getSearchSession(store: AppStore, undo?: UndoCoordinator): SearchSession {
  let session = sessions.get(store);
  if (!session) {
    if (!undo) throw new Error('getSearchSession: no session for this store yet');
    session = new SearchSession({ store, undo });
    sessions.set(store, session);
  }
  return session;
}

export function registerSearchCommands(registry: CommandRegistry, session: SearchSession): void {
  const hasTarget = (ctx: CommandContext) =>
    ctx.store.getState().document !== null && session.activeTarget() !== null;
  const commands: Command[] = [
    {
      id: 'edit.find',
      group: 'edit',
      ...cmdKeys('edit.find', 'menu.edit.find'),
      icon: 'id_edit_find',
      enabled: hasTarget,
      run: (ctx) => session.openFind(ctx),
    },
    {
      id: 'edit.findNext',
      group: 'edit',
      ...cmdKeys('edit.findNext', 'menu.edit.findNext'),
      icon: 'id_edit_findnext',
      enabled: hasTarget,
      run: (ctx) => session.findNextCommand(ctx),
    },
    {
      id: 'edit.replace',
      group: 'edit',
      ...cmdKeys('edit.replace', 'menu.edit.replace'),
      icon: 'id_edit_replace',
      enabled: hasTarget,
      run: (ctx) => session.openReplace(ctx),
    },
  ];
  for (const command of commands) registry.replace(command);
}
