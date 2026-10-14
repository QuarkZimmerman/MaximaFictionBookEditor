/**
 * Incremental search (T066, FR-024), after `CMainFrame::OnEditIncSearch` / `OnChar`:
 * `edit.incrementalSearch` (Alt+I) starts a session anchored at the current selection; typed
 * characters extend the search string and the first match from the anchor is selected as you
 * type, Backspace shrinks the string, Alt+I again finds the next occurrence (or re-uses the
 * previous search string when the current one is empty), Enter accepts the match, Escape
 * cancels and restores the anchor selection. Any other command, a mouse click or a view switch
 * ends the session. The status bar shows "Incremental Search: …" or "Failing Incremental
 * Search: …".
 */

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import { actions, type AppStore } from '@/model/store';

import { cmdKeys } from '../editing/common';
import { DEFAULT_FIND_OPTIONS, type SearchSession } from './search';

export class IncrementalSearch {
  private active = false;
  private text = '';
  private previous = '';
  private failing = false;
  private translate: ((key: string, params?: Record<string, unknown>) => string) | null = null;
  private offStore: (() => void) | null = null;

  constructor(
    private readonly store: AppStore,
    private readonly session: SearchSession,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  get searchText(): string {
    return this.text;
  }

  /** Alt+I: start, or find the next occurrence while a session is running. */
  toggle(ctx: CommandContext): void {
    this.translate = (key, params) => ctx.t(key, params ?? {}) as string;
    const target = this.session.activeTarget();
    if (!target) return;
    if (!this.active) {
      this.active = true;
      this.text = '';
      this.failing = false;
      this.previous = this.session.options.query;
      target.markAnchor();
      this.attach();
      this.updateStatus();
      return;
    }
    if (this.text === '' && this.previous) {
      // Second Alt+I without typing: re-use the last search string.
      this.text = this.previous;
      this.search('fromAnchor');
      return;
    }
    if (!this.failing) this.search('next');
  }

  private attach(): void {
    document.addEventListener('keydown', this.onKeyDown, { capture: true });
    document.addEventListener('mousedown', this.onMouseDown, { capture: true });
    let lastView = this.store.getState().activeView;
    this.offStore = this.store.subscribe((state) => {
      if (state.activeView !== lastView || state.document === null) {
        lastView = state.activeView;
        this.stop(true);
      }
    });
  }

  private detach(): void {
    document.removeEventListener('keydown', this.onKeyDown, { capture: true });
    document.removeEventListener('mousedown', this.onMouseDown, { capture: true });
    this.offStore?.();
    this.offStore = null;
  }

  private readonly onMouseDown = (): void => {
    this.stop(true);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active) return;
    if (event.ctrlKey || event.metaKey) {
      // Another command (Ctrl+F, Ctrl+Z...) ends the session, as in the original.
      this.stop(false);
      return;
    }
    if (event.altKey) return; // Alt+I itself and menu mnemonics
    if (event.key === 'Escape') {
      consume(event);
      this.stop(true);
      return;
    }
    if (event.key === 'Enter') {
      consume(event);
      this.stop(false);
      return;
    }
    if (event.key === 'Backspace') {
      consume(event);
      this.text = this.text.slice(0, -1);
      this.search('fromAnchor');
      return;
    }
    if (event.key.length === 1) {
      consume(event);
      if (this.failing) return; // the original beeped and ignored further characters
      this.text += event.key;
      this.search('fromAnchor');
      return;
    }
    if (['Shift', 'CapsLock', 'Tab'].includes(event.key)) return;
    // Navigation keys and the like end the session (a selection change in the original).
    this.stop(false);
  };

  private search(mode: 'next' | 'fromAnchor'): void {
    const target = this.session.activeTarget();
    if (!target) {
      this.stop(true);
      return;
    }
    if (this.text === '') {
      target.restoreAnchor();
      target.markAnchor();
      this.failing = false;
      this.updateStatus();
      return;
    }
    const options = { ...DEFAULT_FIND_OPTIONS, matchCase: false, query: this.text };
    const result = target.findNext(options, mode);
    if (result === 'wrapped') this.session.beep();
    const found = result !== false;
    this.failing = !found;
    if (found) this.session.options = { ...this.session.options, query: this.text };
    this.updateStatus();
  }

  private updateStatus(): void {
    if (!this.translate) return;
    const key = this.failing ? 'status.failingIncrementalSearch' : 'status.incrementalSearch';
    actions.setStatusMessage(this.store, this.translate(key, { text: this.text }));
  }

  /** Ends the session; `cancel` restores the selection the search started from. */
  stop(cancel: boolean): void {
    if (!this.active) return;
    this.active = false;
    this.detach();
    const target = this.session.activeTarget();
    if (cancel) target?.restoreAnchor();
    else target?.clearAnchor();
    actions.setStatusMessage(this.store, null);
  }
}

function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

export function registerIncrementalSearch(
  registry: CommandRegistry,
  incremental: IncrementalSearch,
  session: SearchSession,
): void {
  const command: Command = {
    id: 'edit.incrementalSearch',
    group: 'edit',
    ...cmdKeys('edit.incrementalSearch'),
    enabled: (ctx) => ctx.store.getState().document !== null && session.activeTarget() !== null,
    run: (ctx) => incremental.toggle(ctx),
  };
  registry.replace(command);
}
