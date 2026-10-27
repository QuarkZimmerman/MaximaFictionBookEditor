/**
 * `insert.table` in the Source view (feature 006, T055 for T068; FR-061; FR-040 to FR-043 for
 * the Source view; FR-048; US1 sc.10; I23, I27; C6, C28, C36; data-model §4.5 `insert.table`,
 * §9.6; resource-formats.md §9 `tables.reason.source.*`): with the Source view active the
 * command is enabled exactly where the controller's verdict is `ok`; otherwise its reason is
 * `tables.reason.source.<code>` (with `{line}` and `{element}`), in English, Russian and
 * Ukrainian, or the run lock's text under a script and an assistant request; its run opens the
 * Table properties dialog with `session.tableDialog`, on OK stores the values and inserts the
 * table's XML after checking the verdict again, and changes nothing on Cancel; and the test
 * hook `__mfbeTest.sourceTable.sweep(offsets)` gives `{offset, enabled, code}` with the
 * registry's state and restores the selection - present only for a page that asks for hooks.
 */

import i18next from 'i18next';

import { createAppServices } from '@/app/services';
import { sourceTableReason, sourceTableVerdict } from '@/features/tables/sourceTable';
import { actions, createAppStore } from '@/model/store';
import type { SourceVerdict } from '@/views/source/tablePoint';

import { defaultSettings } from '../settings/fixtures';
import {
  POINTS,
  SOURCE_BOOK,
  afterIn,
  removeSourceHosts,
  selectSource,
  sourceHarness,
  stubRangeRects,
  type SourceHarness,
} from '../source/sourceHarness';
import { fakeDialogs, fakeRunLock } from './testUtils';

interface SweepAnswer {
  offset: number;
  enabled: boolean;
  code: string;
}

function sweepHook(): ((offsets: number[]) => SweepAnswer[]) | undefined {
  const hooks = window.__mfbeTest?.sourceTable as
    { sweep(offsets: number[]): SweepAnswer[] } | undefined;
  return hooks ? (offsets) => hooks.sweep(offsets) : undefined;
}

beforeAll(() => {
  stubRangeRects();
});

beforeEach(() => {
  delete window.__mfbeTest;
  window.history.replaceState(null, '', '/');
});

afterEach(async () => {
  removeSourceHosts();
  await i18next.changeLanguage('en');
});

afterAll(() => {
  window.history.replaceState(null, '', '/');
});

const enabled = (h: SourceHarness) => h.services.commands.isEnabled('insert.table', h.ctx);
const reason = (h: SourceHarness) => h.services.commands.unavailableReason('insert.table', h.ctx);

const SPEC = { rows: 2, columns: 3, headerRow: false, headerColumn: false };

describe('insert.table with the Source view active', () => {
  it('is enabled exactly where the verdict is ok', async () => {
    const h = await sourceHarness();
    const expected: Record<keyof typeof POINTS, string> = {
      between: 'ok',
      between2: 'ok',
      inText: 'inText',
      inTag: 'inTag',
      titleEpigraph: 'notAllowed',
      afterAuthor: 'notAllowed',
      outside: 'outsideRoot',
    };
    for (const [name, offset] of Object.entries(POINTS)) {
      selectSource(h.controller, offset);
      const verdict = h.controller.tablePoint();
      expect(verdict.code, name).toBe(expected[name as keyof typeof POINTS]);
      expect(sourceTableVerdict(h.store)).toEqual(verdict);
      expect(enabled(h), name).toBe(verdict.code === 'ok');
    }
  });

  it('gives the verdict’s reason, with its line or its element', async () => {
    const h = await sourceHarness();
    selectSource(h.controller, POINTS.inText);
    expect(reason(h)).toBe(i18next.t('tables.reason.source.inText'));
    selectSource(h.controller, POINTS.titleEpigraph);
    expect(reason(h)).toBe(i18next.t('tables.reason.source.notAllowed', { element: 'section' }));
    expect(reason(h)).toContain('<section>');
    selectSource(h.controller, POINTS.between);
    expect(reason(h)).toBeNull();
    // A broken closing tag: notWellFormed with the line of the first problem.
    const broken = SOURCE_BOOK.replace('<p>Second</p>', '<p>Second</p');
    const b = await sourceHarness({ text: broken });
    selectSource(b.controller, afterIn(broken, '<p>First</p>'));
    expect(b.controller.tablePoint()).toEqual({ code: 'notWellFormed', line: 12 });
    expect(enabled(b)).toBe(false);
    expect(reason(b)).toBe(i18next.t('tables.reason.source.notWellFormed', { line: 12 }));
  });

  it('is unavailable with the loading reason before the text is there', async () => {
    const h = await sourceHarness({ mounted: false });
    h.controller.reset();
    expect(sourceTableVerdict(h.store)).toEqual({ code: 'loading' });
    expect(enabled(h)).toBe(false);
    expect(reason(h)).toBe(i18next.t('tables.reason.source.loading'));
  });

  it('words every reason in English, Russian and Ukrainian', async () => {
    const verdicts: SourceVerdict[] = [
      { code: 'loading' },
      { code: 'failed' },
      { code: 'analysing' },
      { code: 'notWellFormed', line: 42 },
      { code: 'inTag' },
      { code: 'inMarkup' },
      { code: 'outsideRoot' },
      { code: 'inText' },
      { code: 'notAllowed', element: 'cite' },
    ];
    await sourceHarness();
    const seen = new Set<string>();
    for (const lang of ['en', 'ru', 'uk']) {
      await i18next.changeLanguage(lang);
      for (const verdict of verdicts) {
        const text = sourceTableReason(verdict, i18next.t);
        const params =
          'line' in verdict ? { line: 42 } : 'element' in verdict ? { element: 'cite' } : {};
        expect(text, `${lang} ${verdict.code}`).toBe(
          i18next.t(`tables.reason.source.${verdict.code}`, params),
        );
        expect(text).not.toContain('tables.reason');
        seen.add(text!);
      }
      expect(sourceTableReason({ code: 'notWellFormed', line: 42 }, i18next.t)).toContain('42');
      expect(sourceTableReason({ code: 'notAllowed', element: 'cite' }, i18next.t)).toContain(
        '<cite>',
      );
    }
    expect(seen.size).toBe(verdicts.length * 3);
    expect(
      sourceTableReason(
        {
          code: 'ok',
          pos: 1,
          parent: { name: 'section', from: 0, openTo: 1, closeFrom: 2, to: 3 },
          prefix: '',
        },
        i18next.t,
      ),
    ).toBeNull();
  });

  it('is unavailable with the run lock’s text under a script and an assistant request', async () => {
    const h = await sourceHarness();
    selectSource(h.controller, POINTS.between);
    expect(enabled(h)).toBe(true);
    actions.setRunLock(h.store, fakeRunLock('script'));
    expect(enabled(h)).toBe(false);
    expect(reason(h)).toBe(i18next.t('commands.unavailable.runLock.script'));
    actions.setRunLock(h.store, fakeRunLock('ai'));
    expect(reason(h)).toBe(i18next.t('commands.unavailable.runLock.ai'));
    actions.setRunLock(h.store, null);
    expect(enabled(h)).toBe(true);
  });
});

describe('running insert.table in the Source view', () => {
  function withStoredDialog(h: SourceHarness) {
    const stored = { rows: 4, columns: 3, headerRow: true, headerColumn: false };
    const settings = defaultSettings();
    h.store.setState({
      settings: { ...settings, session: { ...settings.session, tableDialog: stored } },
    });
    return stored;
  }

  const settingsCalls = (h: SourceHarness) =>
    h.rpc.calls.filter((call) => call.method === 'settings.set');

  it('opens the dialog with session.tableDialog; OK stores the values and inserts the table', async () => {
    const h = await sourceHarness();
    const stored = withStoredDialog(h);
    selectSource(h.controller, POINTS.between);
    const dialogs = fakeDialogs([], [SPEC]);
    await h.services.commands.execute('insert.table', { ...h.ctx, dialogs });
    expect(dialogs.custom).toHaveLength(1);
    expect(dialogs.custom[0]!.props.initial).toEqual(stored);
    expect(settingsCalls(h).map((call) => call.params)).toEqual([
      { patch: { session: { tableDialog: SPEC } } },
    ]);
    const text = h.controller.text;
    expect(text).toContain(
      '<p>First</p>\n\t\t\t<table>\n\t\t\t\t<tr>\n\t\t\t\t\t<td></td>\n\t\t\t\t\t<td></td>\n\t\t\t\t\t<td></td>\n\t\t\t\t</tr>',
    );
    const cursor = h.controller.state.selection.main.head;
    expect(text.slice(cursor - 4, cursor + 5)).toBe('<td></td>');
    expect(h.store.getState().sourceDirty).toBe(true);
  });

  it('changes nothing on Cancel', async () => {
    const h = await sourceHarness();
    withStoredDialog(h);
    selectSource(h.controller, POINTS.between);
    const dialogs = fakeDialogs([], [null]);
    await h.services.commands.execute('insert.table', { ...h.ctx, dialogs });
    expect(dialogs.custom).toHaveLength(1);
    expect(settingsCalls(h)).toEqual([]);
    expect(h.controller.text).toBe(SOURCE_BOOK);
  });

  it('checks the verdict again after OK: no table where the cursor went meanwhile', async () => {
    const h = await sourceHarness();
    withStoredDialog(h);
    selectSource(h.controller, POINTS.between);
    const dialogs = fakeDialogs();
    dialogs.openCustom = <T>() => {
      selectSource(h.controller, POINTS.inText);
      return Promise.resolve(SPEC as T);
    };
    await h.services.commands.execute('insert.table', { ...h.ctx, dialogs });
    expect(h.controller.text).toBe(SOURCE_BOOK);
  });

  it('does not run where the verdict refuses', async () => {
    const h = await sourceHarness();
    selectSource(h.controller, POINTS.titleEpigraph);
    const dialogs = fakeDialogs([], [SPEC]);
    expect(await h.services.commands.execute('insert.table', { ...h.ctx, dialogs })).toBe(false);
    expect(dialogs.custom).toEqual([]);
  });
});

describe('__mfbeTest.sourceTable.sweep', () => {
  it('is absent without ?test=1', async () => {
    createAppServices({ store: createAppStore(), rpc: null, platform: 'linux' });
    await sourceHarness();
    expect(sweepHook()).toBeUndefined();
  });

  it('gives {offset, enabled, code} with the registry’s state and restores the selection', async () => {
    window.history.replaceState(null, '', '/?test=1');
    const h = await sourceHarness();
    const sweep = sweepHook();
    expect(sweep).toBeDefined();
    selectSource(h.controller, POINTS.inText - 1, POINTS.inText + 1);
    const offsets = [POINTS.between, POINTS.inText, POINTS.inTag, POINTS.titleEpigraph, 0];
    expect(sweep!(offsets)).toEqual([
      { offset: POINTS.between, enabled: true, code: 'ok' },
      { offset: POINTS.inText, enabled: false, code: 'inText' },
      { offset: POINTS.inTag, enabled: false, code: 'inTag' },
      { offset: POINTS.titleEpigraph, enabled: false, code: 'notAllowed' },
      { offset: 0, enabled: false, code: 'outsideRoot' },
    ]);
    expect(h.controller.state.selection.main).toMatchObject({
      anchor: POINTS.inText - 1,
      head: POINTS.inText + 1,
    });
    expect(h.controller.text).toBe(SOURCE_BOOK);
    // `enabled` is the registry's state: the run lock disables the command at an `ok` point.
    actions.setRunLock(h.store, fakeRunLock());
    expect(sweep!([POINTS.between])).toEqual([
      { offset: POINTS.between, enabled: false, code: 'ok' },
    ]);
  });
});
