/**
 * The status bar's caret and selection information of the Body and Source views (feature 009,
 * User Story 5; FR-051, FR-052, FR-057, data-model §8), and the feed that writes it into the
 * store at most once per animation frame, counting the words of a long selection in idle chunks.
 */

import type { EditorState as SourceState } from '@codemirror/state';
import type { EditorState as BodyState } from 'prosemirror-state';

import { actions, type AppStore, type CaretInfo } from '@/model/store';

import { CHUNKED_COUNT_LIMIT, countChars, countWords, countWordsInChunks } from './statusInfo';

/** The last code point of `text` (a surrogate pair taken whole). */
function lastCodePoint(text: string): number | undefined {
  if (!text) return undefined;
  const last = text.charCodeAt(text.length - 1);
  if (last >= 0xdc00 && last <= 0xdfff && text.length >= 2)
    return text.codePointAt(text.length - 2);
  return last;
}

/** The code point `text` consists of, when it is exactly one. */
function singleCodePoint(text: string): number | undefined {
  const cp = text.codePointAt(0);
  return cp !== undefined && String.fromCodePoint(cp).length === text.length ? cp : undefined;
}

/** A measurement: the pane information, and a long selection's text to count in chunks. */
export interface CaretMeasure {
  info: CaretInfo;
  longText?: string;
}

function selectionInfo(
  view: CaretInfo['view'],
  plain: string,
  spaced: string,
  units: number,
  extra: Partial<CaretInfo> = {},
): CaretMeasure {
  const chars = countChars(plain);
  const long = chars > CHUNKED_COUNT_LIMIT;
  return {
    info: {
      view,
      ...extra,
      char: singleCodePoint(plain),
      selection: { chars, words: long ? null : countWords(spaced), units },
    },
    ...(long ? { longText: spaced } : {}),
  };
}

/** The Body view: the character before the caret, or the selection's counts by paragraph. */
export function bodyCaretInfo(state: BodyState): CaretMeasure {
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    const parent = $from.parent;
    const before = parent.isTextblock
      ? parent.textBetween(Math.max(0, $from.parentOffset - 2), $from.parentOffset, undefined, '')
      : '';
    return { info: { view: 'body', char: lastCodePoint(before) } };
  }
  let paragraphs = 0;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isTextblock) return true;
    paragraphs += 1;
    return false;
  });
  return selectionInfo(
    'body',
    state.doc.textBetween(from, to, '', ''),
    state.doc.textBetween(from, to, ' ', ' '),
    paragraphs,
  );
}

/** The Source view: line and column, the character before the caret, the selection's counts. */
export function sourceCaretInfo(state: SourceState): CaretMeasure {
  const range = state.selection.main;
  const line = state.doc.lineAt(range.head);
  const position = {
    line: line.number,
    column: countChars(line.text.slice(0, range.head - line.from)) + 1,
  };
  if (range.empty) {
    const before =
      range.head > line.from
        ? state.doc.sliceString(Math.max(line.from, range.head - 2), range.head)
        : '';
    return { info: { view: 'source', ...position, char: lastCodePoint(before) } };
  }
  const text = state.doc.sliceString(range.from, range.to);
  const lines = state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number + 1;
  return selectionInfo('source', text.replace(/\r?\n/g, ''), text, lines, position);
}

const nextFrame: (step: () => void) => void =
  typeof requestAnimationFrame === 'function'
    ? (step) => {
        requestAnimationFrame(() => step());
      }
    : (step) => {
        setTimeout(step, 16);
      };

/** Writes a view's caret information at most once a frame (FR-057: within 100 ms). */
export class CaretInfoFeed {
  private scheduled = false;
  private measure: (() => CaretMeasure | null) | null = null;
  private cancelCount: (() => void) | null = null;

  constructor(private readonly store: AppStore) {}

  /** `measure` runs in the next animation frame; a later request replaces an earlier one. */
  request(measure: () => CaretMeasure | null): void {
    this.measure = measure;
    if (this.scheduled) return;
    this.scheduled = true;
    nextFrame(() => {
      this.scheduled = false;
      const run = this.measure;
      this.measure = null;
      if (run) this.publish(run());
    });
  }

  private publish(measure: CaretMeasure | null): void {
    this.cancelCount?.();
    this.cancelCount = null;
    if (!measure) return;
    const info = measure.info;
    actions.setCaretInfo(this.store, info);
    if (measure.longText !== undefined && info.selection) {
      const selection = info.selection;
      this.cancelCount = countWordsInChunks(measure.longText, (words) => {
        if (this.store.getState().caretInfo === info) {
          actions.setCaretInfo(this.store, { ...info, selection: { ...selection, words } });
        }
      });
    }
  }
}
