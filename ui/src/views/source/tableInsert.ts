/**
 * The XML that *Add → Table* inserts in the Source view (feature 006, FR-061 "What", FR-003;
 * US1 sc.10; U35; data-model §7.3 "The inserted XML"; research R4.5), at a point the table
 * rule allowed (`tablePoint.ts`, the `ok` verdict):
 *
 *  - FR-003's table from the dialog's values: with *Header row* a first row of `<th></th>`, then
 *    the rows of `<td></td>`, each starting with `<th></th>` when *Header column* is set; the
 *    parent's namespace prefix on every name; no attribute;
 *  - laid out like the neighbours, as the writer writes (a tab per level): `<table>` at the
 *    indentation of the next child when it starts its own line, else of the line the previous
 *    child ends on, else the parent's own plus one unit; each `<tr>` one unit deeper and each
 *    cell two, one per line; the unit is the neighbours' step, else a tab. The spaces and tabs
 *    around the point are replaced, so the neighbours keep their lines and indentation, and the
 *    text's own line separator is used (`state.lineBreak`);
 *  - the compact one-line form `<table><tr><td></td>…</tr>…</table>` when the parent's start
 *    and end tags share a line - a minified file, also for a parent without children;
 *  - the cursor between the first cell's tags.
 *
 * The largest table, 999 × 64 with a header row, is about 66,000 lines in one change.
 */

import type { EditorState, Text } from '@codemirror/state';

import type { SourceTablePoint } from './tablePoint';

/** The Table properties dialog's values (the dialog's `TableProperties`, data-model §11.1). */
export interface SourceTableSpec {
  /** The normal rows, 1 to 999. */
  rows: number;
  /** 1 to 64. */
  columns: number;
  headerRow: boolean;
  headerColumn: boolean;
}

/** One line of the table: its nesting below `<table>` (0, 1 for a row, 2 for a cell). */
export interface SourceTableLine {
  depth: 0 | 1 | 2;
  text: string;
}

/** The change that inserts the table, and the cursor in the text after it. */
export interface SourceTableInsertion {
  from: number;
  to: number;
  insert: string;
  /** Between the first cell's tags, an offset of the text after the change. */
  cursor: number;
}

const MAX_ROWS = 999;
const MAX_COLUMNS = 64;

/** FR-003's table as lines, every name with `prefix` (`fb:table` for `fb`). */
export function sourceTableLines(spec: SourceTableSpec, prefix: string): SourceTableLine[] {
  const { rows, columns, headerRow, headerColumn } = spec;
  if (!Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS) {
    throw new RangeError(`rows must be 1 to ${MAX_ROWS}, not ${rows}`);
  }
  if (!Number.isInteger(columns) || columns < 1 || columns > MAX_COLUMNS) {
    throw new RangeError(`columns must be 1 to ${MAX_COLUMNS}, not ${columns}`);
  }
  const name = (local: string) => (prefix ? `${prefix}:${local}` : local);
  const cell = (local: 'td' | 'th') => `<${name(local)}></${name(local)}>`;
  const lines: SourceTableLine[] = [{ depth: 0, text: `<${name('table')}>` }];
  const row = (cells: string[]) => {
    lines.push({ depth: 1, text: `<${name('tr')}>` });
    for (const text of cells) lines.push({ depth: 2, text });
    lines.push({ depth: 1, text: `</${name('tr')}>` });
  };
  if (headerRow) row(Array.from({ length: columns }, () => cell('th')));
  for (let r = 0; r < rows; r += 1) {
    row(Array.from({ length: columns }, (_, c) => cell(c === 0 && headerColumn ? 'th' : 'td')));
  }
  lines.push({ depth: 0, text: `</${name('table')}>` });
  return lines;
}

/** The indentation of the line at `offset` and the offset of its first other character. */
function lineIndent(doc: Text, offset: number): { indent: string; first: number } {
  const line = doc.lineAt(offset);
  const indent = /^[ \t]*/.exec(line.text)![0];
  return { indent, first: line.from + indent.length };
}

const isBlank = (ch: string | undefined) => ch === ' ' || ch === '\t';
const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

/** How much text the white-space scans read at a time. */
const WINDOW = 256;

/** The first character after `from` (up to `limit`) that is not white space, or -1. */
function nextNonSpace(doc: Text, from: number, limit: number): number {
  for (let start = from; start < limit; start += WINDOW) {
    const text = doc.sliceString(start, Math.min(limit, start + WINDOW));
    for (let i = 0; i < text.length; i += 1) {
      if (!isSpace(text[i]!)) return start + i;
    }
  }
  return -1;
}

/** The offset after the last character before `to` (down to `limit`) that is not white space. */
function previousNonSpace(doc: Text, to: number, limit: number): number {
  for (let end = to; end > limit; end -= WINDOW) {
    const start = Math.max(limit, end - WINDOW);
    const text = doc.sliceString(start, end);
    for (let i = text.length - 1; i >= 0; i -= 1) {
      if (!isSpace(text[i]!)) return start + i + 1;
    }
  }
  return -1;
}

/** The change that inserts the table at an allowed point. */
export function planSourceTableInsertion(
  state: EditorState,
  point: SourceTablePoint,
  spec: SourceTableSpec,
): SourceTableInsertion {
  const doc = state.doc;
  const { pos, parent, prefix } = point;
  const lines = sourceTableLines(spec, prefix);
  const firstCell = lines[2]!.text;
  const cellOpen = firstCell.slice(0, firstCell.indexOf('>') + 1);

  // The compact form: the parent's start and end tags share a line (a minified file).
  if (doc.lineAt(parent.openTo).number === doc.lineAt(parent.closeFrom).number) {
    const insert = lines.map((line) => line.text).join('');
    return {
      from: pos,
      to: pos,
      insert,
      cursor: pos + lines[0]!.text.length + lines[1]!.text.length + cellOpen.length,
    };
  }

  // The spaces and tabs around the point go: the table takes their place.
  const line = doc.lineAt(pos);
  let left = pos - line.from;
  let right = left;
  while (left > 0 && isBlank(line.text[left - 1])) left -= 1;
  while (right < line.text.length && isBlank(line.text[right])) right += 1;
  const from = line.from + left;
  const to = line.from + right;

  // The indentation of the neighbours, and their step below the parent.
  const own = lineIndent(doc, parent.from).indent;
  let indent: string | null = null;
  const next = nextNonSpace(doc, to, parent.closeFrom);
  if (next >= 0) {
    const nextLine = lineIndent(doc, next);
    if (nextLine.first === next) indent = nextLine.indent;
  }
  if (indent === null) {
    const previous = previousNonSpace(doc, from, parent.openTo);
    if (previous > parent.openTo) {
      const previousLine = lineIndent(doc, previous - 1);
      if (previousLine.first >= parent.openTo) indent = previousLine.indent;
    }
  }
  const step =
    indent !== null && indent.length > own.length && indent.startsWith(own)
      ? indent.slice(own.length)
      : '';
  const unit = step || '\t';
  if (indent === null) indent = own + unit;

  const body = lines.map((entry) => indent + unit.repeat(entry.depth) + entry.text);
  const before = left === 0 ? '' : '\n';
  const after = right === line.text.length ? '' : `\n${indent}`;
  // Offsets count a line break as one character whatever the separator: plan with `\n`.
  const planned = before + body.join('\n') + after;
  const cursor =
    from +
    before.length +
    body[0]!.length +
    1 +
    body[1]!.length +
    1 +
    body[2]!.indexOf(cellOpen) +
    cellOpen.length;
  const separator = state.lineBreak;
  return {
    from,
    to,
    insert: separator === '\n' ? planned : planned.split('\n').join(separator),
    cursor,
  };
}
