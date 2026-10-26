/**
 * Table bar (T062/T063, FR-023; feature 006 US7, FR-020 to FR-022): every attribute the schema
 * gives tables, rows and cells - Table ID, Table Style, the cell's ID, style and language,
 * colspan, rowspan, tr align, th/td align and valign - on the table of the active table edit
 * target (`activeTableTarget`: the Body view; the description fields' come with US10), not the
 * Body controller's caret. It follows the target's selection: a caret in a cell, or a block of
 * cells, whose block-wide fields - style, language, align and valign of every cell of the block,
 * tr align of every row it covers - show the value all targets share, or stay empty with
 * `data-mixed="true"`, while Cell ID, colspan and rowspan show and edit the head cell, the cell
 * where the selection ends (FR-021). *Cell language* offers the editor's languages
 * (`resources.languages`) as suggestions and takes any language tag. The fields are disabled
 * without a cell or a block of the target's table, for a whole table selected and while a script
 * or an assistant request runs.
 *
 * Each commit is one plan of `editor/table/attrs.ts` run through `planCommand` - one undo step,
 * nothing for a value equal to the current one - on the target's current state, and only while
 * its table is the one the field showed (nodes addressed by node id, not by positions taken at
 * render time). A refused id or language names its reason in the status bar and the field shows
 * the current value again (FR-022; no message box). Text fields apply on Enter / blur, the
 * alignment lists at once. colspan and rowspan (feature 006 US8, FR-036) run the span plan on the
 * head cell: a larger value merges as *Merge cells* would - asking first when a linked cell would
 * go (FR-015; `runWithLinkCheck`) -, a smaller one, 1 or an empty field splits as *Split cell*
 * would; a span past the edge, a value that is no whole number of 1 or more and a growth a merged
 * cell above or to the left reaches are refused with a status message and the field restored. On
 * a table too large to edit both are disabled with the reason as their title (data-model §10.1).
 */

import type { TFunction } from 'i18next';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { ALIGN_VALUES, VALIGN_VALUES } from '@/editor/commands/table';
import {
  cellTargets,
  headCell,
  planCellAttrs,
  planRowAlign,
  planSpan,
  planTableAttrs,
  rowTargets,
  type CellAttrValues,
  type SpanAxis,
} from '@/editor/table/attrs';
import { planCommand, type TablePlan } from '@/editor/table/commands';
import {
  gridCellNode,
  isRefusal,
  tableTarget,
  type PlanContext,
  type Refusal,
  type TableTarget,
} from '@/editor/table/edit';
import { runWithLinkCheck } from '@/features/tables/confirm';
import { reasonText } from '@/features/tables/reasons';
import {
  activeTableTarget,
  subscribeTableTargets,
  type TableEditTarget,
} from '@/features/tables/target';
import { collectBookIds } from '@/model/ids';
import { actions, isRunLocked, useAppState, type AppStore } from '@/model/store';
import { localName, useResourceCatalogs } from '@/views/description/resources';

import { BarTextField } from './LinksBar';
import { useAppServices, useCommandContext } from './services';

interface BarSelectProps {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  disabled: boolean;
  /** The targets' values differ: the list shows the empty entry and `data-mixed="true"`. */
  mixed?: boolean;
  onChange: (value: string) => void;
}

function BarSelect({
  id,
  label,
  value,
  options,
  disabled,
  mixed = false,
  onChange,
}: BarSelectProps) {
  return (
    <label className="mfbe-bar-field" htmlFor={`${id}-input`}>
      <span className="mfbe-bar-label">{label}</span>
      <select
        id={`${id}-input`}
        className="mfbe-bar-input mfbe-bar-select"
        value={disabled ? '' : value}
        disabled={disabled}
        data-testid={id}
        data-mixed={mixed && !disabled ? 'true' : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option || '-'} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ------------------------------------------------------------------------ */
/* The bar's context (data-model §10.1)                                     */
/* ------------------------------------------------------------------------ */

interface TargetSnapshot {
  target: TableEditTarget | null;
  state: EditorState | null;
  editable: boolean;
}

/**
 * The active table edit target with its state, as an external store: `subscribeTableTargets`
 * fires on activation changes and on the target's selection and document changes; the snapshot
 * is the same object while nothing of it changed.
 */
function useActiveTableTarget(store: AppStore): TargetSnapshot {
  const last = useRef<TargetSnapshot>({ target: null, state: null, editable: false });
  const subscribe = useCallback(
    (listener: () => void) => subscribeTableTargets(store, listener),
    [store],
  );
  const snapshot = useCallback((): TargetSnapshot => {
    const target = activeTableTarget(store);
    const state = target?.state ?? null;
    const editable = !!target?.editable;
    const previous = last.current;
    if (previous.target === target && previous.state === state && previous.editable === editable) {
      return previous;
    }
    last.current = { target, state, editable };
    return last.current;
  }, [store]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** What the fields show and act on (`TableBarContext`, data-model §10.1). */
interface TableBarContext {
  target: TableEditTarget;
  /** The selection's target: the table's position, the selection kind and the address. */
  found: TableTarget;
  table: PMNode;
  /** The head cell: the cell that holds `$head`. */
  head: PMNode | null;
  /** The cells of the block-wide fields: the block's cells, or the head cell. */
  cells: PMNode[];
  /** The rows of *Row align*: the block's rows, or the head cell's row. */
  rows: PMNode[];
}

/**
 * The context of an editable target whose selection is a caret or a text selection in one cell,
 * or a block of cells; null otherwise - no target, a whole table selected or a selection that
 * reaches outside the table (data-model §5.5). The targets are the plans' own (`cellTargets`,
 * `rowTargets`, `headCell`), so a field shows exactly what a commit changes.
 */
function barContext({ target, state, editable }: TargetSnapshot): TableBarContext | null {
  if (!target || !state || !editable) return null;
  const found = tableTarget(state);
  if (!found || (found.selection !== 'cell' && found.selection !== 'block')) return null;
  const { address } = found;
  const head = headCell(address)?.node ?? null;
  const cells = cellTargets(address);
  const rows = rowTargets(address);
  return {
    target,
    found,
    table: address.table,
    head,
    cells: Array.isArray(cells)
      ? cells.map((index) => gridCellNode(address.table, address.grid, index))
      : head
        ? [head]
        : [],
    rows: Array.isArray(rows)
      ? rows.map((r) => address.table.child(address.grid.rowChild[r]!))
      : [],
  };
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** The value of `name` that every node shares, or `''` and `mixed` when they differ. */
function shared(nodes: readonly PMNode[], name: string): { value: string; mixed: boolean } {
  if (nodes.length === 0) return { value: '', mixed: false };
  const first = text(nodes[0]!.attrs[name]);
  for (const node of nodes) {
    if (text(node.attrs[name]) !== first) return { value: '', mixed: true };
  }
  return { value: first, mixed: false };
}

/** The status-bar text of a refusal (FR-022; resource-formats §9 `tables.msg.*`). */
function refusalText(refusal: Refusal, t: TFunction): string {
  switch (refusal.refused) {
    case 'invalid-id':
      return t('tables.msg.idInvalid');
    case 'duplicate-id':
      return t('tables.msg.idInUse', { id: refusal.params.id });
    case 'invalid-lang':
      return t('tables.msg.langInvalid', { value: refusal.params.value });
    case 'span-past-edge':
      return t('tables.msg.spanPastEnd');
    default:
      return reasonText(refusal, t);
  }
}

/** A span field's value (FR-036): `''` is 1, a whole number of 1 or more itself, else null. */
function spanValue(input: string): number | null {
  const text = input.trim();
  if (text === '') return 1;
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 ? value : null;
}

/* ------------------------------------------------------------------------ */
/* The bar                                                                  */
/* ------------------------------------------------------------------------ */

export function TableBar() {
  const { t, i18n } = useTranslation();
  const { store, rpc } = useAppServices();
  const commandCtx = useCommandContext();
  const runLocked = useAppState(isRunLocked, store);
  const connected = useAppState((s) => s.connection === 'connected', store);
  const uiLanguage = useAppState((s) => s.uiLanguage, store);
  const { languages } = useResourceCatalogs(rpc, connected);
  const snapshot = useActiveTableTarget(store);
  const context = useMemo(() => barContext(snapshot), [snapshot]);
  const inTable = !!context && !runLocked;
  // The table a text field showed when it took the focus: its commit acts only on that table.
  const focusedTable = useRef<string | null>(null);
  const shownTable = context ? text(context.table.attrs.nodeId) : null;

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: { code: string; name: string }[] = [];
    for (const group of languages.groups) {
      for (const entry of group.languages) {
        if (seen.has(entry.code)) continue;
        seen.add(entry.code);
        out.push({ code: entry.code, name: localName(entry.name, uiLanguage, entry.code) });
      }
    }
    return out;
  }, [languages, uiLanguage]);

  /** The target, its state and its selection's table, while that table is `table`. */
  const current = (table: string | null) => {
    const target = activeTableTarget(store);
    const state = target?.state;
    if (!target || !state || !target.editable || isRunLocked(store.getState())) return null;
    const found = tableTarget(state);
    if (!found || (found.selection !== 'cell' && found.selection !== 'block')) return null;
    if (table === null || text(found.address.table.attrs.nodeId) !== table) return null;
    return { target, state, found };
  };

  /**
   * Runs `plan` on the target's current state (data-model §10.1): a dry run with the target's
   * node ids and the book's ids - a refusal names its reason in the status bar -, then the plan
   * through `planCommand` as one step. False when nothing was applied: another table, a refusal
   * or a value equal to the current one; the field then shows the current value again.
   */
  const runPlan = (plan: TablePlan, table: string | null): boolean => {
    const found = current(table);
    if (!found) return false;
    const { target } = found;
    const document = store.getState().document;
    const ctx: PlanContext = {
      nextId: () => target.nextNodeId(),
      bookIds: document ? collectBookIds(document) : undefined,
    };
    const dryRun = plan(found.found.address, ctx);
    if (isRefusal(dryRun)) {
      actions.setStatusMessage(store, refusalText(dryRun, i18n.t));
      return false;
    }
    return target.run(planCommand(plan, ctx));
  };

  /**
   * colspan / rowspan (FR-036; data-model §4.7, §10.1): the value checked by the field itself
   * (`tables.msg.spanInvalid`), then a dry run of the span plan on the head cell - a refusal
   * names its reason in the status bar (`tables.msg.spanPastEnd`, `merge-needs-block`'s words) -,
   * then the plan through `runWithLinkCheck`, which asks the FR-015 question when cells with
   * linked ids would go: No dispatches nothing and records no step, and the field shows the
   * current value again once the answer is in.
   */
  const setSpan = (axis: SpanAxis, input: string): boolean | Promise<boolean> => {
    const value = spanValue(input);
    if (value === null) {
      actions.setStatusMessage(store, i18n.t('tables.msg.spanInvalid'));
      return false;
    }
    const found = current(textTable());
    if (!found) return false;
    const { target } = found;
    const plan: TablePlan = (address, ctx) => planSpan(address, { axis, value }, ctx);
    const document = store.getState().document;
    const dryRun = plan(found.found.address, {
      nextId: () => target.nextNodeId(),
      bookIds: document ? collectBookIds(document) : undefined,
    });
    if (isRefusal(dryRun)) {
      actions.setStatusMessage(store, refusalText(dryRun, i18n.t));
      return false;
    }
    return runWithLinkCheck(commandCtx, target, plan);
  };

  /** A text field's commit acts on the table it showed when it took the focus. */
  const textTable = () => focusedTable.current;

  const setCells = (values: CellAttrValues, table: string | null) =>
    runPlan((address, ctx) => planCellAttrs(address, values, ctx), table);

  const head = context?.head ?? null;
  const cells = context?.cells ?? [];
  const rows = context?.rows ?? [];
  const tableAttr = (name: string) => (context ? text(context.table.attrs[name]) : '');
  const headAttr = (name: string) => (head ? text(head.attrs[name]) : '');
  const style = shared(cells, 'style');
  const lang = shared(cells, 'lang');
  const align = shared(cells, 'align');
  const valign = shared(cells, 'valign');
  const rowAlign = shared(rows, 'align');
  const disabled = !inTable;
  // The span plan reads positions: on a table too large to edit its fields say why (§10.1).
  const tooLarge = !!context?.found.address.grid.tooLarge;
  const spanTitle = tooLarge ? reasonText({ refused: 'too-large' }, t) : undefined;

  return (
    <div
      className="mfbe-toolbar mfbe-bar mfbe-tablebar"
      role="toolbar"
      aria-label={t('toolbar.table')}
      data-testid="tablebar"
      data-in-table={inTable ? 'true' : 'false'}
      onFocus={() => {
        focusedTable.current = shownTable;
      }}
    >
      <BarTextField
        id="table-bar-table-id"
        label={t('tableBar.tableId')}
        value={tableAttr('id')}
        disabled={disabled}
        focusKey="tableId"
        onCommit={(value) =>
          runPlan((address, ctx) => planTableAttrs(address, { id: value }, ctx), textTable())
        }
      />
      <BarTextField
        id="table-bar-table-style"
        label={t('tableBar.tableStyle')}
        value={tableAttr('style')}
        disabled={disabled}
        width={100}
        onCommit={(value) =>
          runPlan((address, ctx) => planTableAttrs(address, { style: value }, ctx), textTable())
        }
      />
      <BarTextField
        id="table-bar-cell-id"
        label={t('linksBar.id')}
        value={headAttr('id')}
        disabled={disabled || !head}
        onCommit={(value) => setCells({ id: value }, textTable())}
      />
      <BarTextField
        id="table-bar-style"
        label={t('tableBar.style')}
        value={style.value}
        mixed={style.mixed}
        disabled={disabled || cells.length === 0}
        width={90}
        onCommit={(value) => setCells({ style: value }, textTable())}
      />
      <BarTextField
        id="table-bar-lang"
        label={t('tableBar.lang')}
        value={lang.value}
        mixed={lang.mixed}
        disabled={disabled || cells.length === 0}
        width={70}
        list="table-bar-lang-options"
        onCommit={(value) => setCells({ lang: value }, textTable())}
      />
      <datalist id="table-bar-lang-options">
        {suggestions.map((entry) => (
          <option key={entry.code} value={entry.code} label={entry.name} />
        ))}
      </datalist>
      <BarTextField
        id="table-bar-colspan"
        label={t('tableBar.colspan')}
        value={headAttr('colspan')}
        disabled={disabled || !head || tooLarge}
        title={spanTitle}
        width={40}
        onCommit={(value) => setSpan('colspan', value)}
      />
      <BarTextField
        id="table-bar-rowspan"
        label={t('tableBar.rowspan')}
        value={headAttr('rowspan')}
        disabled={disabled || !head || tooLarge}
        title={spanTitle}
        width={40}
        onCommit={(value) => setSpan('rowspan', value)}
      />
      <BarSelect
        id="table-bar-tr-align"
        label={t('tableBar.trAlign')}
        value={rowAlign.value}
        mixed={rowAlign.mixed}
        options={ALIGN_VALUES}
        disabled={disabled || rows.length === 0}
        onChange={(value) =>
          void runPlan((address, ctx) => planRowAlign(address, { align: value }, ctx), shownTable)
        }
      />
      <BarSelect
        id="table-bar-td-align"
        label={t('tableBar.tdAlign')}
        value={align.value}
        mixed={align.mixed}
        options={ALIGN_VALUES}
        disabled={disabled || cells.length === 0}
        onChange={(value) => void setCells({ align: value }, shownTable)}
      />
      <BarSelect
        id="table-bar-td-valign"
        label={t('tableBar.tdValign')}
        value={valign.value}
        mixed={valign.mixed}
        options={VALIGN_VALUES}
        disabled={disabled || cells.length === 0}
        onChange={(value) => void setCells({ valign: value }, shownTable)}
      />
    </div>
  );
}
