// Converted from FictionBook Editor 2.7.9: Scripts/30_'Числовые' скрипты/40_Нумерацию 'число
// пробел' в началах выделенных абзацев сделать надстрочным текстом.js (Sclex, v1.2; first
// converted from 2.7beta1's 18_Мелочи редактирования/09_Нумерацию в началах строк - надстрочным
// текстом.js, which 2.7.9 moved to this group; the id stays 18/line-numbers-to-superscript).
// In every paragraph the selection touches (not subtitles, text authors or dates) - the book's
// annotation and history included, as in FictionBook Editor - a number at the very start followed
// by one or more spaces or non-breaking spaces becomes a superscript, and the spaces collapse to
// the first one (a non-breaking space stays one: 2.7.9 reads the paragraph's "&nbsp;" as the
// character, so a number followed by a non-breaking space is found, which 2.7beta1 missed). The
// original matched `^(tags)*?([0-9]+?)(tags)*?( |nbsp)( |nbsp)*` on the paragraph's HTML, where
// the only tags allowed around the number were EM/I/B/STRONG; here the number may carry emphasis
// or strong marks but nothing else (no link, no existing superscript). The bodies' paragraphs are
// written with doc.replaceNode, the annotation's and the history's with one doc.setDescription
// (lib/page-paragraphs.js on lib/nav-lib.js's page). Afterwards the processed text is selected.
// The original's notice, kept as written (FR-029):
//скрипт «Нумерацию 'число пробел' в началах абзацев сделать надстрочным текстом»
//автор Sclex
//v1.2

import { PageEdits, paragraphsOfSelection, textSelection, t } from './lib/page-paragraphs.js';

const PROCESSED = new Set(['p', 'v', 'td', 'th']);
const SPACE = '[ \u00A0]';
const LEADING_RE = new RegExp(`^(\\d+)(${SPACE})(${SPACE}*)([\\s\\S]*)$`);
const SPACES_RE = new RegExp(`^(${SPACE})(${SPACE}*)([\\s\\S]*)$`);

const plainOrEmphasis = (item) =>
  item.type === 'text' && (item.marks ?? []).every((m) => m.type === 'emphasis' || m.type === 'strong');

/** New content for a block whose text starts with "<number><spaces>", or null. */
export function superscriptNumber(content) {
  const [first, second, ...rest] = content;
  if (!first || !plainOrEmphasis(first)) return null;
  const withSup = (item, text) => ({ ...item, text, marks: [...(item.marks ?? []), { type: 'sup' }] });
  let match = LEADING_RE.exec(first.text);
  if (match) {
    const [, digits, space, , tail] = match;
    const remainder = space + tail;
    return [withSup(first, digits), ...(remainder ? [{ ...first, text: remainder }] : []), ...(second ? [second] : []), ...rest];
  }
  // "<strong>12</strong> text": the digits fill the first node, the spaces open the next one.
  if (!/^\d+$/.test(first.text) || !second || !plainOrEmphasis(second)) return null;
  match = SPACES_RE.exec(second.text);
  if (!match) return null;
  const [, space, , tail] = match;
  return [withSup(first, first.text), { ...second, text: space + tail }, ...rest];
}

const lengthOf = (items) => items.reduce((n, c) => n + (c.type === 'text' ? c.text.length : 1), 0);

export default async function run(ctx) {
  const found = await textSelection();
  if (!found) {
    await mfbe.ui.message(
      t(
        ctx,
        'Нет выделения.\n\nПеред запуском скрипта нужно выделить текст, который будет обработан, а именно: будут сделаны надстрочными индексами числа в началах абзацев, попавших в выделение, после которых (чисел) идет пробел. И если после числа в начале абзаца идет несколько пробелов (простых или неразрывных), они будут заменены на один пробел.',
        'Nothing is selected.\n\nSelect the text to process before running the script: numbers at the start of the paragraphs that fall into the selection and are followed by a space become superscripts; several spaces (plain or non-breaking) after such a number are replaced by one.',
      ),
      { icon: 'warning' },
    );
    return;
  }
  await mfbe.ui.status(t(ctx, 'Делаем числа в началах абзацев надстрочным текстом…', 'Making the numbers at paragraph starts superscript…'));
  const { book, where } = found;
  const edits = new PageEdits();
  let removedInLast = 0;
  for (const item of paragraphsOfSelection(book, where)) {
    if (ctx.cancelled) return;
    if (!item.nodeId || !PROCESSED.has(item.type)) continue;
    const old = item.node.content ?? [];
    const content = superscriptNumber(old);
    if (!content) continue;
    await edits.put(item, { ...item.node, content });
    if (item.index === where.end.index) removedInLast = lengthOf(old) - lengthOf(content);
  }
  await edits.commit();
  // The processed text is selected again.
  const from = where.start.item;
  const to = where.end.item;
  if (from?.nodeId && to?.nodeId && from.kind === 'p' && to.kind === 'p') {
    await mfbe.selection.set(
      { nodeId: from.nodeId, offset: where.start.offset },
      { nodeId: to.nodeId, offset: Math.max(0, where.end.offset - removedInLast) },
    );
  } else {
    await mfbe.selection.set(where.selection.anchor, where.selection.head).catch(() => {});
  }
  await mfbe.ui.status('OK', { sticky: true });
}
