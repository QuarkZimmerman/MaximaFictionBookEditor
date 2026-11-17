/**
 * Notes written with superscript numbers, as AI-generated texts write them (the requester's decision after his
 * smoke test of 0.0.12-rc.1, issue #16): "туристов¹" in the text, and after a thematic break the notes, each a
 * paragraph beginning with its number ("¹ В Плоском мире…"). Where that is unambiguous - every note's number
 * stands exactly once in the text since the notes before, and every paragraph after the break is a note - the
 * Markdown is written again in Markdown's own footnote syntax ([^…] and [^…]:), which the import makes into
 * FB2 notes as it does for any footnote. Anything else is left as it is.
 */

const DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const MARKER = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu;
/** A thematic break: three or more -, * or _ (CommonMark). */
const BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** A note: a paragraph beginning with its superscript number and a space. */
const NOTE = /^( {0,3})([⁰¹²³⁴⁵⁶⁷⁸⁹]+)[ \t]+(?=\S)/u;

const numberOf = (marker: string): number =>
  Number([...marker].map((digit) => DIGITS.indexOf(digit)).join(''));

/** A line with its inline code spans blanked, so that markers inside them are not counted or changed. */
const withoutCode = (line: string): string =>
  line.replace(/`[^`\n]*`/g, (span) => ' '.repeat(span.length));

interface NotesBlock {
  /** The thematic break before the notes. */
  open: number;
  /** The notes' first lines: [line, number]. */
  notes: [number, number][];
  /** The line after the block's last note paragraph. */
  end: number;
  /** A thematic break right after the notes that closes them (at the end, or before a heading), if any. */
  close: number | null;
}

export function superscriptNotes(markdown: string): string {
  if (!/[⁰¹²³⁴⁵⁶⁷⁸⁹]/u.test(markdown)) return markdown;
  const lines = markdown.split('\n');
  const code = new Array<boolean>(lines.length).fill(false);
  for (let i = 0, fence = ''; i < lines.length; i++) {
    const match = FENCE.exec(lines[i]);
    if (fence) {
      code[i] = true;
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length) fence = '';
    } else if (match) {
      code[i] = true;
      fence = match[1];
    }
  }
  const blank = (i: number): boolean => lines[i].trim() === '';
  const isBreak = (i: number): boolean => !code[i] && BREAK.test(lines[i]);
  const isHeading = (i: number): boolean => !code[i] && HEADING.test(lines[i]);

  // The notes blocks: a break, then only note paragraphs up to the next break, heading or the end.
  const blocks: NotesBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isBreak(i)) continue;
    const notes: [number, number][] = [];
    let j = i + 1;
    let ok = true;
    while (j < lines.length && !isBreak(j) && !isHeading(j)) {
      if (blank(j)) {
        j++;
        continue;
      }
      const note = code[j] ? null : NOTE.exec(lines[j]);
      if (!note) {
        ok = false;
        break;
      }
      notes.push([j, numberOf(note[2])]);
      while (j < lines.length && !blank(j) && !isBreak(j) && !isHeading(j)) j++;
    }
    if (!ok || notes.length === 0) continue;
    let close: number | null = null;
    if (j < lines.length && isBreak(j)) {
      let k = j + 1;
      while (k < lines.length && blank(k)) k++;
      if (k >= lines.length || isHeading(k)) close = j;
    }
    blocks.push({ open: i, notes, end: j, close });
    i = j - 1;
  }
  if (blocks.length === 0) return markdown;

  const out = [...lines];
  const dropped = new Set<number>();
  let from = 0;
  blocks.forEach((block, n) => {
    const segment = { from, to: block.open };
    from = block.close !== null ? block.close + 1 : block.end;
    const numbers = block.notes.map(([, number]) => number);
    if (new Set(numbers).size !== numbers.length) return;
    // Every note's number exactly once in the text before it, and no note without its place there.
    const places = new Map<number, number>();
    for (let i = segment.from; i < segment.to; i++) {
      if (code[i]) continue;
      for (const match of withoutCode(lines[i]).matchAll(MARKER)) {
        const number = numberOf(match[0]);
        places.set(number, (places.get(number) ?? 0) + 1);
      }
    }
    if (!numbers.every((number) => places.get(number) === 1)) return;
    const label = (number: number): string => `sup${n + 1}-${number}`;
    const wanted = new Set(numbers);
    for (let i = segment.from; i < segment.to; i++) {
      if (code[i]) continue;
      const masked = withoutCode(lines[i]);
      let line = '';
      let last = 0;
      for (const match of masked.matchAll(MARKER)) {
        const number = numberOf(match[0]);
        if (!wanted.has(number)) continue;
        line += `${lines[i].slice(last, match.index)}[^${label(number)}]`;
        last = match.index! + match[0].length;
      }
      if (last > 0) out[i] = line + lines[i].slice(last);
    }
    for (const [line, number] of block.notes)
      out[line] = lines[line].replace(
        NOTE,
        (_all, indent: string) => `${indent}[^${label(number)}]: `,
      );
    dropped.add(block.open);
    if (block.close !== null) dropped.add(block.close);
  });
  return out.filter((_, i) => !dropped.has(i)).join('\n');
}
