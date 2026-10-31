// Shared by "Удалить все пробелы в выделении" and "Удалить все пробелы и дефисы в выделении"
// (FictionBook Editor 2.7.9, 18_Мелочи редактирования 17 and 18, Sclex, v1.3; converted from
// their 2.7beta1 versions "Удаление пробелов" and "Удаление пробелов и дефисов" first and brought
// up to 2.7.9 in feature 007) and by their sibling 20, "Удалить все символы подчеркивания в
// выделении" (converted from 2.7.9 in feature 007). Each of the three packages carries an
// identical copy; the originals' notices are in the packages' index.js.
//
// The originals removed every match of their expression from the selected text of every text
// block of the page - 2.7.9's isInsideP: any text inside a P of fbw_body, the book's annotation
// and history included - keeping the formatting, and left the processed text selected; without
// a text selection they said "Ничего не выделено!". Here the bodies' paragraphs are written with
// doc.replaceNode and the annotation's and the history's with one doc.setDescription
// (lib/page-paragraphs.js on lib/nav-lib.js's page).

import { PageEdits, hasContent, paragraphsOfSelection, textSelection, t } from './lib/page-paragraphs.js';

/**
 * Rewrites the inline content of a text block: `transform` is applied to the text inside
 * [start, end) (offsets in the block's text, inline leaves count as 1), marks are kept.
 * Returns the new content and how many characters were removed.
 */
export function transformRange(content, start, end, transform) {
  const out = [];
  let offset = 0;
  let removed = 0;
  for (const item of content) {
    if (item.type !== 'text') {
      out.push(item);
      offset += 1;
      continue;
    }
    const itemStart = offset;
    const itemEnd = offset + item.text.length;
    offset = itemEnd;
    const a = Math.max(start, itemStart);
    const b = Math.min(end, itemEnd);
    if (a >= b) {
      out.push(item);
      continue;
    }
    const before = item.text.slice(0, a - itemStart);
    const inside = item.text.slice(a - itemStart, b - itemStart);
    const after = item.text.slice(b - itemStart);
    const replaced = transform(inside);
    removed += inside.length - replaced.length;
    const text = before + replaced + after;
    if (text) out.push({ ...item, text });
  }
  return { content: out, removed };
}

export async function stripSelectedText(ctx, pattern) {
  const found = await textSelection();
  if (!found) {
    await mfbe.ui.message(t(ctx, 'Ничего не выделено!', 'Nothing is selected!'), { icon: 'warning' });
    return;
  }
  const { book, where } = found;
  const edits = new PageEdits();
  let removedInLast = 0;
  for (const item of paragraphsOfSelection(book, where)) {
    if (ctx.cancelled) return;
    if (!hasContent(item)) continue;
    const content = item.node.content ?? [];
    const length = content.reduce((n, c) => n + (c.type === 'text' ? c.text.length : 1), 0);
    const start = item.index === where.start.index ? where.start.offset : 0;
    const end = item.index === where.end.index ? where.end.offset : length;
    const result = transformRange(content, start, end, (text) => text.replace(pattern, ''));
    if (result.removed === 0) continue;
    await edits.put(item, { ...item.node, content: result.content });
    if (item.index === where.end.index) removedInLast = result.removed;
  }
  await edits.commit();
  // The original left the processed text selected.
  const from = where.start.item;
  const to = where.end.item;
  if (from?.nodeId && to?.nodeId && from.kind === 'p' && to.kind === 'p') {
    await mfbe.selection.set(
      { nodeId: from.nodeId, offset: where.start.offset },
      { nodeId: to.nodeId, offset: where.end.offset - removedInLast },
    );
  } else {
    await mfbe.selection.set(where.selection.anchor, where.selection.head).catch(() => {});
  }
}
