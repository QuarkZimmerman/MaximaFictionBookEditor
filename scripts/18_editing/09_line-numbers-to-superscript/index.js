// Converted from 18_Мелочи редактирования/09_Нумерацию в началах строк - надстрочным текстом.js
// (FictionBook Editor 2.7), Tier 1. In every paragraph touched by the selection (not subtitles
// or text-authors) a number at the very start followed by one or more spaces / non-breaking
// spaces becomes a superscript and the run of spaces collapses to its first character. The
// original matched `^(tags)*?([0-9]+?)(tags)*?( |nbsp)( |nbsp)*` on the HTML, where the only
// tags allowed around the number were EM/I/B/STRONG; here that means the number may carry
// emphasis/strong marks but nothing else (no link, no existing superscript).

const PROCESSED = new Set(['p', 'v', 'td', 'th']);
const SPACE = '[ \u00A0]';
const LEADING_RE = new RegExp(`^(\\d+)(${SPACE})(${SPACE}*)([\\s\\S]*)$`);
const SPACES_RE = new RegExp(`^(${SPACE})(${SPACE}*)([\\s\\S]*)$`);

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

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

export default async function run(ctx) {
  const selection = await mfbe.selection.get();
  if (!selection || !selection.text) {
    await mfbe.ui.message(
      t(ctx,
        'Нет выделения.\n\nПеред запуском скрипта нужно выделить текст, который будет обработан, а именно: будут сделаны надстрочными индексами числа в началах абзацев, попавших в выделение, после которых (чисел) идет пробел. И если после числа в начале абзаца идет несколько пробелов (простых или неразрывных), они будут заменены на один пробел.',
        'Nothing is selected.\n\nSelect the text to process before running the script: numbers at the start of the paragraphs that fall into the selection and are followed by a space become superscripts; several spaces (plain or non-breaking) after such a number are replaced by one.'),
      { icon: 'warning' },
    );
    return;
  }
  await mfbe.ui.status(t(ctx, 'Делаем числа в началах абзацев надстрочным текстом…', 'Making the numbers at paragraph starts superscript…'));
  const { anchor, head, nodes } = selection;
  const forward = anchor.nodeId === head.nodeId ? anchor.offset <= head.offset : nodes[0]?.nodeId === anchor.nodeId;
  const [from, to] = forward ? [anchor, head] : [head, anchor];
  let removedInLast = 0;
  for (const block of nodes) {
    if (!PROCESSED.has(block.type)) continue;
    const node = await mfbe.doc.getNode(block);
    const content = superscriptNumber(node.content ?? []);
    if (!content) continue;
    await mfbe.doc.replaceNode(block, { ...node, content });
    if (block.nodeId === to.nodeId) {
      const length = (items) => items.reduce((n, c) => n + (c.type === 'text' ? c.text.length : 1), 0);
      removedInLast = length(node.content ?? []) - length(content);
    }
  }
  // The original re-selected the processed range.
  await mfbe.selection.set(
    { nodeId: from.nodeId, offset: from.offset },
    { nodeId: to.nodeId, offset: Math.max(0, to.offset - removedInLast) },
  );
  await mfbe.ui.status('OK', { sticky: true });
}
