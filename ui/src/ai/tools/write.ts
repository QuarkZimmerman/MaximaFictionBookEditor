/**
 * Structural writes of the change tools (feature 005 T054; ai-catalogue §3.3; data-model §6.3):
 * `replace`, `insert` and `remove` at an entry of the catalogue's document index. Nodes of the
 * bodies go through the working copy's own writes (`replace` / `insert` / `remove`, which keep
 * its node index current); nodes under a description root (`title-info/annotation[1]`,
 * `src-title-info/annotation[1]`, `document-info/history[1]` - the 004 path grammar admits
 * them as change targets and the working copy does not index them) are rewritten immutably
 * along their ancestry and stored with `setDescription`, so that the documents handed out at
 * earlier checkpoints are never mutated (the working copy's contract).
 */

import type { ModelNodeJson } from '@/editor/fromModel';
import type { AnnotationNode, Description } from '@/model/document';
import type { WorkingCopy } from '@/scripting/workingCopy';

import { ancestry, nodeIdOf, type Entry } from './model';

type DescriptionPlace = 'titleInfo.annotation' | 'srcTitleInfo.annotation' | 'documentInfo.history';

/** The description roots a structural path may name, and where each lives. */
const DESCRIPTION_ROOTS: Record<string, DescriptionPlace> = {
  'title-info/annotation[1]': 'titleInfo.annotation',
  'src-title-info/annotation[1]': 'srcTitleInfo.annotation',
  'document-info/history[1]': 'documentInfo.history',
};

/** True when the entry lies under a description root rather than in a body. */
export function inDescription(entry: Entry): boolean {
  return entry.root in DESCRIPTION_ROOTS;
}

/** One structural write: a node in place of the entry, its removal, or nodes beside / inside it. */
export type StructuralWrite =
  | { kind: 'replace'; node: ModelNodeJson }
  | { kind: 'remove' }
  | { kind: 'insert'; where: 'before' | 'after' | 'append'; nodes: ModelNodeJson[] };

/** Applies a write at `entry` on the working copy. */
export function writeAt(copy: WorkingCopy, entry: Entry, write: StructuralWrite): void {
  if (inDescription(entry)) {
    const root = rewriteRoot(entry, write);
    copy.setDescription(withRoot(copy.document.description, entry.root, root));
    return;
  }
  const id = nodeIdOf(entry.node);
  switch (write.kind) {
    case 'replace':
      copy.replace(id, write.node);
      return;
    case 'remove':
      copy.remove(id);
      return;
    case 'insert':
      if (write.where === 'before') {
        // Each node goes right before the reference: the order is kept.
        for (const node of write.nodes) copy.insert('before', id, node);
      } else {
        // The first node after the reference (or as its last child), the rest each after the
        // previous one.
        let previous: { where: 'after' | 'append'; id: string } = { where: write.where, id };
        for (const node of write.nodes) {
          copy.insert(previous.where, previous.id, node);
          previous = { where: 'after', id: nodeIdOf(node) };
        }
      }
      return;
  }
}

/**
 * Replaces several nodes at once (`replace_all`): the bodies' nodes through the working copy,
 * the nodes under one description root in **one** rewrite of that root - the entries were
 * resolved before the first write, so a second rewrite of the same root would start from the
 * old root and lose the first.
 */
export function replaceEach(
  copy: WorkingCopy,
  replacements: readonly { entry: Entry; node: ModelNodeJson }[],
): void {
  const byRoot = new Map<string, { root: Entry; swaps: Map<ModelNodeJson, ModelNodeJson> }>();
  for (const { entry, node } of replacements) {
    if (!inDescription(entry)) {
      copy.replace(nodeIdOf(entry.node), node);
      continue;
    }
    let group = byRoot.get(entry.root);
    if (!group) {
      group = { root: ancestry(entry)[0]!, swaps: new Map() };
      byRoot.set(entry.root, group);
    }
    group.swaps.set(entry.node, node);
  }
  for (const [rootPath, { root, swaps }] of byRoot) {
    const swap = (node: ModelNodeJson): ModelNodeJson => {
      const replacement = swaps.get(node);
      if (replacement) return replacement;
      if (!node.content) return node;
      return { ...node, content: node.content.map(swap) };
    };
    copy.setDescription(withRoot(copy.document.description, rootPath, swap(root.node)));
  }
}

/**
 * The description root of `entry` with `write` applied at the entry, rebuilt immutably along
 * the ancestry (`chain[0]` is the root, the last link the entry); `undefined` when the root
 * itself is removed.
 */
function rewriteRoot(entry: Entry, write: StructuralWrite): ModelNodeJson | undefined {
  const chain = ancestry(entry);
  const last = chain.length - 1;
  if (last === 0 && write.kind === 'insert' && write.where !== 'append') {
    throw new Error('a description root has no siblings');
  }
  const rebuild = (level: number, node: ModelNodeJson): ModelNodeJson | undefined => {
    if (level === last) {
      switch (write.kind) {
        case 'replace':
          return write.node;
        case 'remove':
          return undefined;
        case 'insert':
          return { ...node, content: [...(node.content ?? []), ...write.nodes] };
      }
    }
    const target = chain[level + 1]!.node;
    const children = [...(node.content ?? [])];
    const at = children.indexOf(target);
    if (at < 0) throw new Error('the node is missing from its parent');
    if (level + 1 === last && write.kind === 'insert' && write.where !== 'append') {
      children.splice(write.where === 'before' ? at : at + 1, 0, ...write.nodes);
      return { ...node, content: children };
    }
    const rebuilt = rebuild(level + 1, target);
    if (rebuilt === undefined) children.splice(at, 1);
    else children[at] = rebuilt;
    return { ...node, content: children };
  };
  return rebuild(0, chain[0]!.node);
}

/** The description with the root at `rootPath` replaced by `node` (removed when `undefined`). */
function withRoot(
  description: Description,
  rootPath: string,
  node: ModelNodeJson | undefined,
): Description {
  const annotation = node as AnnotationNode | undefined;
  switch (DESCRIPTION_ROOTS[rootPath]) {
    case 'titleInfo.annotation': {
      const { annotation: _old, ...rest } = description.titleInfo;
      void _old;
      return { ...description, titleInfo: { ...rest, ...(annotation ? { annotation } : {}) } };
    }
    case 'srcTitleInfo.annotation': {
      if (!description.srcTitleInfo) return description;
      const { annotation: _old, ...rest } = description.srcTitleInfo;
      void _old;
      return {
        ...description,
        srcTitleInfo: { ...rest, ...(annotation ? { annotation } : {}) },
      };
    }
    case 'documentInfo.history': {
      const { history: _old, ...rest } = description.documentInfo;
      void _old;
      return {
        ...description,
        documentInfo: { ...rest, ...(annotation ? { history: annotation } : {}) },
      };
    }
    default:
      throw new Error(`unknown description root "${rootPath}"`);
  }
}
