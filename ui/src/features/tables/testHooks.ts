/**
 * The test hooks of the tables feature (feature 006; I27; data-model §16.4; quickstart §0.4):
 * `window.__mfbeTest.tables`, installed only for a page that asks for test hooks (`?test=1`)
 * or a core started with them. `grid(tableRef)` gives the summary of the table whose `nodeId`
 * is `tableRef` - the `data-node-id` of its `body-table` -, looked up in the store's document:
 * the bodies, both annotations and the history. US1 adds `placementSweep`, US2 `fuzz`.
 */

import type { FeatureContext } from '@/app/services';
import { gridOfModel, type TableSummary } from '@/editor/table/grid';
import type { AnnotationNode, BodyNode, Document, TableNode } from '@/model/document';

export interface TablesTestHooks {
  /** The grid summary of the table with that `nodeId`, null when no table has it. */
  grid(tableRef: string): TableSummary | null;
}

interface LooseNode {
  type?: unknown;
  attrs?: { nodeId?: unknown } | null;
  content?: unknown;
}

/** The model table whose `nodeId` is `nodeId`, in the bodies, both annotations and the history. */
export function findModelTable(doc: Document, nodeId: string): TableNode | null {
  let found: TableNode | null = null;
  const visit = (node: LooseNode) => {
    if (found || !node || typeof node !== 'object') return;
    if (node.type === 'table' && node.attrs?.nodeId === nodeId) {
      found = node as unknown as TableNode;
      return;
    }
    if (node.type === 'raw-xml' || node.type === 'text') return;
    if (Array.isArray(node.content)) for (const child of node.content) visit(child as LooseNode);
  };
  const trees: (BodyNode | AnnotationNode | undefined)[] = [
    ...doc.bodies,
    doc.description.titleInfo.annotation,
    doc.description.srcTitleInfo?.annotation,
    doc.description.documentInfo.history,
  ];
  for (const tree of trees) if (tree) visit(tree as unknown as LooseNode);
  return found;
}

/**
 * Assigns `__mfbeTest.tables` on the shared hook object, as the scripting hooks do; `ctx` is
 * the feature context `registerTablesFeature` holds (its store, the command registry, `undo`
 * and `rpc`, which US1's placement sweep and US2's fuzz host use too).
 */
export function installTablesTestHooks(ctx: FeatureContext): void {
  if (typeof window === 'undefined') return;
  const hooks: TablesTestHooks = {
    grid(tableRef) {
      const doc = ctx.store.getState().document;
      if (!doc || typeof tableRef !== 'string') return null;
      const table = findModelTable(doc, tableRef);
      return table ? { ...gridOfModel(table).summary } : null;
    },
  };
  const existing = window.__mfbeTest ?? {};
  window.__mfbeTest = Object.assign(existing, { tables: hooks });
}
