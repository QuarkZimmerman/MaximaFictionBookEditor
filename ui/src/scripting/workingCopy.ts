/**
 * The document a script run works on (data-model.md §5, research R8): the model JSON of the
 * run with an index `{nodeId -> node, parent, position}` kept current by every write. A write
 * changes only the working copy - no editor transaction, store notification or render; the
 * host shows the working copy in the editor before the script's dialogs and selection calls
 * and replaces the document with it when the run ends.
 *
 * Nodes of a document that was handed out (the document the run started from, or one shown in
 * the editor) are never changed: the first write below such a node copies the nodes on the way
 * from the root, once until the next hand-out, and later writes change those copies in place.
 *
 * Feature 005 (data-model §6.2, research R4.1): an AI request takes a `checkpoint()` before
 * every change tool and every nested script run and, when the change is rejected (FR-061),
 * returns to it with `rollback(cp)` - the document, the node index and the `changed` /
 * `pending` flags as they were. A checkpoint is a hand-out, so it costs O(1) and is never
 * mutated by the writes that follow; an accepted change simply drops it.
 */

import type { ModelNodeJson } from '@/editor/fromModel';
import type { Description, Document } from '@/model/document';

/** Where a node lies: its parent (null for a body), the children list holding it and its index. */
export interface NodePlace {
  node: ModelNodeJson;
  parent: ModelNodeJson | null;
  siblings: readonly ModelNodeJson[];
  index: number;
}

/** The state of a working copy at a `checkpoint()`: what `rollback(cp)` restores. */
export interface Checkpoint {
  /** The document as it was - handed out, so no later write touches it. */
  readonly document: Document;
  readonly changed: boolean;
  readonly pending: boolean;
}

interface Entry {
  node: ModelNodeJson;
  /** Entry of the parent node; null for a body (held by `document.bodies`). */
  parent: Entry | null;
  /** Position in the parent's content; checked on use (inserts and removals shift it). */
  index: number;
}

function nodeIdOf(node: ModelNodeJson): string | null {
  const id = node.attrs?.nodeId;
  return typeof id === 'string' && id ? id : null;
}

export class WorkingCopy {
  private doc: Document;
  private ids: Map<string, Entry> | null = null;
  /** Objects created since the document was last handed out: changed in place. */
  private owned = new WeakSet<object>();
  private changedValue = false;
  private pendingValue = false;

  constructor(document: Document) {
    this.doc = document;
  }

  /** The current document (do not keep it across writes: use `release()` for that). */
  get document(): Document {
    return this.doc;
  }

  /** True after any write. */
  get changed(): boolean {
    return this.changedValue;
  }

  /** True after a write that the last `release()` did not hand out. */
  get pending(): boolean {
    return this.pendingValue;
  }

  /** Hands the current document out: later writes leave it as it is. */
  release(): Document {
    this.owned = new WeakSet();
    this.pendingValue = false;
    return this.doc;
  }

  /** Takes `document` as the current state (a change made outside the working copy). */
  reset(document: Document): void {
    this.doc = document;
    this.ids = null;
    this.owned = new WeakSet();
    this.touch();
  }

  /**
   * Remembers the current state for `rollback()`: the document is handed out (every later
   * write copies on the way from the root, so the checkpoint's document is never mutated) and
   * the flags are kept with it. Not a `release()`: the checkpoint is no show of the document to
   * the editor, so `pending` stays as it is. O(1).
   */
  checkpoint(): Checkpoint {
    this.owned = new WeakSet();
    return { document: this.doc, changed: this.changedValue, pending: this.pendingValue };
  }

  /**
   * Returns to a checkpoint: the document, the node index (rebuilt from it on the next use)
   * and the `changed` / `pending` flags as they were - a `reset()` that restores the flags.
   * Writes made since are forgotten; the checkpoint stays valid for another rollback.
   */
  rollback(checkpoint: Checkpoint): void {
    this.doc = checkpoint.document;
    this.ids = null;
    this.owned = new WeakSet();
    this.changedValue = checkpoint.changed;
    this.pendingValue = checkpoint.pending;
  }

  place(nodeId: string): NodePlace | undefined {
    const entry = this.index().get(nodeId);
    if (!entry) return undefined;
    const siblings = this.siblingsOf(entry);
    return {
      node: entry.node,
      parent: entry.parent ? entry.parent.node : null,
      siblings,
      index: this.position(entry, siblings),
    };
  }

  /** Replaces the node (and its subtree) by `node`, which the working copy takes over. */
  replace(nodeId: string, node: ModelNodeJson): void {
    const entry = this.require(nodeId);
    const container = this.ownedContainer(entry);
    const index = this.position(entry, container);
    container[index] = node;
    this.unindex(entry.node);
    this.indexTree(node, entry.parent, index, true);
    this.touch();
  }

  /** Inserts `node` before / after the reference node or as its last child. */
  insert(where: 'before' | 'after' | 'append', refId: string, node: ModelNodeJson): void {
    const ref = this.require(refId);
    if (where === 'append') {
      const parent = this.own(ref);
      const content = (parent.content ??= []);
      content.push(node);
      this.indexTree(node, ref, content.length - 1, true);
    } else {
      const container = this.ownedContainer(ref);
      const index = this.position(ref, container) + (where === 'after' ? 1 : 0);
      container.splice(index, 0, node);
      this.indexTree(node, ref.parent, index, true);
    }
    this.touch();
  }

  remove(nodeId: string): void {
    const entry = this.require(nodeId);
    const container = this.ownedContainer(entry);
    container.splice(this.position(entry, container), 1);
    this.unindex(entry.node);
    this.touch();
  }

  setDescription(description: Description): void {
    this.ownDocument().description = description;
    this.touch();
  }

  /* ---------------------------------------------------------------- internals */

  private touch(): void {
    this.changedValue = true;
    this.pendingValue = true;
  }

  private index(): Map<string, Entry> {
    if (!this.ids) {
      this.ids = new Map();
      const bodies = this.doc.bodies as unknown as ModelNodeJson[];
      bodies.forEach((body, index) => this.indexTree(body, null, index, false));
    }
    return this.ids;
  }

  private require(nodeId: string): Entry {
    const entry = this.index().get(nodeId);
    if (!entry) throw new Error(`working copy: unknown nodeId "${nodeId}"`);
    return entry;
  }

  /** Indexes `node` and its descendants; `owned`: they are new objects nobody else holds. */
  private indexTree(node: ModelNodeJson, parent: Entry | null, index: number, owned: boolean) {
    const ids = this.index();
    const entry: Entry = { node, parent, index };
    const id = nodeIdOf(node);
    if (id) ids.set(id, entry);
    if (owned) this.owned.add(node);
    node.content?.forEach((child, childIndex) => {
      if (child.type !== 'text') this.indexTree(child, entry, childIndex, owned);
    });
  }

  private unindex(node: ModelNodeJson): void {
    const ids = this.index();
    const id = nodeIdOf(node);
    if (id && ids.get(id)?.node === node) ids.delete(id);
    for (const child of node.content ?? []) {
      if (child.type !== 'text') this.unindex(child);
    }
  }

  private siblingsOf(entry: Entry): readonly ModelNodeJson[] {
    return entry.parent
      ? (entry.parent.node.content ?? [])
      : (this.doc.bodies as unknown as ModelNodeJson[]);
  }

  private position(entry: Entry, siblings: readonly ModelNodeJson[]): number {
    if (siblings[entry.index] !== entry.node) entry.index = siblings.indexOf(entry.node);
    if (entry.index < 0) throw new Error('working copy: a node is missing from its parent');
    return entry.index;
  }

  private ownDocument(): Document {
    if (!this.owned.has(this.doc)) {
      this.doc = { ...this.doc };
      this.owned.add(this.doc);
    }
    return this.doc;
  }

  private ownBodies(): ModelNodeJson[] {
    const doc = this.ownDocument();
    if (!this.owned.has(doc.bodies)) {
      doc.bodies = [...doc.bodies];
      this.owned.add(doc.bodies);
    }
    return doc.bodies as unknown as ModelNodeJson[];
  }

  /** The children list holding the entry's node, changeable in place. */
  private ownedContainer(entry: Entry): ModelNodeJson[] {
    if (!entry.parent) return this.ownBodies();
    const parent = this.own(entry.parent);
    return (parent.content ??= []);
  }

  /** The entry's node made changeable: copied (with its children list) in place of the shared one. */
  private own(entry: Entry): ModelNodeJson {
    if (this.owned.has(entry.node)) return entry.node;
    const container = this.ownedContainer(entry);
    const index = this.position(entry, container);
    const copy: ModelNodeJson = entry.node.content
      ? { ...entry.node, content: [...entry.node.content] }
      : { ...entry.node };
    this.owned.add(copy);
    container[index] = copy;
    entry.node = copy;
    return copy;
  }
}
