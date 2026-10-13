/**
 * Words tool session (data-model.md §2.5): the rows of the Words dialog with their states, the
 * sort order, the show/hide-exclusions filter and the current word. Pure, framework-free so
 * the dialog stays a thin view and the operations are unit-testable.
 *
 * A row carries three independent flags - `highlighted` (the original's list selection),
 * `replaced` (HASREPL: the replacement is applied by OK) and `excluded` (WARN: the word is in
 * the exclusion list) - and `rowState()` derives the single display state of the data model
 * (excluded > replaced > highlighted > normal).
 */

import type { WordStat } from './rpc';

export type RowState = 'normal' | 'highlighted' | 'replaced' | 'excluded';

export interface WordRow {
  word: string;
  count: number;
  replacement: string;
  highlighted: boolean;
  replaced: boolean;
  excluded: boolean;
}

export type SortColumn = 'word' | 'replacement' | 'count';

export interface SortOrder {
  column: SortColumn;
  direction: 'asc' | 'desc';
}

export function rowState(row: Pick<WordRow, 'highlighted' | 'replaced' | 'excluded'>): RowState {
  if (row.excluded) return 'excluded';
  if (row.replaced) return 'replaced';
  if (row.highlighted) return 'highlighted';
  return 'normal';
}

/**
 * Default replacement: the original listed hyphenated words with the hyphen removed
 * ("some-thing" -> "something", OCR hyphenation leftovers); other words start empty.
 */
export function defaultReplacement(word: string): string {
  return /[\u002D\u2010\u2011]/.test(word) &&
    !/^[\u002D\u2010\u2011]|[\u002D\u2010\u2011]$/.test(word)
    ? word.replace(/[\u002D\u2010\u2011]/g, '')
    : '';
}

export function rowsFromAnalysis(words: readonly WordStat[]): WordRow[] {
  return words.map((stat) => ({
    word: stat.word,
    count: stat.count,
    replacement: defaultReplacement(stat.word),
    highlighted: false,
    replaced: false,
    excluded: stat.excluded,
  }));
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function compareRows(a: WordRow, b: WordRow, order: SortOrder): number {
  let result: number;
  switch (order.column) {
    case 'word':
      result = collator.compare(a.word, b.word) || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0);
      break;
    case 'replacement':
      result = collator.compare(a.replacement, b.replacement) || collator.compare(a.word, b.word);
      break;
    case 'count':
      result = a.count - b.count || collator.compare(a.word, b.word);
      break;
  }
  return order.direction === 'asc' ? result : -result;
}

/** A replacement that OK will carry out: marked, non-empty and different from the word. */
export function isEffectiveReplacement(row: WordRow): boolean {
  return row.replaced && row.replacement.trim() !== '' && row.replacement !== row.word;
}

export class WordsSession {
  private rows: WordRow[] = [];
  showExclusions: boolean;
  sort: SortOrder = { column: 'word', direction: 'asc' };
  /** The row of the "Current word" box (by word), or null. */
  currentWord: string | null = null;
  totalWords = 0;
  durationMs = 0;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(options: { showExclusions: boolean }) {
    this.showExclusions = options.showExclusions;
  }

  /* ---------------------------------------------------------------- state */

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Monotonic change counter for `useSyncExternalStore`. */
  getVersion = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  load(words: readonly WordStat[], totals: { totalWords: number; durationMs: number }): void {
    this.rows = rowsFromAnalysis(words);
    this.totalWords = totals.totalWords;
    this.durationMs = totals.durationMs;
    this.currentWord = this.visibleRows()[0]?.word ?? null;
    this.emit();
  }

  /** Every row, hidden exclusions included. */
  allRows(): readonly WordRow[] {
    return this.rows;
  }

  row(word: string): WordRow | undefined {
    return this.rows.find((r) => r.word === word);
  }

  /** Rows shown by the table in the current sort order. */
  visibleRows(): WordRow[] {
    const rows = this.showExclusions ? this.rows : this.rows.filter((r) => !r.excluded);
    return rows.slice().sort((a, b) => compareRows(a, b, this.sort));
  }

  hiddenExclusionCount(): number {
    return this.showExclusions ? 0 : this.rows.filter((r) => r.excluded).length;
  }

  get current(): WordRow | null {
    return this.currentWord ? (this.row(this.currentWord) ?? null) : null;
  }

  setCurrent(word: string | null): void {
    if (this.currentWord === word) return;
    this.currentWord = word;
    this.emit();
  }

  /* -------------------------------------------------------------- sorting */

  /** Clicking a header sorts by it; clicking the active header flips the direction. */
  sortBy(column: SortColumn): void {
    if (this.sort.column === column) {
      this.sort = { column, direction: this.sort.direction === 'asc' ? 'desc' : 'asc' };
    } else {
      this.sort = { column, direction: column === 'count' ? 'desc' : 'asc' };
    }
    this.emit();
  }

  /* ---------------------------------------------------------- row editing */

  private mutate(word: string, change: (row: WordRow) => Partial<WordRow>): boolean {
    const index = this.rows.findIndex((r) => r.word === word);
    if (index < 0) return false;
    this.rows[index] = { ...this.rows[index]!, ...change(this.rows[index]!) };
    return true;
  }

  setReplacement(word: string, replacement: string, markReplaced = true): void {
    if (
      this.mutate(word, (row) => ({
        replacement,
        replaced: markReplaced ? replacement.trim() !== '' : row.replaced,
      }))
    ) {
      this.emit();
    }
  }

  toggleHighlight(word: string): void {
    if (this.mutate(word, (row) => ({ highlighted: !row.highlighted }))) this.emit();
  }

  setHighlighted(word: string, highlighted: boolean): void {
    if (this.mutate(word, () => ({ highlighted }))) this.emit();
  }

  toggleReplaced(word: string): void {
    if (this.mutate(word, (row) => ({ replaced: !row.replaced }))) this.emit();
  }

  /** "Highlight all": every visible row becomes highlighted. */
  highlightAll(): void {
    const visible = new Set(this.visibleRows().map((r) => r.word));
    this.rows = this.rows.map((r) => (visible.has(r.word) ? { ...r, highlighted: true } : r));
    this.emit();
  }

  /** "Invert": flips the highlight of every visible row. */
  invertHighlight(): void {
    const visible = new Set(this.visibleRows().map((r) => r.word));
    this.rows = this.rows.map((r) =>
      visible.has(r.word) ? { ...r, highlighted: !r.highlighted } : r,
    );
    this.emit();
  }

  /** "Set replaced": highlighted rows get the replaced flag. */
  setReplacedForHighlighted(): void {
    this.rows = this.rows.map((r) => (r.highlighted ? { ...r, replaced: true } : r));
    this.emit();
  }

  /** "Reset replaced": highlighted rows lose the replaced flag. */
  resetReplacedForHighlighted(): void {
    this.rows = this.rows.map((r) => (r.highlighted ? { ...r, replaced: false } : r));
    this.emit();
  }

  /** "Set replaced all": every visible row gets the replaced flag. */
  setReplacedAll(): void {
    const visible = new Set(this.visibleRows().map((r) => r.word));
    this.rows = this.rows.map((r) => (visible.has(r.word) ? { ...r, replaced: true } : r));
    this.emit();
  }

  /** Highlighted rows that are not excluded yet (the candidates of "To exclusions"). */
  highlightedForExclusion(): WordRow[] {
    return this.rows.filter((r) => r.highlighted && !r.excluded);
  }

  /** Marks `words` excluded (after `words.exclusions` accepted them); hidden rows lose `replaced`. */
  markExcluded(words: readonly string[], excluded = true): void {
    const set = new Set(words);
    this.rows = this.rows.map((r) =>
      set.has(r.word)
        ? {
            ...r,
            excluded,
            highlighted: excluded ? false : r.highlighted,
            replaced: excluded && !this.showExclusions ? false : r.replaced,
          }
        : r,
    );
    if (this.current && set.has(this.current.word) && excluded && !this.showExclusions) {
      this.currentWord = this.visibleRows()[0]?.word ?? null;
    }
    this.emit();
  }

  setShowExclusions(show: boolean): void {
    if (this.showExclusions === show) return;
    this.showExclusions = show;
    if (!show && this.current?.excluded) this.currentWord = this.visibleRows()[0]?.word ?? null;
    this.emit();
  }

  /** One occurrence of `word` was replaced in the body: the count drops; the row goes at 0. */
  decrementCount(word: string): void {
    const row = this.row(word);
    if (!row) return;
    if (row.count <= 1) {
      this.rows = this.rows.filter((r) => r.word !== word);
      if (this.currentWord === word) this.currentWord = this.visibleRows()[0]?.word ?? null;
    } else {
      this.mutate(word, (r) => ({ count: r.count - 1 }));
    }
    this.emit();
  }

  /** The rows OK applies (document-wide, as one undo entry). */
  effectiveReplacements(): WordRow[] {
    return this.visibleRows().filter(isEffectiveReplacement);
  }
}
