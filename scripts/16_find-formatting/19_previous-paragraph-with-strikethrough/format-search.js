// Shared engine of the "Search of formatting" scripts (converted from the 24 scripts of
// 16_Поиск форматирования, FictionBook Editor 2.7, Tier 1). Each package carries its own copy:
// the sandbox only allows imports from inside the script's folder.
//
// The original scripts walked the HTML DOM from the caret looking for the next/previous
// EM/STRONG/SUP/SUB/STRIKE/SPAN.code element and placed the caret at its start (forward) or
// end (backward); the "paragraph" variants started the search from the next/previous block
// instead of the caret, i.e. they jump to the next paragraph containing the mark. Here the
// formatting lives in text marks, so an "element" is a maximal run of text carrying the mark.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//Скрипт набора «Поиск форматирования»
//Автор Sclex
//Топик про скрипты FBE: http://www.fictionbook.org/forum/viewtopic.php?t=4412
//Мой сайт про мои скрипты: http://scripts.fictionbook.org

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

const MARK_LABEL = {
  emphasis: { en: 'italics', ru: 'курсив' },
  strong: { en: 'bold', ru: 'жирность' },
  sup: { en: 'superscript', ru: 'верхний индекс' },
  sub: { en: 'subscript', ru: 'нижний индекс' },
  strikethrough: { en: 'strikethrough', ru: 'зачёркивание' },
  code: { en: 'code', ru: 'код' },
};

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/**
 * Document-order list of the structural nodes with, for text blocks, the runs of `mark`:
 * `{ nodeId, isText, runs: [{ start, end }] }` (offsets count characters, inline leaves as 1).
 */
async function collectBlocks(mark) {
  const order = [];
  const visit = (node) => {
    if (node.type === 'text') return;
    const entry = { nodeId: node.attrs?.nodeId, isText: TEXT_BLOCKS.has(node.type), runs: [] };
    if (entry.isText) {
      let offset = 0;
      let open = null;
      for (const item of node.content ?? []) {
        const length = item.type === 'text' ? item.text.length : 1;
        const marked =
          item.type === 'text' && length > 0 && (item.marks ?? []).some((m) => m.type === mark);
        if (marked) {
          if (!open) open = { start: offset, end: offset + length };
          else open.end = offset + length;
        } else if (open) {
          // An inline image or unmarked text closes the run, like a closing tag did.
          entry.runs.push(open);
          open = null;
        }
        offset += length;
      }
      if (open) entry.runs.push(open);
    }
    if (entry.nodeId) order.push(entry);
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of await mfbe.doc.getElementsByTagName('body')) {
    visit(await mfbe.doc.getNode(body));
  }
  return order;
}

/** Flat list of runs in document order with their block index. */
function flattenRuns(blocks) {
  const runs = [];
  blocks.forEach((block, index) => {
    for (const run of block.runs) runs.push({ index, nodeId: block.nodeId, ...run });
  });
  return runs;
}

function comparePositions(blocks, a, b) {
  const ia = blocks.findIndex((x) => x.nodeId === a.nodeId);
  const ib = blocks.findIndex((x) => x.nodeId === b.nodeId);
  if (ia !== ib) return ia - ib;
  return a.offset - b.offset;
}

export async function runFormatSearch(ctx, options) {
  const { mark, direction, paragraph } = options;
  const forward = direction === 'forward';
  const selection = await mfbe.selection.get();
  if (!selection) {
    // The original refused "Control" (image) selections and asked for a text selection.
    await mfbe.ui.message(
      t(ctx, 'Поставьте курсор в текст книги.', 'Place the caret in the text of the book.'),
      { icon: 'warning' },
    );
    return;
  }
  const blocks = await collectBlocks(mark);
  const runs = flattenRuns(blocks);
  // Forward searches start at the end of the selection, backward ones at its start.
  const [first, last] =
    comparePositions(blocks, selection.anchor, selection.head) <= 0
      ? [selection.anchor, selection.head]
      : [selection.head, selection.anchor];
  const from = forward ? last : first;
  let fromIndex = blocks.findIndex((b) => b.nodeId === from.nodeId);
  if (fromIndex < 0) fromIndex = 0;

  // Candidates after (before) the caret. A run that starts exactly at the caret counts as
  // the one the caret is in, exactly as the original skipped the element it was standing in.
  const isCandidate = (run) => {
    if (paragraph) return forward ? run.index > fromIndex : run.index < fromIndex;
    if (run.index !== fromIndex) return forward ? run.index > fromIndex : run.index < fromIndex;
    return forward ? run.start > from.offset : run.end < from.offset;
  };
  let found = forward ? runs.find(isCandidate) : [...runs].reverse().find(isCandidate);

  if (!found && runs.length > 0) {
    const question = forward
      ? t(
          ctx,
          'Достигнут конец документа.\nПродолжить поиск с начала документа?',
          'The end of the document has been reached.\nContinue searching from the beginning?',
        )
      : t(
          ctx,
          'Достигнуто начало документа.\nПродолжить поиск с конца документа?',
          'The beginning of the document has been reached.\nContinue searching from the end?',
        );
    const answer = await mfbe.ui.message(question, {
      icon: 'question',
      buttons: [
        { id: 'yes', label: t(ctx, 'Да', 'Yes'), default: true },
        { id: 'no', label: t(ctx, 'Нет', 'No'), cancel: true },
      ],
    });
    if (answer !== 'yes') return;
    found = forward ? runs[0] : runs[runs.length - 1];
  }
  if (!found) {
    await mfbe.ui.message(
      t(ctx, 'Ничего не найдено, поиск завершен.', 'Nothing found, the search is finished.'),
    );
    return;
  }
  // Caret at the start of the run when moving forward, at its end when moving backward.
  await mfbe.selection.set({ nodeId: found.nodeId, offset: forward ? found.start : found.end });
  await mfbe.selection.scrollIntoView();
  const label = MARK_LABEL[mark];
  await mfbe.ui.status(t(ctx, `Найдено: ${label.ru}`, `Found: ${label.en}`), { sticky: true });
}
