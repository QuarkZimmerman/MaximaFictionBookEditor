/**
 * The validation warning `table.irregular` in the Validation panel (feature 006, T126; FR-062;
 * US8 sc.11; C61; I3, I20; U4, U23; contracts/rpc-api.md §3.2 "Message" and "Go to"; data-model
 * §3.7): `issueMessage` renders it as the mark's name - its problems with their plurals, the
 * named variant for a table with an id - in English, Russian and Ukrainian, and the navigator goes
 * to the table's node from the Body view, to its `<table` line from a clean Source view and to the
 * line and UTF-16 column of the text form from a dirty one; a table the Body view lacks (the
 * source book's annotation) goes to its Source line.
 */

import { createInstance, type i18n as I18n, type TFunction } from 'i18next';

import { createIssueNavigator, issueMessage, issueMessageKey } from '@/dialogs/validation';
import { tableProblemParts } from '@/editor/table/problems';
import { initI18n } from '@/i18n';
import type { ValidationIssue } from '@/model/document';
import { actions } from '@/model/store';

import { fakeDocument, makeContext } from '../features/testUtils';

let i18n: I18n;
const t = {} as Record<'en' | 'ru' | 'uk', TFunction>;

beforeAll(async () => {
  i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  for (const language of ['en', 'ru', 'uk'] as const) t[language] = i18n.getFixedT(language);
});

function warning(params: Record<string, unknown>, extra: Partial<ValidationIssue> = {}) {
  return { severity: 'warning', code: 'table.irregular', params, ...extra } as ValidationIssue;
}

describe('table.irregular in the Validation panel', () => {
  it('renders its problems in en, ru and uk, with plurals, with and without id', () => {
    expect(issueMessageKey('table.irregular')).toBe('validation.table.irregular');
    const tooltipExample = {
      rows: 3,
      columns: 3,
      shortRows: 1,
      row: 2,
      covered: 2,
      overlaps: 1,
      pastEnd: 0,
    };
    expect(issueMessage(warning(tooltipExample), t.en, i18n)).toBe(
      'Irregular table: row 2 covers 2 of 3 columns; 1 overlapping span',
    );
    expect(issueMessage(warning({ ...tooltipExample, overlaps: 0, id: 't2' }), t.en, i18n)).toBe(
      'Irregular table "t2": row 2 covers 2 of 3 columns',
    );
    expect(
      issueMessage(
        warning({ rows: 3, columns: 4, shortRows: 2, row: 1, covered: 3, overlaps: 1, pastEnd: 1 }),
        t.en,
        i18n,
      ),
    ).toBe(
      'Irregular table: 2 rows cover fewer than 4 columns; 1 overlapping span; 1 span reaches past the last row',
    );
    expect(
      issueMessage(
        warning({ rows: 2, columns: 1, shortRows: 1, row: 2, covered: 0, overlaps: 0, pastEnd: 0 }),
        t.en,
        i18n,
      ),
    ).toBe('Irregular table: row 2 covers 0 of 1 column');
    // Russian and Ukrainian: the catalogue's plural forms for each count, the named variant.
    const summaries = [
      { rows: 2, columns: 4, shortRows: 0, overlaps: 2, pastEnd: 2 },
      { rows: 9, columns: 5, shortRows: 5, row: 1, covered: 1, overlaps: 21, pastEnd: 1 },
      { rows: 3, columns: 1, shortRows: 1, row: 3, covered: 0, overlaps: 0, pastEnd: 0, id: 'tab' },
    ];
    for (const language of ['ru', 'uk'] as const) {
      for (const summary of summaries) {
        const problems = tableProblemParts(summary, t[language]).join(
          t[language]('tables.problem.separator'),
        );
        const expected = summary.id
          ? t[language]('validation.table.irregularNamed', { id: summary.id, problems })
          : t[language]('validation.table.irregular', { problems });
        const text = issueMessage(warning(summary), t[language], i18n);
        expect(text, `${language} ${JSON.stringify(summary)}`).toBe(expected);
        expect(text).not.toMatch(/\{\{|missing/);
      }
    }
    // The plural forms differ by count: 2 and 21 overlapping spans read differently in Russian.
    const two = tableProblemParts(summaries[0]!, t.ru)[0]!;
    const twentyOne = tableProblemParts(summaries[1]!, t.ru)[1]!;
    expect(two.replace('2', '')).not.toBe(twentyOne.replace('21', ''));
  });

  it('the navigator goes to the table node from the Body view, to the <table line from a clean Source view, and to its line and column from a dirty one; a node the Body view lacks falls back to its Source line', async () => {
    const ctx = await makeContext();
    actions.setDocument(ctx.store, fakeDocument());
    const body = vi.fn((caret: { nodeId?: string }) => caret.nodeId !== 'source-book-table');
    const source = vi.fn(() => true);
    ctx.carets!.register('body', { get: () => null, set: body });
    ctx.carets!.register('source', { get: () => null, set: source });
    const navigate = createIssueNavigator(ctx);
    const params = {
      rows: 3,
      columns: 3,
      shortRows: 1,
      row: 2,
      covered: 2,
      overlaps: 0,
      pastEnd: 0,
    };

    // From the Body view: the table's node (its first cell's start, `selectionFor`).
    actions.setActiveView(ctx.store, 'body');
    expect(await navigate(warning(params, { nodeId: 't2-node', line: 196 }))).toBe(true);
    expect(body).toHaveBeenLastCalledWith({ view: 'body', nodeId: 't2-node' });
    expect(source).not.toHaveBeenCalled();

    // From a clean Source view: the <table line (the editor puts the cursor on its first
    // non-blank character, the `<`).
    actions.setActiveView(ctx.store, 'source');
    expect(await navigate(warning(params, { nodeId: 't2-node', line: 196 }))).toBe(true);
    expect(source).toHaveBeenLastCalledWith({ view: 'source', line: 196, column: 1 });

    // From a dirty Source view: the text form's line and UTF-16 column (U4).
    ctx.store.setState({ sourceDirty: true });
    body.mockClear();
    expect(await navigate(warning(params, { nodeId: 'scratch-1', line: 196, column: 21 }))).toBe(
      true,
    );
    expect(source).toHaveBeenLastCalledWith({ view: 'source', line: 196, column: 21 });
    expect(body).not.toHaveBeenCalled();

    // A table of the source book's annotation has no node in the Body view: its Source line.
    ctx.store.setState({ sourceDirty: false });
    actions.setActiveView(ctx.store, 'body');
    source.mockClear();
    expect(await navigate(warning(params, { nodeId: 'source-book-table', line: 63 }))).toBe(true);
    expect(body).toHaveBeenLastCalledWith({ view: 'body', nodeId: 'source-book-table' });
    expect(source).toHaveBeenLastCalledWith({ view: 'source', line: 63, column: 1 });
    expect(ctx.store.getState().activeView).toBe('source');
  });
});
