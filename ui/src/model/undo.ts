/**
 * Global undo coordinator (data-model.md §2.2).
 *
 * Each view keeps its own history (ProseMirror history for Body/annotation/history editors,
 * CodeMirror history for Source, form-field diffs for Description) and registers a
 * `ViewHistoryAdapter`. The coordinator keeps one global stack of `UndoEntry {view, label,
 * groupId}` so that Edit > Undo always acts on the most recent change regardless of the view it
 * happened in, activating that view first.
 *
 * Rules implemented here:
 *  - a view reports every new history step with `record(view, label)`;
 *  - `beginGroup(label)` / `endGroup()` make a batch operation (Replace All, Words apply,
 *    spelling Change All, script run) exactly one undo entry, even across views;
 *  - `boundary()` is called on view switches: it closes open groups and prevents coalescing;
 *  - `undo()` / `redo()` pop the global top entry (the whole group when grouped), call the owning
 *    view's adapter and push the entry on the opposite stack;
 *  - steps performed by the adapters while undoing/redoing are not recorded again.
 */

export type UndoView = 'body' | 'source' | 'description' | (string & {});

export interface UndoEntry {
  view: UndoView;
  label: string;
  /** Non-zero for entries that belong to a batch group; equal within the group. */
  groupId: number;
}

export interface ViewHistoryAdapter {
  /** Undo one step of the view's own history; false when the history was empty. */
  undo(): boolean;
  /** Redo one step; false when nothing to redo. */
  redo(): boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface UndoCoordinatorOptions {
  /** Called before undoing/redoing an entry that belongs to another view. */
  activateView?: (view: UndoView) => void;
  /** Maximum number of entries kept (oldest dropped first). */
  limit?: number;
}

export class UndoCoordinator {
  private readonly adapters = new Map<UndoView, ViewHistoryAdapter>();
  private readonly undoStack: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly limit: number;
  private activateView: (view: UndoView) => void;
  private activeView: UndoView | null = null;
  private nextGroupId = 1;
  private openGroup: { id: number; label: string; depth: number; entries: number } | null = null;
  private replaying = false;

  constructor(options: UndoCoordinatorOptions = {}) {
    this.activateView = options.activateView ?? (() => {});
    this.limit = options.limit ?? 1000;
  }

  setActivateView(callback: (view: UndoView) => void): void {
    this.activateView = callback;
  }

  /** Registers the history adapter of a view; returns the unregister function. */
  registerView(view: UndoView, adapter: ViewHistoryAdapter): () => void {
    this.adapters.set(view, adapter);
    this.emit();
    return () => {
      if (this.adapters.get(view) === adapter) {
        this.adapters.delete(view);
        this.emit();
      }
    };
  }

  hasView(view: UndoView): boolean {
    return this.adapters.has(view);
  }

  /** The view whose changes are currently being recorded (set by `boundary()`). */
  get currentView(): UndoView | null {
    return this.activeView;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  get isReplaying(): boolean {
    return this.replaying;
  }

  get isGrouping(): boolean {
    return this.openGroup !== null;
  }

  peekUndo(): UndoEntry | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }

  peekRedo(): UndoEntry | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  /** Read-only snapshot of the undo stack, oldest first. */
  entries(): readonly UndoEntry[] {
    return [...this.undoStack];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Records that `view`'s own history gained one step. Ignored while the coordinator itself is
   * replaying history. Clears the redo stack (a new change invalidates redo).
   */
  record(view: UndoView, label: string): void {
    if (this.replaying) return;
    const entry: UndoEntry = {
      view,
      label: this.openGroup ? this.openGroup.label : label,
      groupId: this.openGroup ? this.openGroup.id : 0,
    };
    if (this.openGroup) this.openGroup.entries += 1;
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit();
  }

  /**
   * Starts a batch group: every step recorded until the matching `endGroup()` becomes part of
   * one undo entry. Nested calls are allowed (the outermost group wins). Returns the group id.
   */
  beginGroup(label: string): number {
    if (this.openGroup) {
      this.openGroup.depth += 1;
      return this.openGroup.id;
    }
    const id = this.nextGroupId++;
    this.openGroup = { id, label, depth: 1, entries: 0 };
    return id;
  }

  /** Closes the innermost `beginGroup()`. Returns true when the outermost group was closed. */
  endGroup(): boolean {
    if (!this.openGroup) return false;
    this.openGroup.depth -= 1;
    if (this.openGroup.depth > 0) return false;
    this.openGroup = null;
    this.emit();
    return true;
  }

  /**
   * Runs `fn` inside a group; the group is closed even when `fn` throws. Async functions are
   * awaited so that script runs and RPC-backed batch operations stay in one entry.
   */
  async group<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
    this.beginGroup(label);
    try {
      return await fn();
    } finally {
      this.endGroup();
    }
  }

  /**
   * Rolls back the currently open group (used when a script run is cancelled) and closes it.
   * Returns the number of entries undone.
   */
  rollbackGroup(): number {
    if (!this.openGroup) return 0;
    const { id } = this.openGroup;
    this.openGroup = null;
    let undone = 0;
    while (this.peekUndo()?.groupId === id) {
      const entry = this.undoStack.pop()!;
      if (this.applyUndo(entry)) undone += 1;
    }
    // A rolled-back group must not be redoable.
    this.redoStack.length = 0;
    this.emit();
    return undone;
  }

  /**
   * Marks a boundary: called when the active view changes. Closes any open group (a batch
   * cannot span a user-initiated view switch) and remembers the new view.
   */
  boundary(view?: UndoView): void {
    if (this.openGroup) {
      this.openGroup = null;
    }
    if (view !== undefined) this.activeView = view;
    this.emit();
  }

  /** Undoes the top entry (the whole group for grouped entries). Returns false when nothing. */
  undo(): boolean {
    const top = this.peekUndo();
    if (!top) return false;
    const undone: UndoEntry[] = [];
    const groupId = top.groupId;
    do {
      const entry = this.undoStack.pop()!;
      if (!this.applyUndo(entry)) {
        // The view's history is out of sync (e.g. the view was unmounted): drop the entry and
        // report what was actually undone so far.
        break;
      }
      undone.push(entry);
    } while (groupId !== 0 && this.peekUndo()?.groupId === groupId);
    // Pushed in undo order, so the step undone last (the oldest of the group) is redone first.
    for (const entry of undone) this.redoStack.push(entry);
    this.emit();
    return undone.length > 0;
  }

  /** Redoes the top redo entry (whole group). Returns false when nothing. */
  redo(): boolean {
    const top = this.peekRedo();
    if (!top) return false;
    const redone: UndoEntry[] = [];
    const groupId = top.groupId;
    do {
      const entry = this.redoStack.pop()!;
      if (!this.applyRedo(entry)) break;
      redone.push(entry);
    } while (groupId !== 0 && this.peekRedo()?.groupId === groupId);
    // Pushed in redo order, which restores the original chronological order on the undo stack.
    for (const entry of redone) this.undoStack.push(entry);
    this.emit();
    return redone.length > 0;
  }

  /** Forgets all history (document closed/replaced). */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.openGroup = null;
    this.emit();
  }

  /** Drops the entries of one view (e.g. after Source re-parse re-created the model). */
  clearView(view: UndoView): void {
    const keep = (entry: UndoEntry) => entry.view !== view;
    const undo = this.undoStack.filter(keep);
    const redo = this.redoStack.filter(keep);
    this.undoStack.length = 0;
    this.undoStack.push(...undo);
    this.redoStack.length = 0;
    this.redoStack.push(...redo);
    this.emit();
  }

  /* ---------------------------------------------------------------------- */

  private applyUndo(entry: UndoEntry): boolean {
    return this.replay(entry, (adapter) => adapter.undo());
  }

  private applyRedo(entry: UndoEntry): boolean {
    return this.replay(entry, (adapter) => adapter.redo());
  }

  private replay(entry: UndoEntry, step: (adapter: ViewHistoryAdapter) => boolean): boolean {
    const adapter = this.adapters.get(entry.view);
    if (!adapter) return false;
    if (this.activeView !== entry.view) {
      this.activateView(entry.view);
      this.activeView = entry.view;
    }
    this.replaying = true;
    try {
      return step(adapter);
    } finally {
      this.replaying = false;
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** In-memory adapter: useful for tests and for simple form-diff histories. */
export class ArrayHistoryAdapter<T> implements ViewHistoryAdapter {
  private readonly past: T[] = [];
  private readonly future: T[] = [];

  constructor(private readonly apply: (change: T, direction: 'undo' | 'redo') => void = () => {}) {}

  push(change: T): void {
    this.past.push(change);
    this.future.length = 0;
  }

  undo(): boolean {
    const change = this.past.pop();
    if (change === undefined) return false;
    this.apply(change, 'undo');
    this.future.push(change);
    return true;
  }

  redo(): boolean {
    const change = this.future.pop();
    if (change === undefined) return false;
    this.apply(change, 'redo');
    this.past.push(change);
    return true;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get depth(): number {
    return this.past.length;
  }
}
