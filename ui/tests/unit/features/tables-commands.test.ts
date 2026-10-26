/**
 * The table commands' availability and reasons (feature 006, T041; I6; C21; data-model §2.5,
 * §6.5, §9.1, §9.6; research R2.17): the host refusals, `too-large` before every other
 * refusal and only for the commands that read positions, no node built and the cached grid
 * read, `reasonText` for every code and leaf in the three catalogues, and a command built from
 * a row of the command table. Each story adds "availability agrees with every plan's dry run"
 * for its commands.
 */

import { createInstance, type TFunction } from 'i18next';
import { NodeType, type Node as PMNode } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';

import { createCommandRegistry } from '@/app/commands';
import {
  availability,
  planCommand,
  POSITION_COMMANDS,
  registerAvailabilityCheck,
  TABLE_COMMAND_NAMES,
  TABLE_SELECTION_COMMANDS,
  type TablePlan,
} from '@/editor/table/commands';
import { REFUSAL_CODES, gridCellNode, type Refusal } from '@/editor/table/edit';
import { gridOfNode } from '@/editor/table/grid';
import { caretAt } from '@/editor/table/ops';
import { CellBlockSelection } from '@/editor/table/selection';
import { fb2Schema, findNodeById } from '@/editor/schema';
import { tableCommand, tableIcon, type TableCommandRow } from '@/features/tables/commands';
import { reasonText, type ReasonCode } from '@/features/tables/reasons';
import { initI18n, resources } from '@/i18n';
import { actions } from '@/model/store';

import { fakeRunLock, makeContext } from './testUtils';
import { caretIn, posOf, removeHarnessHosts, tablesHarness } from './tablesHarness';

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
    const inCell = stateWith(doc, (d) => TextSelection.create(d, pos(d, 'b') + 1));
    for (const name of TABLE_COMMAND_NAMES)
      expect(availability(inCell, name)).toEqual({ ok: true });
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
