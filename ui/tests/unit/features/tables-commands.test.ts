/**
 * The table commands' availability and reasons (feature 006, T041; I6; C21; data-model §2.5,
 * §6.5, §9.1, §9.6; research R2.17): the host refusals, `too-large` before every other
 * refusal and only for the commands that read positions, no node built and the cached grid
 * read, `reasonText` for every code and leaf in the three catalogues, and a command built from
 * a row of the command table. Each story adds "availability agrees with every plan's dry run"
 * for its commands: US2 (T072) its twelve row and column commands.
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from '@testing-library/react';
import { createInstance, type TFunction } from 'i18next';
import { NodeType, type Node as PMNode } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';

import { createCommandRegistry, unavailableTitle } from '@/app/commands';
import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import {
  availability,
  planCommand,
  POSITION_COMMANDS,
  registerAvailabilityCheck,
  TABLE_COMMAND_NAMES,
  TABLE_SELECTION_COMMANDS,
  type TableCommandName,
  type TablePlan,
} from '@/editor/table/commands';
import {
  REFUSAL_CODES,
  gridCellNode,
  isRefusal,
  tableTarget,
  type Refusal,
} from '@/editor/table/edit';
import { gridOfNode } from '@/editor/table/grid';
import {
  caretAt,
  crossedLines,
  planDeleteColumns,
  planDeleteRows,
  planDuplicateColumns,
  planDuplicateRows,
  planInsertColumns,
  planInsertRows,
  planMoveColumns,
  planMoveRows,
} from '@/editor/table/ops';
import { CellBlockSelection } from '@/editor/table/selection';
import { fb2Schema, findNodeById } from '@/editor/schema';
import {
  TABLE_COMMAND_ROWS,
  createInsertTableCommand,
  tableCommand,
  tableIcon,
  type TableCommandRow,
} from '@/features/tables/commands';
import { reasonText, type ReasonCode } from '@/features/tables/reasons';
import { initI18n, resources } from '@/i18n';
import type { Document } from '@/model/document';
import { actions } from '@/model/store';

import { defaultSettings, mergeSettings } from '../settings/fixtures';

import { fakeDialogs, fakeRunLock, makeContext } from './testUtils';
import {
  caretIn,
  modelTable,
  posOf,
  removeHarnessHosts,
  select,
  tableDocument,
  tablesHarness,
  type TablesHarness,
} from './tablesHarness';

const N = fb2Schema.nodes;

function cell(nodeId: string, colspan: number | null = null): PMNode {
  return N.td!.create({ nodeId, colspan }, fb2Schema.text(nodeId));
}

function docWith(table: PMNode): PMNode {
  return N.doc!.create(
    null,
    N.body!.create(
      { nodeId: 'body' },
      N.section!.create({ nodeId: 's' }, [
        N.p!.create({ nodeId: 'p1' }, fb2Schema.text('before')),
        table,
        N.p!.create({ nodeId: 'p2' }, fb2Schema.text('after')),
      ]),
    ),
  );
}

/** A 2 × 2 table `t`. */
function smallDoc(): PMNode {
  return docWith(
    N.table!.create({ nodeId: 't' }, [
      N.tr!.create({ nodeId: 'r0' }, [cell('a'), cell('b')]),
      N.tr!.create({ nodeId: 'r1' }, [cell('c'), cell('d')]),
    ]),
  );
}

/** One row of 4195 cells of colspan 1000: above MAX_GRID_POSITIONS. */
function largeDoc(): PMNode {
  const cells = Array.from({ length: 4195 }, (_, i) => cell(`w${i}`, 1000));
  return docWith(N.table!.create({ nodeId: 'big' }, [N.tr!.create({ nodeId: 'r' }, cells)]));
}

function pos(doc: PMNode, nodeId: string): number {
  return findNodeById(doc, nodeId)!.pos;
}

function stateWith(doc: PMNode, selection: (doc: PMNode) => TextSelection | NodeSelection) {
  return EditorState.create({ doc, selection: selection(doc) });
}

afterEach(() => {
  removeHarnessHosts();
});

describe('availability', () => {
  it('answers the host refusals: not in a table, a mixed selection, a whole table selected', () => {
    const doc = smallDoc();
    const inParagraph = stateWith(doc, (d) => TextSelection.create(d, pos(d, 'p1') + 2));
    const mixed = stateWith(doc, (d) => TextSelection.create(d, pos(d, 'p1') + 2, pos(d, 'a') + 1));
    const whole = stateWith(doc, (d) => NodeSelection.create(d, pos(d, 't')));
    for (const name of TABLE_COMMAND_NAMES) {
      expect(availability(inParagraph, name)).toEqual({ refused: 'notInTable' });
      expect(availability(mixed, name)).toEqual({ refused: 'mixedSelection' });
      expect(availability(whole, name)).toEqual(
        TABLE_SELECTION_COMMANDS.has(name) ? { ok: true } : { refused: 'tableSelected' },
      );
    }
    expect([...TABLE_SELECTION_COMMANDS].sort()).toEqual(
      ['delete', 'paragraphAfter', 'paragraphBefore', 'repair', 'select'].sort(),
    );
    // In a cell: ok, but for the moves without a neighbour - US2's checks (T075) answer them.
    const inCell = stateWith(doc, (d) => TextSelection.create(d, pos(d, 'b') + 1));
    const refused: Partial<Record<string, Refusal>> = {
      moveRowUp: { refused: 'no-neighbour', params: { direction: 'up' } },
      moveColumnRight: { refused: 'no-neighbour', params: { direction: 'right' } },
    };
    for (const name of TABLE_COMMAND_NAMES)
      expect(availability(inCell, name), name).toEqual(refused[name] ?? { ok: true });
  });

  it('answers too-large before any other refusal for the commands that read positions, and only for them', () => {
    const doc = largeDoc();
    const state = stateWith(doc, (d) => TextSelection.create(d, pos(d, 'w1') + 1));
    expect(gridOfNode(doc.nodeAt(pos(doc, 'big'))!).tooLarge).toBe(true);
    const unregister = registerAvailabilityCheck('insertRowAbove', () => ({ refused: 'only-row' }));
    try {
      for (const name of TABLE_COMMAND_NAMES) {
        expect(availability(state, name)).toEqual(
          POSITION_COMMANDS.has(name) ? { refused: 'too-large' } : { ok: true },
        );
      }
      // On a table that is not too large the registered check answers.
      const small = stateWith(smallDoc(), (d) => TextSelection.create(d, pos(d, 'a') + 1));
      expect(availability(small, 'insertRowAbove')).toEqual({ refused: 'only-row' });
    } finally {
      unregister();
    }
    expect(POSITION_COMMANDS.size).toBe(17);
    for (const name of ['toggleHeaderCell', 'makeHeaderCells', 'makeNormalCells', 'select']) {
      expect(POSITION_COMMANDS.has(name as never)).toBe(false);
    }
  });

  it('builds no node and reads the cached grid', () => {
    const doc = smallDoc();
    const table = doc.nodeAt(pos(doc, 't'))!;
    const grid = gridOfNode(table);
    const states = [
      stateWith(doc, (d) => TextSelection.create(d, pos(d, 'a') + 1)),
      stateWith(doc, (d) => NodeSelection.create(d, pos(d, 't'))),
      EditorState.create({
        doc,
        selection: CellBlockSelection.create(doc, pos(doc, 'a'), pos(doc, 'd')),
      }),
    ];
    const create = vi.spyOn(NodeType.prototype, 'create');
    const createChecked = vi.spyOn(NodeType.prototype, 'createChecked');
    try {
      for (const state of states) {
        for (const name of TABLE_COMMAND_NAMES) availability(state, name);
      }
      expect(create).not.toHaveBeenCalled();
      expect(createChecked).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
      createChecked.mockRestore();
    }
    expect(gridOfNode(table)).toBe(grid);
  });
});

describe('reasonText', () => {
  const translators = {} as Record<'en' | 'ru' | 'uk', TFunction>;

  beforeAll(async () => {
    const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    for (const language of ['en', 'ru', 'uk'] as const) {
      translators[language] = i18n.getFixedT(language);
    }
  });

  /** Every refusal with each value of its parameter, and the other reason codes. */
  const refusals: Refusal[] = [
    { refused: 'only-row' },
    { refused: 'all-rows' },
    { refused: 'only-column' },
    { refused: 'all-columns' },
    { refused: 'merged-crosses-border', params: { axis: 'row' } },
    { refused: 'merged-crosses-border', params: { axis: 'column' } },
    { refused: 'no-neighbour', params: { direction: 'up' } },
    { refused: 'no-neighbour', params: { direction: 'down' } },
    { refused: 'no-neighbour', params: { direction: 'left' } },
    { refused: 'no-neighbour', params: { direction: 'right' } },
    { refused: 'not-merged', params: { selection: 'cell' } },
    { refused: 'not-merged', params: { selection: 'block' } },
    { refused: 'needs-block' },
    { refused: 'regular' },
    { refused: 'span-past-edge', params: { axis: 'column' } },
    { refused: 'span-past-edge', params: { axis: 'row' } },
    { refused: 'merge-needs-block' },
    { refused: 'too-large' },
    { refused: 'invalid-id' },
    { refused: 'duplicate-id', params: { id: 'note-7' } },
    { refused: 'invalid-lang', params: { value: 'en_GB' } },
  ];
  const codes: [ReasonCode, Record<string, unknown> | undefined][] = [
    ['notInTable', undefined],
    ['mixedSelection', undefined],
    ['tableSelected', undefined],
    ['noTarget', { command: 'table.deleteRow' }],
    ['noTarget', { command: 'insert.table' }],
    ['noTablePlace', undefined],
    ['cellInlineOnly', undefined],
    ['source.loading', undefined],
    ['source.failed', undefined],
    ['source.analysing', undefined],
    ['source.notWellFormed', { line: 12 }],
    ['source.inTag', undefined],
    ['source.inMarkup', undefined],
    ['source.outsideRoot', undefined],
    ['source.inText', undefined],
    ['source.notAllowed', { element: 'poem' }],
  ];

  function hasKey(language: 'en' | 'ru' | 'uk', key: string): boolean {
    let node: unknown = resources[language].translation;
    for (const part of key.split('.')) {
      if (!node || typeof node !== 'object' || !(part in node)) return false;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string' && node.length > 0;
  }

  it('gives every code and leaf from a key present in the three catalogues', () => {
    expect(new Set(refusals.map((r) => r.refused))).toEqual(new Set(REFUSAL_CODES));
    for (const language of ['en', 'ru', 'uk'] as const) {
      const used: string[] = [];
      const translate = translators[language] as unknown as (
        key: string,
        options: Record<string, unknown>,
      ) => string;
      const t = ((key: string, options?: Record<string, unknown>) => {
        used.push(key);
        return translate(key, options ?? {});
      }) as unknown as TFunction;
      const texts = [
        ...refusals.map((refusal) => reasonText(refusal, t)),
        ...codes.map(([code, params]) => reasonText(code, params, t)),
      ];
      for (const text of texts) {
        expect(text, language).not.toMatch(/missing|\{\{/);
        expect(text.length, language).toBeGreaterThan(0);
      }
      for (const key of used) expect(hasKey(language, key), `${language}: ${key}`).toBe(true);
      // Each leaf and each code its own key.
      expect(new Set(used).size).toBe(refusals.length + codes.length);
    }
  });

  it('picks the leaf by the parameter or the command and fills id and value', () => {
    const t = translators.en;
    expect(reasonText({ refused: 'only-row' }, t)).toBe(
      'the table has only one row; use Delete table',
    );
    expect(reasonText({ refused: 'merged-crosses-border', params: { axis: 'column' } }, t)).toBe(
      'a merged cell crosses the border of the column',
    );
    expect(reasonText({ refused: 'no-neighbour', params: { direction: 'left' } }, t)).toBe(
      'there is no column to the left',
    );
    expect(reasonText({ refused: 'duplicate-id', params: { id: 'note-7' } }, t)).toBe(
      'another element of the book already uses note-7',
    );
    expect(reasonText({ refused: 'invalid-lang', params: { value: 'en_GB' } }, t)).toContain(
      '"en_GB"',
    );
    expect(reasonText('noTarget', { command: 'table.select' }, t)).toBe(
      'place the caret in a table of the Body view or of an annotation or history field',
    );
    expect(reasonText('noTarget', { command: 'insert.table' }, t)).toBe(
      'place the caret in the Body view, in an annotation or history field, or in the Source view',
    );
    expect(reasonText({ refused: 'tableSelected' }, t)).toBe(
      'the whole table is selected; place the caret in a cell',
    );
    expect(reasonText('source.notWellFormed', { line: 12 }, t)).toContain('line 12');
  });
});

describe('a command built from a row of the command table', () => {
  /** A plan that writes X into the caret's cell. */
  const writeX: TablePlan = (address) => {
    const { table, grid, caret } = address;
    const index = grid.owner(caret!.row, caret!.col);
    const target = grid.cells[index]!;
    const rowIndex = grid.rowChild[target.row]!;
    const row = table.child(rowIndex);
    const old = gridCellNode(table, grid, index);
    const cells: PMNode[] = [];
    row.forEach((child) => cells.push(child));
    cells[target.index] = old.type.create(old.attrs, fb2Schema.text('X'), old.marks);
    const rows: PMNode[] = [];
    table.forEach((child) => rows.push(child));
    rows[rowIndex] = row.type.create(row.attrs, cells, row.marks);
    return { rows, focus: caretAt(caret!.row, caret!.col), removedIds: [] };
  };

  it('has the members of data-model §9.1, the scope included', () => {
    const row: TableCommandRow = { id: 'table.insertRowAbove', command: () => () => false };
    const command = tableCommand(row);
    expect(command).toMatchObject({
      id: 'table.insertRowAbove',
      group: 'table',
      labelKey: 'menu.tableStructure.insertRowAbove',
      tooltipKey: 'tables.cmd.insertRowAbove.tooltip',
      descriptionKey: 'tables.cmd.insertRowAbove.description',
      icon: 'table-insert-row-above',
      hotkeyScope: 'tableTarget',
    });
    expect(command.duringScriptRun).toBeUndefined();
    expect(command.stub).toBeUndefined();
    expect(TABLE_COMMAND_NAMES.map(tableIcon)).toContain('table-toggle-header-column');
  });

  it('says noTarget.table without a target, and the run-lock texts under each lock', async () => {
    const ctx = await makeContext();
    const registry = createCommandRegistry();
    registry.replace(tableCommand({ id: 'table.select', command: () => () => true }));
    expect(registry.isEnabled('table.select', ctx)).toBe(false);
    expect(registry.unavailableReason('table.select', ctx)).toBe(
      'place the caret in a table of the Body view or of an annotation or history field',
    );
    actions.setRunLock(ctx.store, fakeRunLock('script'));
    expect(registry.unavailableReason('table.select', ctx)).toBe(
      'a script is running; wait until it ends',
    );
    actions.setRunLock(ctx.store, fakeRunLock('ai'));
    expect(registry.unavailableReason('table.select', ctx)).toBe(
      'a request to the AI assistant is running; wait until it ends',
    );
  });

  it('is enabled on an editable target, gives the refusal words otherwise, and runs as one undo step', async () => {
    const harness = await tablesHarness();
    const { services, ctx, controller } = harness;
    services.commands.replace(
      tableCommand({ id: 'table.select', command: (planCtx) => planCommand(writeX, planCtx) }),
    );
    caretIn(harness, 'p1', 1);
    expect(services.commands.isEnabled('table.select', ctx)).toBe(false);
    expect(services.commands.unavailableReason('table.select', ctx)).toBe(
      'the caret is not in a table',
    );
    caretIn(harness, 't1-1-1', 1);
    expect(services.commands.isEnabled('table.select', ctx)).toBe(true);
    expect(services.commands.unavailableReason('table.select', ctx)).toBeNull();
    const before = services.undo.entries().length;
    expect(await services.commands.execute('table.select', ctx)).toBe(true);
    const doc = controller.editorState!.doc;
    expect(doc.nodeAt(posOf(harness, 't1-1-1'))!.textContent).toBe('X');
    expect(services.undo.entries().length).toBe(before + 1);
    expect(services.undo.entries().at(-1)!.view).toBe('body');
    // The store's document follows the editor.
    expect(JSON.stringify(ctx.store.getState().document)).toContain('"X"');
  });
});

describe('insert.table (US1)', () => {
  /** The harness's book with a body title (`btp`), where no table may stand. */
  function bookWithTitle(): Document {
    const doc = tableDocument();
    (doc.bodies[0]!.content as unknown[]).unshift({
      type: 'title',
      attrs: { nodeId: 'bt' },
      content: [{ type: 'p', attrs: { nodeId: 'btp' }, content: [{ type: 'text', text: 'Book' }] }],
    });
    return doc;
  }

  const STORED = { rows: 4, columns: 3, headerRow: true, headerColumn: false };

  /** Settings whose `session.tableDialog` is `STORED`; `settings.set` merges like the core. */
  function withSettings(harness: TablesHarness): void {
    const settings = defaultSettings();
    settings.session.tableDialog = { ...STORED };
    act(() => actions.setSettings(harness.store, settings));
    harness.rpc.responses['settings.set'] = (params: unknown) => ({
      settings: mergeSettings(
        harness.store.getState().settings,
        (params as { patch: unknown }).patch,
      ),
      restartRequired: false,
    });
  }

  function sectionTypes(harness: TablesHarness): string[] {
    const section = harness.store
      .getState()
      .document!.bodies[0]!.content.find((child) => child.type === 'section') as unknown as {
      content: { type: string }[];
    };
    return section.content.map((child) => child.type);
  }

  it('is registered by the tables feature: the literal id, the group edit, menu.add.table, the icon table-insert, no hotkey scope', async () => {
    const { services } = await tablesHarness();
    const command = services.commands.get('insert.table')!;
    expect(command).toMatchObject({
      id: 'insert.table',
      group: 'edit',
      labelKey: 'menu.add.table',
      tooltipKey: 'cmd.insert.table.tooltip',
      descriptionKey: 'cmd.insert.table.description',
      icon: 'table-insert',
    });
    expect(command.hotkeyScope).toBeUndefined();
    expect(command.stub).toBeUndefined();
    expect(command.duringScriptRun).toBeUndefined();
    // The tables feature's own entry, not the stub or the editing feature's.
    const own = createInsertTableCommand();
    expect(Object.keys(command).sort()).toEqual(Object.keys(own).sort());
  });

  it('is enabled where FR-004 finds a point, unavailable with its reason elsewhere and under the run lock', async () => {
    const harness = await tablesHarness(bookWithTitle());
    const { services, ctx } = harness;
    act(() => caretIn(harness, 'p1', 3));
    expect(services.commands.isEnabled('insert.table', ctx)).toBe(true);
    expect(services.commands.unavailableReason('insert.table', ctx)).toBeNull();
    act(() => caretIn(harness, 'btp', 2));
    expect(services.commands.isEnabled('insert.table', ctx)).toBe(false);
    expect(services.commands.unavailableReason('insert.table', ctx)).toBe(
      'no table may stand here',
    );
    expect(
      unavailableTitle(
        services.commands.get('insert.table')!,
        services.commands.unavailableReason('insert.table', ctx)!,
        ctx.t,
      ),
    ).toBe('Insert table: no table may stand here');
    act(() => caretIn(harness, 't1-1-1', 1));
    expect(services.commands.isEnabled('insert.table', ctx)).toBe(true);
    act(() => actions.setRunLock(harness.store, fakeRunLock('script')));
    expect(services.commands.unavailableReason('insert.table', ctx)).toBe(
      'a script is running; wait until it ends',
    );
    act(() => actions.setRunLock(harness.store, fakeRunLock('ai')));
    expect(services.commands.unavailableReason('insert.table', ctx)).toBe(
      'a request to the AI assistant is running; wait until it ends',
    );
    act(() => actions.setRunLock(harness.store, null));
    // No field target before US10: the Description view has none.
    act(() => actions.setActiveView(harness.store, 'description'));
    expect(services.commands.isEnabled('insert.table', ctx)).toBe(false);
    expect(services.commands.unavailableReason('insert.table', ctx)).toBe(
      'place the caret in the Body view, in an annotation or history field, or in the Source view',
    );
    // Without a document.
    const empty = await makeContext();
    const registry = createCommandRegistry();
    registry.replace(createInsertTableCommand());
    expect(registry.isEnabled('insert.table', empty)).toBe(false);
    expect(registry.unavailableReason('insert.table', empty)).toBe(
      'place the caret in the Body view, in an annotation or history field, or in the Source view',
    );
  });

  it('opens the dialog with session.tableDialog; OK stores the four values and inserts as one undo step', async () => {
    const harness = await tablesHarness();
    withSettings(harness);
    act(() => caretIn(harness, 'p1', 6));
    const dialogs = fakeDialogs(
      [],
      [{ rows: 2, columns: 3, headerRow: false, headerColumn: true }],
    );
    const ctx = { ...harness.ctx, dialogs };
    const entries = harness.services.undo.entries().length;
    await act(async () => {
      expect(await harness.services.commands.execute('insert.table', ctx)).toBe(true);
    });
    expect(dialogs.custom).toHaveLength(1);
    expect(dialogs.custom[0]!.name).toBe('TablePropertiesDialog');
    expect(dialogs.custom[0]!.props.initial).toEqual(STORED);
    const sets = harness.rpc.calls.filter((call) => call.method === 'settings.set');
    expect(sets).toEqual([
      {
        method: 'settings.set',
        params: {
          patch: {
            session: { tableDialog: { rows: 2, columns: 3, headerRow: false, headerColumn: true } },
          },
        },
      },
    ]);
    expect(harness.store.getState().settings!.session.tableDialog).toEqual({
      rows: 2,
      columns: 3,
      headerRow: false,
      headerColumn: true,
    });
    expect(sectionTypes(harness)).toEqual(['p', 'table', 'table', 'p']);
    expect(harness.services.undo.entries().length).toBe(entries + 1);
    const state = harness.controller.editorState!;
    const cell = state.selection.$from.parent;
    expect(cell.type.name).toBe('th');
    expect(state.selection.$from.parentOffset).toBe(0);
    expect(state.selection.$from.node(-2).childCount).toBe(2);
    expect(state.selection.$from.node(-1).childCount).toBe(3);
  });

  it('changes and stores nothing on Cancel', async () => {
    const harness = await tablesHarness();
    withSettings(harness);
    act(() => caretIn(harness, 'p1', 6));
    const before = harness.store.getState().document;
    const entries = harness.services.undo.entries().length;
    const ctx = { ...harness.ctx, dialogs: fakeDialogs([], [null]) };
    await act(async () => {
      await harness.services.commands.execute('insert.table', ctx);
    });
    expect(harness.rpc.calls.filter((call) => call.method === 'settings.set')).toEqual([]);
    expect(harness.store.getState().document).toBe(before);
    expect(harness.services.undo.entries().length).toBe(entries);
  });

  it('logs a failing settings.set and inserts the table all the same', async () => {
    const harness = await tablesHarness();
    act(() => caretIn(harness, 'p1', 6));
    harness.rpc.responses['settings.set'] = new Error('the settings file cannot be written');
    const ctx = { ...harness.ctx, dialogs: fakeDialogs([], [{ ...STORED }]) };
    await act(async () => {
      await harness.services.commands.execute('insert.table', ctx);
    });
    const logged = harness.rpc.calls.filter((call) => call.method === 'log.error');
    expect(logged).toHaveLength(1);
    expect((logged[0]!.params as { code: string }).code).toBe('tables.dialogSaveFailed');
    expect(sectionTypes(harness)).toEqual(['p', 'table', 'table', 'p']);
  });

  it('keeps a non-empty selection in the document and puts the table at its end (decision 4)', async () => {
    const harness = await tablesHarness();
    withSettings(harness);
    const doc = harness.controller.editorState!.doc;
    const start = posOf(harness, 'p1') + 1;
    act(() => select(harness, TextSelection.create(doc, start + 1, start + 4)));
    const ctx = { ...harness.ctx, dialogs: fakeDialogs([], [{ ...STORED }]) };
    await act(async () => {
      await harness.services.commands.execute('insert.table', ctx);
    });
    expect(sectionTypes(harness)).toEqual(['p', 'table', 'p', 'table', 'p']);
    const section = harness.store.getState().document!.bodies[0]!.content[0] as unknown as {
      content: { type: string; content?: { text?: string }[] }[];
    };
    expect(section.content[0]!.content![0]!.text).toBe('Befo');
    expect(section.content[2]!.content![0]!.text).toBe('re');
  });
});

/* ------------------------------------------------------------------------ */
/* US2: the twelve row and column commands (T072)                           */
/* ------------------------------------------------------------------------ */

/** The twelve commands of user story 2, in FR-039's order. */
const US2_NAMES = [
  'insertRowAbove',
  'insertRowBelow',
  'deleteRow',
  'insertColumnLeft',
  'insertColumnRight',
  'deleteColumn',
  'moveRowUp',
  'moveRowDown',
  'moveColumnLeft',
  'moveColumnRight',
  'duplicateRow',
  'duplicateColumn',
] as const satisfies readonly TableCommandName[];

/** Their plans, as the command rows run them. */
const US2_PLANS: Record<(typeof US2_NAMES)[number], TablePlan> = {
  insertRowAbove: (a, c) => planInsertRows(a, { side: 'above' }, c),
  insertRowBelow: (a, c) => planInsertRows(a, { side: 'below' }, c),
  deleteRow: (a, c) => planDeleteRows(a, c),
  insertColumnLeft: (a, c) => planInsertColumns(a, { side: 'left' }, c),
  insertColumnRight: (a, c) => planInsertColumns(a, { side: 'right' }, c),
  deleteColumn: (a, c) => planDeleteColumns(a, c),
  moveRowUp: (a, c) => planMoveRows(a, { direction: 'up' }, c),
  moveRowDown: (a, c) => planMoveRows(a, { direction: 'down' }, c),
  moveColumnLeft: (a, c) => planMoveColumns(a, { direction: 'left' }, c),
  moveColumnRight: (a, c) => planMoveColumns(a, { direction: 'right' }, c),
  duplicateRow: (a, c) => planDuplicateRows(a, c),
  duplicateColumn: (a, c) => planDuplicateColumns(a, c),
};

const VECTORS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/tables',
);

type VectorRow = { type?: string; attrs?: Record<string, unknown> }[] | { type: string };

/** A model table from rows of model cells (node ids `v1`, `v2`, …; a raw child where asked). */
function vectorModel(rows: VectorRow[], texts = false): ModelNodeJson {
  let next = 0;
  const nodeId = () => `v${(next += 1)}`;
  const raw = () => ({ type: 'raw-xml', attrs: { nodeId: nodeId(), xml: '<x/>', inline: false } });
  return {
    type: 'table',
    attrs: { nodeId: nodeId() },
    content: rows.map((row) =>
      Array.isArray(row)
        ? {
            type: 'tr',
            attrs: { nodeId: nodeId() },
            content: row.map((cell) => {
              if (cell.type === 'raw-xml') return raw();
              const id = nodeId();
              return {
                type: cell.type ?? 'td',
                attrs: { nodeId: id, ...(cell.attrs ?? {}) },
                content: texts ? [{ type: 'text', text: id }] : [],
              };
            }),
          }
        : raw(),
    ),
  } as unknown as ModelNodeJson;
}

/** US2's scenario shapes of `tables.fb2` (T014), as rows of model cells. */
const span = (attrs: Record<string, unknown>) => ({ attrs });
const US2_SHAPES: VectorRow[][] = [
  [
    [{}, {}, {}],
    [{ attrs: { id: 'us2-r2c1' } }, {}, {}],
    [{}, {}, {}],
  ],
  [[span({ rowspan: 2 }), {}], [{}]],
  [
    [{ type: 'th' }, { type: 'th', attrs: { colspan: 2 } }],
    [{}, {}, span({ align: 'right' })],
    [{}, {}, span({ lang: 'de' })],
  ],
  [[{}, {}], [span({ rowspan: 2 }), {}], [{}]],
  Array.from({ length: 5 }, () => [{}, {}, {}]),
  [[{}, {}, {}]],
  [[{}], [{}], [{}]],
  [[{}, {}], [{}, {}], [span({ rowspan: 2 }), {}], [{}], [{}, {}]],
];

/** The tables the agreement runs over: the small vector cases and US2's shapes. */
function agreementTables(): { name: string; node: PMNode }[] {
  const vectors = JSON.parse(readFileSync(path.join(VECTORS_DIR, 'grid-vectors.json'), 'utf8')) as {
    cases: { name: string; table: { rows: VectorRow[] } }[];
  };
  const tables = vectors.cases.map((one) => ({
    name: one.name,
    node: nodeFromModel(vectorModel(one.table.rows))!,
  }));
  const small = tables.filter(({ node }) => {
    const grid = gridOfNode(node);
    return grid.cells.length > 0 && grid.height * grid.width <= 64;
  });
  return [
    ...small,
    ...US2_SHAPES.map((rows, index) => ({
      name: `US2 table ${index + 1}`,
      node: nodeFromModel(vectorModel(rows, true))!,
    })),
  ];
}

/** The states of a table: the caret in every cell, and blocks from the first cell to each other. */
function statesOf(node: PMNode): EditorState[] {
  const doc = docWith(node);
  const tablePos = pos(doc, node.attrs.nodeId as string);
  const cells: number[] = [];
  doc.nodeAt(tablePos)!.descendants((child, at) => {
    if (child.type.name === 'td' || child.type.name === 'th') cells.push(tablePos + 1 + at);
    return child.type.name === 'table' || child.type.name === 'tr';
  });
  const states = cells.map((at) =>
    EditorState.create({ doc, selection: TextSelection.create(doc, at + 1) }),
  );
  for (const head of cells.slice(1)) {
    states.push(
      EditorState.create({ doc, selection: CellBlockSelection.create(doc, cells[0]!, head) }),
    );
  }
  // Blocks between neighbours in reading order, a sample of the other shapes.
  for (let index = 1; index + 1 < cells.length; index += 2) {
    states.push(
      EditorState.create({
        doc,
        selection: CellBlockSelection.create(doc, cells[index]!, cells[index + 1]!),
      }),
    );
  }
  return states;
}

describe('US2: the twelve row and column commands', () => {
  it('availability agrees with every plan’s dry run: ok exactly when the plan acts, else the plan’s refusal', () => {
    let compared = 0;
    const refusedCodes = new Set<string>();
    for (const { name: table, node } of agreementTables()) {
      for (const state of statesOf(node)) {
        const address = tableTarget(state)!.address;
        for (const name of US2_NAMES) {
          const plan = US2_PLANS[name](address, { nextId: () => `x${(compared += 1)}` });
          const answer = availability(state, name);
          if (isRefusal(plan)) {
            refusedCodes.add(plan.refused);
            expect(answer, `${table}: ${name}`).toEqual(plan);
          } else {
            expect(answer, `${table}: ${name}`).toEqual({ ok: true });
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
    // The cases reach every refusal the twelve plans have below the too-large bound.
    expect([...refusedCodes].sort()).toEqual(
      [
        'all-columns',
        'all-rows',
        'merged-crosses-border',
        'no-neighbour',
        'only-column',
        'only-row',
        'too-large',
      ].sort(),
    );
  });

  it('availability builds no node for them, and reads the cached grid and line crossings', () => {
    const doc = smallDoc();
    const table = doc.nodeAt(pos(doc, 't'))!;
    const grid = gridOfNode(table);
    const crossings = crossedLines(grid);
    const states = [
      stateWith(doc, (d) => TextSelection.create(d, pos(d, 'a') + 1)),
      stateWith(doc, (d) => TextSelection.create(d, pos(d, 'd') + 1)),
      EditorState.create({
        doc,
        selection: CellBlockSelection.create(doc, pos(doc, 'a'), pos(doc, 'd')),
      }),
    ];
    const create = vi.spyOn(NodeType.prototype, 'create');
    const createChecked = vi.spyOn(NodeType.prototype, 'createChecked');
    try {
      for (const state of states) for (const name of US2_NAMES) availability(state, name);
      expect(create).not.toHaveBeenCalled();
      expect(createChecked).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
      createChecked.mockRestore();
    }
    expect(gridOfNode(table)).toBe(grid);
    expect(crossedLines(grid)).toBe(crossings);
    expect(crossings.rows).toBeInstanceOf(Uint8Array);
    expect(crossings.rows).toHaveLength(grid.height + 1);
    expect(crossings.columns).toHaveLength(grid.width + 1);
  });

  it('answers the host codes first, then too-large, then the plan’s code', () => {
    // A table of one row: deleteRow's own code is only-row.
    const oneRow = docWith(
      N.table!.create({ nodeId: 't' }, [N.tr!.create({ nodeId: 'r0' }, [cell('a'), cell('b')])]),
    );
    expect(
      availability(
        stateWith(oneRow, (d) => TextSelection.create(d, pos(d, 'a') + 1)),
        'deleteRow',
      ),
    ).toEqual({
      refused: 'only-row',
    });
    expect(
      availability(
        stateWith(oneRow, (d) => NodeSelection.create(d, pos(d, 't'))),
        'deleteRow',
      ),
    ).toEqual({
      refused: 'tableSelected',
    });
    expect(
      availability(
        stateWith(oneRow, (d) => TextSelection.create(d, pos(d, 'p1') + 1, pos(d, 'a') + 1)),
        'deleteRow',
      ),
    ).toEqual({ refused: 'mixedSelection' });
    expect(
      availability(
        stateWith(oneRow, (d) => TextSelection.create(d, pos(d, 'p1') + 1)),
        'deleteRow',
      ),
    ).toEqual({
      refused: 'notInTable',
    });
    // One row above MAX_GRID_POSITIONS: too-large before only-row.
    const large = largeDoc();
    const state = stateWith(large, (d) => TextSelection.create(d, pos(d, 'w1') + 1));
    for (const name of US2_NAMES)
      expect(availability(state, name), name).toEqual({ refused: 'too-large' });
  });

  it('has twelve command rows with literal ids, registered live by the tables feature', async () => {
    const ids = TABLE_COMMAND_ROWS.map((row) => row.id);
    expect(ids.filter((id) => (US2_NAMES as readonly string[]).includes(id.slice(6)))).toEqual(
      US2_NAMES.map((name) => `table.${name}`),
    );
    const source = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../src/features/tables/commands.ts',
      ),
      'utf8',
    );
    for (const name of US2_NAMES) expect(source, name).toContain(`id: 'table.${name}'`);
    const { services } = await tablesHarness();
    for (const name of US2_NAMES) {
      const command = services.commands.get(`table.${name}`)!;
      expect(command.stub, name).toBeUndefined();
      expect(command.hotkeyScope, name).toBe('tableTarget');
    }
  });

  /** The harness's book with a table of one row (`t9`) and sc.10's table (`t7`) after `t1`. */
  function reasonsBook(): Document {
    const doc = tableDocument();
    const section = doc.bodies[0]!.content[0] as unknown as { content: unknown[] };
    section.content.push(modelTable('t9', 1, 3));
    const m = (id: string, text: string, attrs: Record<string, unknown> = {}) => ({
      type: 'td',
      attrs: { nodeId: id, ...attrs },
      content: [{ type: 'text', text }],
    });
    const tr = (id: string, cells: unknown[]) => ({
      type: 'tr',
      attrs: { nodeId: id },
      content: cells,
    });
    section.content.push({
      type: 'table',
      attrs: { nodeId: 't7' },
      content: [
        tr('t7-r0', [m('t7-0-0', 'r1c1'), m('t7-0-1', 'r1c2')]),
        tr('t7-r1', [m('t7-1-0', 'r2c1'), m('t7-1-1', 'r2c2')]),
        tr('t7-r2', [m('t7-2-0', 'm', { rowspan: 2 }), m('t7-2-1', 'r3c2')]),
        tr('t7-r3', [m('t7-3-1', 'r4c2')]),
        tr('t7-r4', [m('t7-4-0', 'r5c1'), m('t7-4-1', 'r5c2')]),
      ],
    });
    return doc;
  }

  it('a row with a refusing target is disabled with the refusal’s words as its reason and title (FR-043)', async () => {
    const harness = await tablesHarness(reasonsBook());
    const { services, ctx } = harness;
    const reason = (id: string) => services.commands.unavailableReason(id, ctx);
    const title = (id: string) => unavailableTitle(services.commands.get(id)!, reason(id)!, ctx.t);
    act(() => caretIn(harness, 't9-0-1', 1));
    expect(services.commands.isEnabled('table.deleteRow', ctx)).toBe(false);
    expect(reason('table.deleteRow')).toBe('the table has only one row; use Delete table');
    expect(title('table.deleteRow')).toBe(
      'Delete row: the table has only one row; use Delete table',
    );
    act(() => caretIn(harness, 't7-2-1', 1));
    expect(title('table.moveRowUp')).toBe(
      'Move row up: a merged cell crosses the border of the row',
    );
    act(() => caretIn(harness, 't1-0-0', 1));
    expect(title('table.moveRowUp')).toBe('Move row up: there is no row above');
    expect(title('table.moveColumnLeft')).toBe('Move column left: there is no column to the left');
    act(() => caretIn(harness, 't1-2-2', 1));
    expect(title('table.moveRowDown')).toBe('Move row down: there is no row below');
    expect(title('table.moveColumnRight')).toBe(
      'Move column right: there is no column to the right',
    );
    // Enabled where the target allows the command.
    expect(services.commands.isEnabled('table.moveRowUp', ctx)).toBe(true);
    expect(reason('table.moveRowUp')).toBeNull();
    // The keys of these reasons exist in the Russian and Ukrainian catalogues too.
    for (const language of ['ru', 'uk'] as const) {
      const reasons = (
        resources[language].translation as { tables: { reason: Record<string, unknown> } }
      ).tables.reason;
      expect(typeof reasons['only-row'], language).toBe('string');
      expect(
        (reasons['merged-crosses-border'] as Record<string, string>).row,
        language,
      ).toBeTruthy();
      for (const direction of ['up', 'down', 'left', 'right']) {
        expect(
          (reasons['no-neighbour'] as Record<string, string>)[direction],
          `${language} ${direction}`,
        ).toBeTruthy();
      }
    }
  });

  it('an enabled row runs through the target as one undo-coordinator entry; a refusal dispatches nothing', async () => {
    const harness = await tablesHarness();
    const { services, ctx, controller } = harness;
    act(() => caretIn(harness, 't1-1-1', 1));
    const entries = services.undo.entries().length;
    await act(async () => {
      expect(await services.commands.execute('table.insertRowBelow', ctx)).toBe(true);
    });
    expect(services.undo.entries().length).toBe(entries + 1);
    const table = (
      harness.store.getState().document!.bodies[0]!.content[0] as unknown as {
        content: { type: string; content?: unknown[] }[];
      }
    ).content.find((node) => node.type === 'table')!;
    expect(table.content).toHaveLength(4);
    // The caret in the first cell of the new row (data-model §4.5).
    expect(controller.editorState!.selection.$from.parent.textContent).toBe('');
    // A refusal: no dispatch, no undo entry.
    act(() => caretIn(harness, 't1-0-0', 1));
    const row = TABLE_COMMAND_ROWS.find((one) => one.id === 'table.moveRowUp')!;
    const dispatch = vi.fn();
    expect(row.command({ nextId: () => 'unused' })(controller.editorState!, dispatch)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    await act(async () => {
      expect(await services.commands.execute('table.moveRowUp', ctx)).toBe(false);
    });
    expect(services.undo.entries().length).toBe(entries + 1);
  });
});
