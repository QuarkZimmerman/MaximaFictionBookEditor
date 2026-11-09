/**
 * Feature 011 (US11; D41; constitution 3.3.0 power (e); contracts/script-api.md, contracts/tree.md
 * §1, §4, §5; data-model "Tree-script rows"): the rows tree scripts show in the Document tree, per
 * window and document - for each script its entries (a node, an optional caption), its name and
 * icon. Display only: nothing of it is in the book or saved. A script's next run replaces its rows;
 * *Clean* removes every script's, a row's *Clean* that row; a row goes with its node; all of them
 * go when the book closes or another opens.
 */
import type { ModelNodeJson } from '@/editor/fromModel';
import type { AppStore } from '@/model/store';
import type { Document } from '@/model/document';

export interface ScriptRowEntry {
  nodeId: string;
  caption?: string;
}

/** One script's rows. */
export interface ScriptRowSet {
  scriptId: string;
  /** The script's name in the interface language: the caption of an entry without one. */
  name: string;
  iconUrl?: string;
  entries: readonly ScriptRowEntry[];
}

const PREFIX = 'script:';

/** The row id of a script's entry: never an element's id (those are NCNames without `:`). */
export function scriptRowId(scriptId: string, nodeId: string): string {
  return `${PREFIX}${encodeURIComponent(scriptId)}:${nodeId}`;
}

/** The script and node of a script row's id; null for any other row. */
export function parseScriptRowId(rowId: string | null | undefined): {
  scriptId: string;
  nodeId: string;
} | null {
  if (!rowId || !rowId.startsWith(PREFIX)) return null;
  const rest = rowId.slice(PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return null;
  return { scriptId: decodeURIComponent(rest.slice(0, colon)), nodeId: rest.slice(colon + 1) };
}

export function isScriptRowId(rowId: string | null | undefined): boolean {
  return parseScriptRowId(rowId) !== null;
}

/** The element a row stands for: a script row's node, else the row's own id. */
export function nodeIdOfRow(rowId: string): string {
  return parseScriptRowId(rowId)?.nodeId ?? rowId;
}

/** Every element id of the book: its bodies and the description's two blocks. */
export function documentNodeIds(document: Document): Set<string> {
  const ids = new Set<string>();
  const visit = (node: ModelNodeJson | undefined) => {
    if (!node || node.type === 'text') return;
    const id = node.attrs?.nodeId;
    if (typeof id === 'string' && id) ids.add(id);
    for (const child of node.content ?? []) visit(child);
  };
  visit(document.description.titleInfo.annotation as unknown as ModelNodeJson | undefined);
  visit(document.description.documentInfo.history as unknown as ModelNodeJson | undefined);
  for (const body of document.bodies) visit(body as unknown as ModelNodeJson);
  return ids;
}

export class ScriptRows {
  private sets: ReadonlyMap<string, ScriptRowSet> = new Map();
  private readonly listeners = new Set<() => void>();

  constructor(store: AppStore) {
    store.subscribe((state, previous) => {
      if (state.docId !== previous.docId) this.replace(new Map());
      else if (state.document !== previous.document && state.document && this.sets.size > 0) {
        this.prune(documentNodeIds(state.document));
      }
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): ReadonlyMap<string, ScriptRowSet> => this.sets;

  get hasRows(): boolean {
    return this.sets.size > 0;
  }

  private replace(next: ReadonlyMap<string, ScriptRowSet>): void {
    if (next === this.sets || (next.size === 0 && this.sets.size === 0)) return;
    this.sets = next;
    for (const listener of [...this.listeners]) listener();
  }

  /** Shows `set` in place of the script's earlier rows (each node once); none removes them. */
  show(set: ScriptRowSet): number {
    const seen = new Set<string>();
    const entries = set.entries.filter((entry) => {
      if (seen.has(entry.nodeId)) return false;
      seen.add(entry.nodeId);
      return true;
    });
    const next = new Map(this.sets);
    if (entries.length > 0) next.set(set.scriptId, { ...set, entries });
    else next.delete(set.scriptId);
    this.replace(next);
    return entries.length;
  }

  /** Removes one script's rows, or every script's (*Clean*). */
  clear(scriptId?: string): void {
    if (scriptId === undefined) {
      this.replace(new Map());
      return;
    }
    if (!this.sets.has(scriptId)) return;
    const next = new Map(this.sets);
    next.delete(scriptId);
    this.replace(next);
  }

  /** Removes every script's rows but `scriptId`'s (Ctrl+choosing a script). */
  clearOthers(scriptId: string): void {
    const kept = this.sets.get(scriptId);
    this.replace(kept ? new Map([[scriptId, kept]]) : new Map());
  }

  /** The row's *Clean*: removes one entry. */
  cleanRow(scriptId: string, nodeId: string): void {
    const set = this.sets.get(scriptId);
    if (!set) return;
    this.show({ ...set, entries: set.entries.filter((entry) => entry.nodeId !== nodeId) });
  }

  /** Drops the entries whose node is no longer in the book. */
  private prune(ids: ReadonlySet<string>): void {
    let changed = false;
    const next = new Map<string, ScriptRowSet>();
    for (const [scriptId, set] of this.sets) {
      const entries = set.entries.filter((entry) => ids.has(entry.nodeId));
      if (entries.length !== set.entries.length) changed = true;
      if (entries.length > 0) {
        next.set(scriptId, entries.length === set.entries.length ? set : { ...set, entries });
      }
    }
    if (changed) this.replace(next);
  }
}

const perStore = new WeakMap<AppStore, ScriptRows>();

/** The script rows of a window. */
export function getScriptRows(store: AppStore): ScriptRows {
  let rows = perStore.get(store);
  if (!rows) {
    rows = new ScriptRows(store);
    perStore.set(store, rows);
  }
  return rows;
}
