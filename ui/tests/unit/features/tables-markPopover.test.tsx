/**
 * The texts of an irregular table and the mark's popover (feature 006, T126; FR-057, FR-034,
 * FR-045, FR-048; US8 sc.9; C61; I3, I16, I17; data-model §3.2, §3.5, §6.5; research R6.4):
 * `describeTableMark` gives the mark's name - Validate's text, the named variant for a table with
 * an id -, its tooltip - the problems with a capital first letter, or the name, then the repair
 * hint - and the parts; the modeless popover lists the parts with *Repair table* and *Close*,
 * titles a named table with the mark's name, disables *Repair table* under the run lock and on a
 * table too large to edit (the focus then on *Close*), repairs the mark's own table - not the
 * caret's - as one undo step, and closes on Escape, on a mousedown outside it and when its table
 * turns regular or disappears.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance, type TFunction } from 'i18next';

import { DialogHost } from '@/dialogs';
import { describeTableMark } from '@/features/tables/marks';
import { openTableMarkPopover } from '@/features/tables/MarkPopover';
import { activeTableTarget } from '@/features/tables/target';
import { initI18n } from '@/i18n';
import type { Document } from '@/model/document';
import { actions } from '@/model/store';

import { fakeRunLock } from './testUtils';
import {
  caretIn,
  posOf,
  removeHarnessHosts,
  tableDocument,
  tablesHarness,
  type TablesHarness,
} from './tablesHarness';

beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
});

afterEach(() => {
  removeHarnessHosts();
});

const TOOLTIP_EXAMPLE = {
  rows: 3,
  columns: 3,
  shortRows: 1,
  row: 2,
  covered: 2,
  overlaps: 1,
  pastEnd: 0,
};
const NAMED = {
  rows: 3,
  columns: 3,
  shortRows: 1,
  row: 2,
  covered: 2,
  overlaps: 0,
  pastEnd: 0,
  id: 't2',
};

describe('describeTableMark (data-model §3.2; C61)', () => {
  const t = {} as Record<'en' | 'ru' | 'uk', TFunction>;

  beforeAll(async () => {
    const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    for (const language of ['en', 'ru', 'uk'] as const) t[language] = i18n.getFixedT(language);
  });

  it('US8 sc.9’s table: the name, the tooltip with a capital first letter and the hint, the parts', () => {
    expect(describeTableMark(TOOLTIP_EXAMPLE, t.en)).toEqual({
      name: 'Irregular table: row 2 covers 2 of 3 columns; 1 overlapping span',
      tooltip:
        'Row 2 covers 2 of 3 columns; 1 overlapping span. Repair table makes the table regular.',
      parts: ['row 2 covers 2 of 3 columns', '1 overlapping span'],
    });
  });

  it('a table with an id: the named variant as the name, and the name in the tooltip', () => {
    const texts = describeTableMark(NAMED, t.en);
    expect(texts.name).toBe('Irregular table "t2": row 2 covers 2 of 3 columns');
    expect(texts.tooltip).toBe(
      'Irregular table "t2": row 2 covers 2 of 3 columns. Repair table makes the table regular.',
    );
    expect(texts.parts).toEqual(['row 2 covers 2 of 3 columns']);
  });

  it('Russian and Ukrainian: the problems’ first letter upper-cased in the tooltip, plurals by the catalogue', () => {
    for (const language of ['ru', 'uk'] as const) {
      const texts = describeTableMark(TOOLTIP_EXAMPLE, t[language]);
      const problems = texts.parts.join(t[language]('tables.problem.separator'));
      expect(texts.name, language).toBe(t[language]('validation.table.irregular', { problems }));
      expect(texts.tooltip, language).toBe(
        `${problems.charAt(0).toLocaleUpperCase(language)}${problems.slice(1)}. ${t[language](
          'tables.mark.repairHint',
        )}`,
      );
      expect(texts.tooltip.charAt(0), language).not.toBe(problems.charAt(0));
      expect(texts.parts, language).toHaveLength(2);
    }
  });
});

/* ------------------------------------------------------------------------ */
/* The popover                                                              */
/* ------------------------------------------------------------------------ */

/** A model cell holding `text`. */
const cell = (nodeId: string, text: string, attrs: Record<string, unknown> = {}) => ({
  type: 'td',
  attrs: { nodeId, ...attrs },
  content: [{ type: 'text', text }],
});
const row = (nodeId: string, cells: unknown[]) => ({
  type: 'tr',
  attrs: { nodeId },
  content: cells,
});

/**
 * The harness's book with two irregular tables after `t1`: `m2`, named `named`, of a short row
 * (`[a, b, c] / [d, e] / [f, g, h]`), and `m3`, US8 sc.9's table (`[a, b rowspan 2, c] /
 * [d colspan 2] / [e, f, g]`).
 */
function markBook(): Document {
  const doc = tableDocument();
  const section = doc.bodies[0]!.content[0] as unknown as { content: unknown[] };
  section.content.push(
    {
      type: 'table',
      attrs: { nodeId: 'm2', id: 'named' },
      content: [
        row('m2-r0', [cell('m2-a', 'a'), cell('m2-b', 'b'), cell('m2-c', 'c')]),
        row('m2-r1', [cell('m2-d', 'd'), cell('m2-e', 'e')]),
        row('m2-r2', [cell('m2-f', 'f'), cell('m2-g', 'g'), cell('m2-h', 'h')]),
      ],
    },
    {
      type: 'table',
      attrs: { nodeId: 'm3' },
      content: [
        row('m3-r0', [cell('m3-a', 'a'), cell('m3-b', 'b', { rowspan: 2 }), cell('m3-c', 'c')]),
        row('m3-r1', [cell('m3-d', 'd', { colspan: 2 })]),
        row('m3-r2', [cell('m3-e', 'e'), cell('m3-f', 'f'), cell('m3-g', 'g')]),
      ],
    },
  );
  return doc;
}

/** A book whose irregular table is too large to edit: 4195 cells of colspan 1000, then one. */
function bigBook(): Document {
  const doc = tableDocument();
  const section = doc.bodies[0]!.content[0] as unknown as { content: unknown[] };
  section.content.push({
    type: 'table',
    attrs: { nodeId: 'big' },
    content: [
      row(
        'big-r0',
        Array.from({ length: 4195 }, (_, index) =>
          cell(`big-${index}`, `w${index}`, { colspan: 1000 }),
        ),
      ),
      row('big-r1', [cell('big-x', 'x')]),
    ],
  });
  return doc;
}

async function popoverHarness(doc: Document): Promise<TablesHarness> {
  const harness = await tablesHarness(doc);
  render(<DialogHost service={harness.services.dialogs.service} />);
  return harness;
}

/** Opens the popover of the table `tableNodeId`; resolves with the promise of its closing. */
function open(
  harness: TablesHarness,
  tableNodeId: string,
): { closed: Promise<void>; done: () => boolean } {
  const target = activeTableTarget(harness.store)!;
  let finished = false;
  let closed!: Promise<void>;
  act(() => {
    closed = openTableMarkPopover(harness.ctx, target, {
      tableNodeId,
      anchor: new DOMRect(100, 50, 14, 14),
    }).then(() => {
      finished = true;
    });
  });
  return { closed, done: () => finished };
}

const popover = () => screen.queryByTestId('dialog-table-mark');

describe('the mark popover (data-model §3.5; I16, I17)', () => {
  it('lists the parts with the hint, Repair table and Close; titles an unnamed table “Irregular table” and a named one with the mark’s name', async () => {
    const harness = await popoverHarness(markBook());
    act(() => caretIn(harness, 't1-1-1', 1));
    const first = open(harness, 'm3');
    expect(await screen.findByTestId('dialog-table-mark')).toHaveAttribute('aria-modal', 'false');
    expect(screen.getByTestId('dialog-table-mark-title')).toHaveTextContent('Irregular table');
    const items = screen.getByTestId('dialog-table-mark-problems').querySelectorAll('li');
    expect([...items].map((item) => item.textContent)).toEqual([
      'row 2 covers 2 of 3 columns',
      '1 overlapping span',
    ]);
    expect(popover()).toHaveTextContent(
      'Repair table makes the table regular. No cell content is deleted, and Undo brings the table back.',
    );
    const repair = screen.getByTestId('dialog-table-mark-button-repair');
    expect(repair).toHaveTextContent('Repair table');
    expect(repair).toBeEnabled();
    expect(document.activeElement).toBe(repair);
    fireEvent.click(screen.getByTestId('dialog-table-mark-button-close'));
    await first.closed;
    expect(popover()).toBeNull();
    // A named table: Validate's named variant as the title (C61).
    const second = open(harness, 'm2');
    expect(await screen.findByTestId('dialog-table-mark-title')).toHaveTextContent(
      'Irregular table "named": row 2 covers 2 of 3 columns',
    );
    fireEvent.click(screen.getByTestId('dialog-table-mark-button-close'));
    await second.closed;
  });

  it('Repair table is disabled under a script’s and an assistant’s run lock, with its reason as the title and the focus on Close', async () => {
    const harness = await popoverHarness(markBook());
    for (const [kind, reason] of [
      ['script', 'a script is running; wait until it ends'],
      ['ai', 'a request to the AI assistant is running; wait until it ends'],
    ] as const) {
      act(() => actions.setRunLock(harness.store, fakeRunLock(kind)));
      const one = open(harness, 'm3');
      const repair = await screen.findByTestId('dialog-table-mark-button-repair');
      expect(repair, kind).toBeDisabled();
      expect(repair, kind).toHaveAttribute('title', reason);
      expect(document.activeElement, kind).toBe(
        screen.getByTestId('dialog-table-mark-button-close'),
      );
      // The lock ends while the popover is open: Repair table is available again.
      act(() => actions.setRunLock(harness.store, null));
      await waitFor(() =>
        expect(screen.getByTestId('dialog-table-mark-button-repair')).toBeEnabled(),
      );
      expect(screen.getByTestId('dialog-table-mark-button-repair')).not.toHaveAttribute('title');
      fireEvent.keyDown(screen.getByTestId('dialog-table-mark'), { key: 'Escape' });
      await one.closed;
    }
  });

  it('Repair table is disabled with the too-large reason on a table too large to edit', async () => {
    const harness = await popoverHarness(bigBook());
    const one = open(harness, 'big');
    const repair = await screen.findByTestId('dialog-table-mark-button-repair');
    expect(repair).toBeDisabled();
    expect(repair).toHaveAttribute('title', harness.ctx.t('tables.reason.too-large'));
    expect(document.activeElement).toBe(screen.getByTestId('dialog-table-mark-button-close'));
    fireEvent.click(screen.getByTestId('dialog-table-mark-button-close'));
    await one.closed;
  }, 30_000);

  it('Escape and a mousedown outside close it', async () => {
    const harness = await popoverHarness(markBook());
    const first = open(harness, 'm3');
    await screen.findByTestId('dialog-table-mark');
    fireEvent.keyDown(screen.getByTestId('dialog-table-mark'), { key: 'Escape' });
    await first.closed;
    expect(popover()).toBeNull();
    const second = open(harness, 'm3');
    await screen.findByTestId('dialog-table-mark');
    // A mousedown inside keeps it open; one outside closes it.
    fireEvent.mouseDown(screen.getByTestId('dialog-table-mark-problems'));
    expect(popover()).not.toBeNull();
    fireEvent.mouseDown(document.body);
    await second.closed;
    expect(popover()).toBeNull();
  });

  it('Repair table repairs the table of that node id - not the caret’s table - through target.run once, as one undo-coordinator entry, and the popover closes', async () => {
    const harness = await popoverHarness(markBook());
    const { controller, services } = harness;
    act(() => caretIn(harness, 't1-1-1', 1));
    const target = activeTableTarget(harness.store)!;
    const run = vi.spyOn(target, 'run');
    const before = controller.editorState!.doc;
    const t1 = before.nodeAt(posOf(harness, 't1'));
    const entries = services.undo.entries().length;
    const one = open(harness, 'm3');
    fireEvent.click(await screen.findByTestId('dialog-table-mark-button-repair'));
    await one.closed;
    expect(run).toHaveBeenCalledTimes(1);
    expect(services.undo.entries().length).toBe(entries + 1);
    const doc = controller.editorState!.doc;
    expect(doc.nodeAt(posOf(harness, 't1'))).toBe(t1);
    const m3 = doc.nodeAt(posOf(harness, 'm3'))!;
    expect(m3.child(1).childCount).toBe(2);
    expect(m3.child(1).child(0).attrs.colspan).toBeNull();
    expect(doc.nodeAt(posOf(harness, 'm2'))).toBe(before.nodeAt(posOf(harness, 'm2')));
    // The caret stays where it was.
    expect(controller.editorState!.selection.$head.parent.attrs.nodeId).toBe('t1-1-1');
    run.mockRestore();
  });

  it('closes when its table turns regular or disappears', async () => {
    const harness = await popoverHarness(markBook());
    const { controller, services, ctx } = harness;
    const first = open(harness, 'm2');
    await screen.findByTestId('dialog-table-mark');
    // Repaired through the command, with the caret in it.
    act(() => caretIn(harness, 'm2-e', 1));
    await act(async () => {
      expect(await services.commands.execute('table.repair', ctx)).toBe(true);
    });
    await first.closed;
    expect(popover()).toBeNull();
    // Deleted.
    const second = open(harness, 'm3');
    await screen.findByTestId('dialog-table-mark');
    act(() => {
      controller.execute((state, dispatch) => {
        const at = posOf(harness, 'm3');
        dispatch?.(state.tr.delete(at, at + state.doc.nodeAt(at)!.nodeSize));
        return true;
      });
    });
    await second.closed;
    expect(popover()).toBeNull();
    expect(second.done()).toBe(true);
  });
});
