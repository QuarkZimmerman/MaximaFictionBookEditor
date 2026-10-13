/**
 * Words tool (US10, T136): the whole-word pattern mirroring the core's segmentation, the
 * session state machine (highlight / replaced / excluded, sorting, show/hide exclusions), and
 * the dialog itself against a fake `words.analyze` and a text-backed Body search target - OK
 * applies every marked replacement as ONE undo entry and reports "N replacement(s) done".
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CommandContext } from '@/app/commands';
import { WordsDialog } from '@/dialogs/WordsDialog';
import { expandReplacement } from '@/features/search/replacement';
import { getSearchSession, type FindOptions, type SearchTarget } from '@/features/search/search';
import { wordFindOptions, wordRegExp } from '@/features/words/apply';
import { WordsSession, rowState, rowsFromAnalysis } from '@/features/words/session';
import { changeLanguage, initI18n } from '@/i18n';
import { actions } from '@/model/store';
import { ArrayHistoryAdapter } from '@/model/undo';

import {
  fakeDocument,
  fakeRpc,
  makeContext,
  type FakeDialogs,
  type FakeRpc,
} from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

/* ------------------------------------------------------------------------ */
/* Pattern                                                                  */
/* ------------------------------------------------------------------------ */

describe('wordRegExp', () => {
  const matches = (word: string, text: string) =>
    [...text.matchAll(wordRegExp(word))].map((m) => m.index);

  it('matches whole words only, case-sensitively', () => {
    expect(matches('teh', 'teh Teh teh, "teh" teh.')).toEqual([0, 8, 14, 19]);
    expect(matches('teh', 'tehran bateh')).toEqual([]);
  });

  it('does not match a word glued to another by an apostrophe or hyphen', () => {
    expect(matches('don', "don don't")).toEqual([0]);
    expect(matches('foo', 'foo foo-bar bar-foo -foo foo-')).toEqual([0, 21, 25]);
    expect(matches('foo-bar', 'foo-bar foo-bar-baz')).toEqual([0]);
  });

  it('tolerates soft hyphens inside the word and handles digits like the core', () => {
    expect(matches('something', 'some\u00ADthing something')).toEqual([0, 11]);
    expect(matches('abc1', 'abc1 abc12 1abc1')).toEqual([0]);
  });

  it('works with Cyrillic and combining marks', () => {
    expect(matches('ещё', 'ещё ещёр ещё')).toEqual([0, 9]);
    expect(matches('e\u0301t\u0301', 'e\u0301t\u0301 xe\u0301t\u0301')).toEqual([0]);
  });

  it('produces find options the search feature accepts (regex, case-sensitive)', () => {
    const options = wordFindOptions('teh');
    expect(options).toMatchObject({ regex: true, matchCase: true, wholeWord: false });
    expect(new RegExp(options.query, 'gu').test('a teh b')).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* Session                                                                  */
/* ------------------------------------------------------------------------ */

const ANALYSIS = [
  { word: 'teh', count: 3, excluded: false },
  { word: 'recieve', count: 2, excluded: false },
  { word: 'some-thing', count: 1, excluded: false },
  { word: 'ibid', count: 4, excluded: true },
  { word: 'Alpha', count: 5, excluded: false },
];

describe('WordsSession', () => {
  function session(show = false): WordsSession {
    const s = new WordsSession({ showExclusions: show });
    s.load(ANALYSIS, { totalWords: 15, durationMs: 1 });
    return s;
  }

  it('hides exclusions by default, sorts by word (case-insensitive) and toggles sort direction', () => {
    const s = session();
    expect(s.visibleRows().map((r) => r.word)).toEqual(['Alpha', 'recieve', 'some-thing', 'teh']);
    expect(s.hiddenExclusionCount()).toBe(1);
    s.sortBy('count');
    expect(s.visibleRows().map((r) => r.count)).toEqual([5, 2, 3, 1].sort((a, b) => b - a));
    s.sortBy('count');
    expect(s.visibleRows().map((r) => r.count)).toEqual([1, 2, 3, 5]);
    s.setShowExclusions(true);
    expect(s.visibleRows().map((r) => r.word)).toEqual([
      'some-thing',
      'recieve',
      'teh',
      'ibid',
      'Alpha',
    ]);
    expect(s.hiddenExclusionCount()).toBe(0);
  });

  it('gives hyphenated words their de-hyphenated default replacement', () => {
    const rows = rowsFromAnalysis(ANALYSIS);
    expect(rows.find((r) => r.word === 'some-thing')?.replacement).toBe('something');
    expect(rows.find((r) => r.word === 'teh')?.replacement).toBe('');
  });

  it('Highlight all / Invert / Set replaced / Reset replaced / Set replaced all / To exclusions', () => {
    const s = session();
    s.highlightAll();
    expect(s.visibleRows().every((r) => r.highlighted)).toBe(true);
    expect(s.row('ibid')?.highlighted).toBe(false); // hidden rows are not touched
    s.invertHighlight();
    expect(s.visibleRows().some((r) => r.highlighted)).toBe(false);
    s.toggleHighlight('teh');
    s.toggleHighlight('recieve');
    s.setReplacedForHighlighted();
    expect(s.row('teh')?.replaced).toBe(true);
    expect(s.row('recieve')?.replaced).toBe(true);
    expect(s.row('Alpha')?.replaced).toBe(false);
    s.resetReplacedForHighlighted();
    expect(s.row('teh')?.replaced).toBe(false);
    s.setReplacedAll();
    expect(s.visibleRows().every((r) => r.replaced)).toBe(true);
    expect(rowState(s.row('teh')!)).toBe('replaced');
    // To exclusions: highlighted rows become excluded and vanish while exclusions are hidden.
    expect(s.highlightedForExclusion().map((r) => r.word)).toEqual(['teh', 'recieve']);
    s.markExcluded(['teh', 'recieve']);
    expect(s.visibleRows().map((r) => r.word)).toEqual(['Alpha', 'some-thing']);
    expect(s.row('teh')).toMatchObject({ excluded: true, replaced: false, highlighted: false });
    expect(rowState(s.row('teh')!)).toBe('excluded');
    s.setShowExclusions(true);
    expect(s.visibleRows().map((r) => r.word)).toContain('teh');
    s.markExcluded(['teh'], false);
    expect(s.row('teh')?.excluded).toBe(false);
  });

  it('only marked, non-empty, different replacements are effective; counts decrement', () => {
    const s = session();
    s.setReplacedAll();
    s.setReplacement('teh', 'the');
    s.setReplacement('Alpha', 'Alpha');
    expect(s.effectiveReplacements().map((r) => r.word)).toEqual(['some-thing', 'teh']);
    s.setCurrent('teh');
    s.decrementCount('teh');
    expect(s.row('teh')?.count).toBe(2);
    s.decrementCount('teh');
    s.decrementCount('teh');
    expect(s.row('teh')).toBeUndefined();
    expect(s.current?.word).toBe('Alpha');
  });

  it('derives the display state with the documented precedence', () => {
    expect(rowState({ highlighted: false, replaced: false, excluded: false })).toBe('normal');
    expect(rowState({ highlighted: true, replaced: false, excluded: false })).toBe('highlighted');
    expect(rowState({ highlighted: true, replaced: true, excluded: false })).toBe('replaced');
    expect(rowState({ highlighted: true, replaced: true, excluded: true })).toBe('excluded');
  });
});

/* ------------------------------------------------------------------------ */
/* Dialog                                                                   */
/* ------------------------------------------------------------------------ */

const BOOK_TEXT = 'teh cat saw teh dog and teh bird; recieve recieve; some-thing Alpha ibid';

/** A Body search target over a plain string with its own undo history. */
class TextTarget implements SearchTarget {
  readonly view = 'body' as const;
  text = BOOK_TEXT;
  selection: { from: number; to: number } | null = null;
  readonly history = new ArrayHistoryAdapter<{ before: string; after: string }>((change, dir) => {
    this.text = dir === 'undo' ? change.before : change.after;
  });
  replaceAllCalls: { options: FindOptions; replacement: string }[] = [];

  constructor(private readonly record: () => void) {}

  private regex(options: FindOptions) {
    return new RegExp(options.query, `g${options.matchCase ? '' : 'i'}u`);
  }

  findNext(options: FindOptions): boolean {
    const re = this.regex(options);
    re.lastIndex = this.selection ? this.selection.to : 0;
    let match = re.exec(this.text);
    if (!match) {
      re.lastIndex = 0;
      match = re.exec(this.text);
    }
    if (!match) return false;
    this.selection = { from: match.index, to: match.index + match[0].length };
    return true;
  }

  replaceCurrent(options: FindOptions, replacement: string): boolean {
    if (!this.selection) return false;
    const before = this.text;
    const match = this.regex(options).exec(this.text.slice(this.selection.from));
    if (!match || match.index !== 0) return false;
    this.text =
      this.text.slice(0, this.selection.from) + replacement + this.text.slice(this.selection.to);
    this.selection = { from: this.selection.from, to: this.selection.from + replacement.length };
    this.history.push({ before, after: this.text });
    this.record();
    return true;
  }

  replaceAll(options: FindOptions, replacement: string): number {
    this.replaceAllCalls.push({ options, replacement });
    const before = this.text;
    let count = 0;
    this.text = this.text.replace(this.regex(options), (...args) => {
      count += 1;
      return expandReplacement(replacement, [args[0] as string]).text;
    });
    if (count > 0) {
      this.history.push({ before, after: this.text });
      this.record();
    }
    return count;
  }

  selectedText(): string {
    return this.selection ? this.text.slice(this.selection.from, this.selection.to) : '';
  }

  markAnchor(): void {}
  restoreAnchor(): void {}
  clearAnchor(): void {}
}

interface Harness {
  ctx: CommandContext & { dialogs: FakeDialogs };
  rpc: FakeRpc;
  target: TextTarget;
  onClose: ReturnType<typeof vi.fn>;
  user: ReturnType<typeof userEvent.setup>;
}

async function setup(
  options: { showExclusions?: boolean; viaJob?: boolean } = {},
): Promise<Harness> {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  let exclusions = ['ibid'];
  const rpc = fakeRpc({
    'words.analyze': (params: unknown) => {
      const p = params as { includeExclusions?: boolean };
      const words = ANALYSIS.filter((w) => p.includeExclusions || !w.excluded).map((w) => ({
        ...w,
        excluded: exclusions.includes(w.word),
      }));
      return { words, entries: words, totalWords: 15, durationMs: 2 };
    },
    'words.exclusions': (params: unknown) => {
      const p = (params ?? {}) as { add?: string[]; remove?: string[] };
      if ((p.add ?? []).some((w) => !/^[\p{L}]+(-[\p{L}]+)?$/u.test(w))) {
        throw Object.assign(new Error('invalid exclusion word'), { code: -32602 });
      }
      exclusions = [...exclusions.filter((w) => !(p.remove ?? []).includes(w)), ...(p.add ?? [])];
      return { words: exclusions };
    },
    'settings.set': (params: unknown) => ({
      settings: {
        ...defaultSettings(),
        words: (params as { patch: { words: unknown } }).patch.words,
      },
      restartRequired: false,
    }),
  });
  const ctx = await makeContext({ rpc: rpc.client });
  const settings = defaultSettings();
  settings.words.showExclusionsInWordsDialog = options.showExclusions ?? false;
  actions.setConnection(ctx.store, 'connected');
  actions.setSettings(ctx.store, settings);
  actions.setDocument(ctx.store, fakeDocument());
  actions.setActiveView(ctx.store, 'body');
  const target = new TextTarget(() => ctx.undo.record('body', 'edit'));
  ctx.undo.registerView('body', target.history);
  getSearchSession(ctx.store, ctx.undo).registerTarget(target);
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<WordsDialog ctx={ctx} onClose={onClose} viewportRows={4} rowHeight={24} />);
  await waitFor(() =>
    expect(screen.getByTestId('words-table')).toHaveAttribute('data-status', 'ready'),
  );
  return { ctx, rpc, target, onClose, user };
}

const row = (index: number) => screen.getByTestId(`words-row-${index}`);

describe('WordsDialog', () => {
  it('lists Word / Replacement / Count sortable columns and hides exclusions by default', async () => {
    const { user } = await setup();
    expect(screen.getByTestId('words-grid')).toHaveAttribute('data-row-count', '4');
    expect(row(0)).toHaveAttribute('data-word', 'Alpha');
    expect(screen.getByTestId('words-row-0-count')).toHaveTextContent('5');
    expect(screen.getByTestId('words-row-2-replacement')).toHaveTextContent('something');
    expect(screen.queryByText('ibid')).not.toBeInTheDocument();
    expect(screen.getByTestId('words-summary')).toHaveTextContent('5 distinct words, 15 in total');
    expect(screen.getByTestId('words-summary')).toHaveTextContent('1 exclusion hidden');

    await user.click(screen.getByTestId('words-sort-count'));
    expect(row(0)).toHaveAttribute('data-word', 'Alpha'); // 5 first (descending)
    expect(row(3)).toHaveAttribute('data-word', 'some-thing');
    await user.click(screen.getByTestId('words-sort-count'));
    expect(row(0)).toHaveAttribute('data-word', 'some-thing');

    await user.click(screen.getByTestId('words-show-exclusions'));
    expect(screen.getByTestId('words-grid')).toHaveAttribute('data-row-count', '5');
    expect(screen.getByText('ibid').closest('[role="row"]')).toHaveAttribute(
      'data-state',
      'excluded',
    );
  });

  it('changes row states with Highlight all / Invert / Set replaced / Reset replaced / Set replaced all / To exclusions', async () => {
    const { user, rpc } = await setup();
    await user.click(screen.getByTestId('words-highlight-all'));
    for (let i = 0; i < 4; i += 1) expect(row(i)).toHaveAttribute('data-highlighted', 'true');
    expect(row(0)).toHaveAttribute('data-state', 'highlighted');
    await user.click(screen.getByTestId('words-invert'));
    for (let i = 0; i < 4; i += 1) expect(row(i)).toHaveAttribute('data-highlighted', 'false');

    await user.click(screen.getByTestId('words-row-1-highlight')); // recieve
    await user.click(screen.getByTestId('words-row-3-highlight')); // teh
    await user.click(screen.getByTestId('words-set-replaced'));
    expect(row(1)).toHaveAttribute('data-replaced', 'true');
    expect(row(3)).toHaveAttribute('data-state', 'replaced');
    expect(row(0)).toHaveAttribute('data-replaced', 'false');
    await user.click(screen.getByTestId('words-reset-replaced'));
    expect(row(1)).toHaveAttribute('data-replaced', 'false');
    await user.click(screen.getByTestId('words-set-replaced-all'));
    for (let i = 0; i < 4; i += 1) expect(row(i)).toHaveAttribute('data-replaced', 'true');

    // To exclusions: the two highlighted rows go to the list and disappear (exclusions hidden).
    await user.click(screen.getByTestId('words-to-exclusions'));
    await waitFor(() =>
      expect(screen.getByTestId('words-grid')).toHaveAttribute('data-row-count', '2'),
    );
    const call = rpc.calls.find(
      (c) => c.method === 'words.exclusions' && c.params && 'add' in (c.params as object),
    );
    expect((call!.params as { add: string[] }).add.sort()).toEqual(['recieve', 'teh']);
    expect(screen.getByTestId('words-summary')).toHaveTextContent('3 exclusions hidden');
  });

  it('edits the replacement inline (click, type, Enter) and marks the row replaced', async () => {
    const { user } = await setup();
    await user.click(screen.getByTestId('words-row-3-replacement')); // teh
    const input = await screen.findByTestId('words-row-3-replacement-input');
    await user.type(input, 'the{Enter}');
    expect(screen.getByTestId('words-row-3-replacement')).toHaveTextContent('the');
    expect(row(3)).toHaveAttribute('data-replaced', 'true');
    expect(screen.getByTestId('words-current-word')).toHaveValue('teh');
    expect(screen.getByTestId('words-current-replacement')).toHaveValue('the');
    // Escape cancels an edit.
    await user.click(screen.getByTestId('words-row-1-replacement'));
    await user.type(await screen.findByTestId('words-row-1-replacement-input'), 'xx{Escape}');
    expect(screen.getByTestId('words-row-1-replacement')).toHaveTextContent('');
  });

  it('Find / Next / Replace act on the current word in the body', async () => {
    const { user, target, ctx } = await setup();
    await user.click(screen.getByTestId('words-row-3-word')); // teh
    expect(screen.getByTestId('words-find')).toHaveTextContent('Find');
    expect(screen.getByTestId('words-replace')).toBeDisabled();
    await user.click(screen.getByTestId('words-find'));
    expect(target.selectedText()).toBe('teh');
    expect(target.selection).toEqual({ from: 0, to: 3 });
    expect(screen.getByTestId('words-find')).toHaveTextContent('Next');
    await user.click(screen.getByTestId('words-find'));
    expect(target.selection).toEqual({ from: 12, to: 15 });

    // A replacement is needed before Replace is enabled.
    fireEvent.change(screen.getByTestId('words-current-replacement'), { target: { value: 'the' } });
    expect(screen.getByTestId('words-replace')).toBeEnabled();
    await user.click(screen.getByTestId('words-replace'));
    expect(target.text).toBe(
      'teh cat saw the dog and teh bird; recieve recieve; some-thing Alpha ibid',
    );
    expect(screen.getByTestId('words-row-3-count')).toHaveTextContent('2');
    // ... and the next occurrence is selected already.
    expect(target.selection).toEqual({ from: 24, to: 27 });
    expect(ctx.undo.undoDepth).toBe(1);

    // No occurrence: "Cannot find the string".
    await user.click(screen.getByTestId('words-row-0-word')); // Alpha
    target.text = target.text.replace('Alpha', 'Omega');
    await user.click(screen.getByTestId('words-find'));
    expect(ctx.dialogs.shown.at(-1)?.text).toBe("Cannot find the string 'Alpha'.");
    expect(screen.getByTestId('words-find')).toHaveTextContent('Find');
  });

  it('OK applies all marked replacements as one undo entry and reports the count', async () => {
    const { user, target, ctx, onClose } = await setup();
    await user.click(screen.getByTestId('words-row-3-replacement'));
    await user.type(await screen.findByTestId('words-row-3-replacement-input'), 'the{Enter}');
    await user.click(screen.getByTestId('words-row-1-replacement'));
    await user.type(await screen.findByTestId('words-row-1-replacement-input'), 'receive{Enter}');
    // some-thing has its default replacement but is not marked: Set replaced all marks it.
    await user.click(screen.getByTestId('words-set-replaced-all'));
    // Alpha is marked too but its replacement is empty: skipped.
    await user.click(screen.getByTestId('dialog-words-button-ok'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(ctx.dialogs.shown).toHaveLength(1));
    expect(ctx.dialogs.shown[0]!.text).toBe('6 replacements done');
    expect(ctx.dialogs.shown[0]!.caption).toBe('Replace words');
    expect(ctx.store.getState().statusMessage).toBe('6 replacements done');
    expect(target.text).toBe(
      'the cat saw the dog and the bird; receive receive; something Alpha ibid',
    );
    expect(target.replaceAllCalls.map((c) => c.replacement)).toEqual([
      'receive',
      'something',
      'the',
    ]);
    // ONE undo entry: a single Undo restores everything.
    expect(ctx.undo.undoDepth).toBe(3);
    expect(new Set(ctx.undo.entries().map((e) => e.groupId)).size).toBe(1);
    expect(ctx.undo.peekUndo()?.label).toBe('Replace words');
    act(() => {
      ctx.undo.undo();
    });
    expect(target.text).toBe(BOOK_TEXT);
    expect(ctx.undo.canUndo).toBe(false);
  });

  it('OK without marked replacements just closes; Cancel discards', async () => {
    const { user, target, ctx, onClose } = await setup();
    await user.click(screen.getByTestId('words-row-3-replacement'));
    await user.type(await screen.findByTestId('words-row-3-replacement-input'), 'the{Enter}');
    await user.click(screen.getByTestId('dialog-words-button-cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(target.text).toBe(BOOK_TEXT);
    expect(ctx.dialogs.shown).toHaveLength(0);
  });

  it('keyboard: arrows move the current word, Space highlights, F4 edits', async () => {
    const { user } = await setup();
    const grid = screen.getByTestId('words-grid');
    grid.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('words-current-word')).toHaveValue('recieve');
    await user.keyboard(' ');
    expect(row(1)).toHaveAttribute('data-highlighted', 'true');
    await user.keyboard('{F4}');
    expect(await screen.findByTestId('words-row-1-replacement-input')).toBeInTheDocument();
  });

  it('virtualises the table: only the rows around the viewport are mounted', async () => {
    await initI18n({ language: 'en' });
    const many = Array.from({ length: 500 }, (_, i) => ({
      word: `word${String(i).padStart(3, '0')}`,
      count: 1,
      excluded: false,
    }));
    const rpc = fakeRpc({ 'words.analyze': { words: many, totalWords: 500, durationMs: 1 } });
    const ctx = await makeContext({ rpc: rpc.client });
    actions.setConnection(ctx.store, 'connected');
    actions.setSettings(ctx.store, defaultSettings());
    actions.setDocument(ctx.store, fakeDocument());
    render(<WordsDialog ctx={ctx} onClose={() => {}} viewportRows={4} rowHeight={24} />);
    await waitFor(() =>
      expect(screen.getByTestId('words-grid')).toHaveAttribute('data-row-count', '500'),
    );
    const mounted = screen.getAllByRole('row').filter((r) => r.hasAttribute('data-word'));
    expect(mounted.length).toBeLessThan(40);
    expect(mounted[0]).toHaveAttribute('data-word', 'word000');
    fireEvent.scroll(screen.getByTestId('words-grid'), { target: { scrollTop: 24 * 300 } });
    const after = screen.getAllByRole('row').filter((r) => r.hasAttribute('data-word'));
    expect(after.some((r) => r.getAttribute('data-word') === 'word300')).toBe(true);
    expect(after.some((r) => r.getAttribute('data-word') === 'word000')).toBe(false);
  });
});
