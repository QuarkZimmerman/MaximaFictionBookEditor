/**
 * The test hooks of the tables feature (feature 006; I27; data-model §16.4; quickstart §0.4):
 * `window.__mfbeTest.tables`, installed only for a page that asks for test hooks (`?test=1`)
 * or a core started with them. `grid(tableRef)` gives the summary of the table whose `nodeId`
 * is `tableRef` - the `data-node-id` of its `body-table` -, looked up in the store's document:
 * the bodies, both annotations and the history. `target()` (US10) describes the active table edit
 * target - the Body view's or a focused description field's - and its selection by node ids, so
 * the journeys see where a field's caret or block is. `placementSweep(positions)` (US1; C79; U18)
 * gives the Body editor's placement at each model point with the registry's state of
 * `insert.table` there. `fuzz(seed, steps)` (US2; SC-003; C76) runs the seeded fuzz on the Body
 * editor, every step validated by the core: its generator (`@/editor/table/testing/fuzz`) is
 * loaded by a dynamic import only when the hook is called, so no bundle imports it statically.
 */

import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { AllSelection, NodeSelection, type EditorState } from 'prosemirror-state';

import type { CommandContext } from '@/app/commands';
import type { FeatureContext } from '@/app/services';
import { findTablePointAt, type TablePoint } from '@/editor/commands/tableInsertion';
import { findNodeById } from '@/editor/schema';
import { gridOfModel, type TableSummary } from '@/editor/table/grid';
import { CellBlockSelection } from '@/editor/table/selection';
import i18next from '@/i18n';
import type { AnnotationNode, BodyNode, Document, TableNode } from '@/model/document';
import { collectBookIds } from '@/model/ids';
import { isRunLocked } from '@/model/store';
import type { ModelPoint } from '@/rpc/types';
import { getBodyController, hasBodyController, selectionFor } from '@/views/body/bodyEditor';

import { insertTableAvailability } from './commands';
import { activeTableTarget } from './target';

/** A `TablePoint` in model terms (data-model §16.4): node ids instead of positions. */
export type ModelLanding =
  | { kind: 'insert'; parent: string; after: string | null }
  | { kind: 'split'; node: string; offset: number }
  | { kind: 'replace'; node: string };

/** The placement at one model point (data-model §16.4). */
export interface PlacementAnswer {
  pos: ModelPoint;
  /** The registry's state of `insert.table` with the caret there (C79). */
  enabled: boolean;
  /** The code behind the unavailable text: `noTablePlace`, `noTarget`, `runLock.<kind>`. */
  reason: string | null;
  landing: ModelLanding | null;
}

/** The report of the fuzz run (`FuzzReport` of `@/editor/table/testing/fuzz`). */
export interface FuzzRunReport {
  seed: number;
  steps: number;
  /** The steps the core validated. */
  validations: number;
  /** The first failure: seed, step, command, selection, reason, the table before and after. */
  failures: unknown[];
  commands: string[];
}

/** The active table edit target and its selection, by node ids (US10). */
export interface TargetAnswer {
  kind: 'body' | 'description';
  /** `body`, or the field key (`titleInfo.annotation`, `srcTitleInfo.annotation`, …). */
  key: string;
  editable: boolean;
  selection: {
    type: 'text' | 'node' | 'cells' | 'all';
    empty: boolean;
    /** The node id of the text block or cell that holds the head, and the offset in it. */
    head: string | null;
    headOffset: number;
    anchor: string | null;
    anchorOffset: number;
    /** The block's cells in document order (`cells`). */
    cells: string[];
    /** The selected node (`node`). */
    node: string | null;
  };
}

export interface TablesTestHooks {
  /** The grid summary of the table with that `nodeId`, null when no table has it. */
  grid(tableRef: string): TableSummary | null;
  /** The active table edit target with its selection; null without one (US10). */
  target(): TargetAnswer | null;
  /**
   * The seeded fuzz of SC-003 on the Body editor (US2): `steps` commands drawn with `seed`, the
   * start tables at the end of the book's first section, Undo and Redo through the undo
   * coordinator, every step validated by the core (`doc.validate`).
   */
  fuzz(seed: number, steps: number): Promise<FuzzRunReport>;
  /**
   * The Body editor's placement at each point, in input order: the caret put there (a
   * selection only), the registry's state of `insert.table`, its reason and the point FR-004
   * finds; the selection found is restored and no document changes. Throws for a point whose
   * text block is not in the Body editor's document.
   */
  placementSweep(positions: readonly ModelPoint[]): PlacementAnswer[];
}

function nodeIdOf(node: PMNode | null | undefined): string | null {
  const id = node?.attrs.nodeId;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** The node id of the innermost node with one around `$pos`. */
function holderOf($pos: ResolvedPos): string | null {
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const id = nodeIdOf($pos.node(depth));
    if (id) return id;
  }
  return null;
}

/** A selection in node-id terms (`TargetAnswer.selection`). */
function describeSelection(state: EditorState): TargetAnswer['selection'] {
  const { selection } = state;
  const cells =
    selection instanceof CellBlockSelection
      ? selection.cellPositions().map((pos) => nodeIdOf(state.doc.nodeAt(pos)) ?? '')
      : [];
  return {
    type:
      selection instanceof CellBlockSelection
        ? 'cells'
        : selection instanceof NodeSelection
          ? 'node'
          : selection instanceof AllSelection
            ? 'all'
            : 'text',
    empty: selection.empty,
    head: holderOf(selection.$head),
    headOffset: selection.$head.parentOffset,
    anchor: holderOf(selection.$anchor),
    anchorOffset: selection.$anchor.parentOffset,
    cells,
    node: selection instanceof NodeSelection ? nodeIdOf(selection.node) : null,
  };
}

/** A point in the Body editor's document in model terms (the blocks by `FIXED_BLOCK_IDS`). */
export function modelLanding(doc: PMNode, point: TablePoint): ModelLanding {
  if (point.kind === 'replace') return { kind: 'replace', node: nodeIdOf(doc.nodeAt(point.from))! };
  const $pos = doc.resolve(point.pos);
  if (point.kind === 'split') {
    return { kind: 'split', node: nodeIdOf($pos.parent)!, offset: $pos.parentOffset };
  }
  return { kind: 'insert', parent: nodeIdOf($pos.parent)!, after: nodeIdOf($pos.nodeBefore) };
}

/** The code behind `insert.table`'s unavailable text (data-model §9.6). */
function insertTableReason(ctx: FeatureContext, commandCtx: CommandContext): string {
  const state = ctx.store.getState();
  const spec = ctx.commands.get('insert.table');
  if (isRunLocked(state) && spec?.duringScriptRun !== 'allowed') {
    return `runLock.${state.runLock!.kind}`;
  }
  const answer = insertTableAvailability(commandCtx);
  if ('ok' in answer) return 'noTarget';
  return answer.refused === 'source' ? `source.${answer.verdict.code}` : answer.refused;
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
    target() {
      const target = activeTableTarget(ctx.store);
      const state = target?.state;
      if (!target || !state) return null;
      return {
        kind: target.kind,
        key: target.key,
        editable: target.editable,
        selection: describeSelection(state),
      };
    },
    placementSweep(positions) {
      if (!hasBodyController(ctx.store)) throw new Error('placementSweep: no Body editor');
      const controller = getBodyController(ctx.store);
      const start = controller.editorState;
      if (!start) throw new Error('placementSweep: the Body editor shows no document');
      // A wrong list fails at once, before the selection moves.
      for (const point of positions) {
        if (!findNodeById(start.doc, point.nodeId)?.node.isTextblock) {
          throw new Error(`placementSweep: no text block ${point.nodeId} in the Body editor`);
        }
      }
      const commandCtx = {
        store: ctx.store,
        rpc: ctx.rpc ?? null,
        undo: ctx.undo,
        hotkeys: ctx.hotkeys,
        carets: ctx.carets,
        t: i18next.t,
        version: '',
      } as unknown as CommandContext;
      try {
        return positions.map((point) => {
          const state = controller.editorState!;
          controller.apply(
            state.tr.setSelection(selectionFor(state.doc, point.nodeId, point.offset)!),
          );
          const enabled = ctx.commands.isEnabled('insert.table', commandCtx);
          const reason = enabled ? null : insertTableReason(ctx, commandCtx);
          const now = controller.editorState!;
          const found = findTablePointAt(now);
          return {
            pos: { nodeId: point.nodeId, offset: point.offset },
            enabled,
            reason,
            landing: found ? modelLanding(now.doc, found) : null,
          };
        });
      } finally {
        const state = controller.editorState;
        if (state && state.doc === start.doc) {
          controller.apply(state.tr.setSelection(start.selection));
        }
      }
    },
    async fuzz(seed, steps) {
      const { createTargetHost, runFuzz } = await import('@/editor/table/testing/fuzz');
      const target = activeTableTarget(ctx.store);
      if (!target || !target.editable) throw new Error('fuzz: no editable Body view');
      const rpc = ctx.rpc ?? null;
      const validate = rpc
        ? async () => {
            const document = ctx.store.getState().document;
            if (!document) throw new Error('fuzz: no document');
            const report = await rpc.runJob('doc.validate', { docId: document.docId, document });
            return report.errorCount;
          }
        : undefined;
      const host = createTargetHost(target, {
        undo: () => ctx.undo.undo(),
        redo: () => ctx.undo.redo(),
        validate,
        // The pasted ids are checked against the whole book (US4; C47).
        bookIds: () => {
          const document = ctx.store.getState().document;
          return document ? collectBookIds(document) : new Set<string>();
        },
      });
      return runFuzz(host, { seed, steps });
    },
  };
  const existing = window.__mfbeTest ?? {};
  window.__mfbeTest = Object.assign(existing, { tables: hooks });
}
