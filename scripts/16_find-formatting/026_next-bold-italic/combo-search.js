// Engine of "Перейти на предыдущее / следующее совмещение курсива с жирностью" (FictionBook
// Editor 2.7.9, 16_Поиск форматирования/025 and 026, Sclex). Each package carries its own copy.
//
// The originals walked the HTML from the caret, counting the EM and STRONG elements they were
// in, and stopped at an EM inside a STRONG or a STRONG inside an EM; the caret went to the start
// of that element (forward) or to its end (backward). The element the caret was in - or that
// started (forward) / ended (backward) right at it - was passed first, up to the paragraph's
// end. Here the formatting lives in marks: a combination is a run of text that is both bold and
// italic (a picture inside the run, bold and italic too, belongs to it), within one paragraph.
// At the end (start) of the book the originals asked whether to go on from the other end, then
// searched up to the selection and said "Ничего не найдено, поиск завершен." when they got there.
// Run() returned "Found" or "NotFound" (nothing for a selected picture).

import { loadBook, locate, refusePicture, setCaret, t } from './nav-lib.js';

const BOTH = ['strong', 'emphasis'];

/** The bold-and-italic runs of a paragraph: `[{ start, end }]` (offsets in the text). */
function runsOf(p) {
  const runs = [];
  if (p.kind !== 'p' || p.isPlaceholder || p.type === 'empty-line') return runs;
  let offset = 0;
  let open = null;
  for (const child of p.node.content ?? []) {
    const length = child.type === 'text' ? child.text.length : 1;
    const marks = child.marks ?? [];
    const both = length > 0 && BOTH.every((name) => marks.some((m) => m.type === name));
    if (both) {
      if (!open) open = { start: offset, end: offset + length, text: false };
      else open.end = offset + length;
      if (child.type === 'text') open.text = true;
    } else if (open) {
      if (open.text) runs.push(open);
      open = null;
    }
    offset += length;
  }
  if (open && open.text) runs.push(open);
  return runs;
}

export async function runComboSearch(ctx, { forward }) {
  const book = await loadBook();
  const where = await locate(book, forward);
  if (!where) return undefined;
  if (where.picture) {
    await refusePicture(ctx);
    return undefined;
  }
  const all = [];
  for (const p of book.ps) for (const run of runsOf(p)) all.push({ p, index: p.index, ...run });
  const from = forward ? where.end : where.start;
  const stop = forward ? where.start : where.end;
  // Passing the combination at the caret, then the next one on this side of the book's end.
  const ahead = forward
    ? all.find((r) => r.index > from.index || (r.index === from.index && r.start > from.offset))
    : [...all]
        .reverse()
        .find((r) => r.index < from.index || (r.index === from.index && r.end < from.offset));
  let found = ahead ?? null;
  if (!found) {
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
    // The original's confirm(): OK and Cancel, with the editor's own button labels.
    const answer = await mfbe.ui.message(question, {
      icon: 'question',
      buttons: [
        { id: 'ok', label: '', default: true },
        { id: 'cancel', label: '', cancel: true },
      ],
    });
    if (answer !== 'ok') return 'NotFound';
    // From the other end up to the selection: a run entered before the walk meets it counts.
    found =
      (forward
        ? all.find((r) => r.index < stop.index || (r.index === stop.index && r.start < stop.offset))
        : [...all]
            .reverse()
            .find(
              (r) => r.index > stop.index || (r.index === stop.index && r.end > stop.offset),
            )) ?? null;
    if (!found) {
      await mfbe.ui.message(
        t(ctx, 'Ничего не найдено, поиск завершен.', 'Nothing found, the search is finished.'),
      );
      return 'NotFound';
    }
  }
  await setCaret(found.p, forward ? found.start : found.end);
  return 'Found';
}
