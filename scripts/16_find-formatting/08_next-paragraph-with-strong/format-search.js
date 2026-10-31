// Engine of the 24 "Перейти на предыдущий / следующий ..." scripts of FictionBook Editor 2.7.9's
// group 16_Поиск форматирования (001-024, Sclex, v1.2: italics, bold, superscript, subscript,
// strikethrough, code, and "... абзац с ..." / "... абзац, содержащий ..." for each). Converted
// from their 2.7beta1 versions (01-24) first and brought up to 2.7.9 in feature 007. Each package
// carries its own copy: the sandbox only loads modules from the script's own folder.
//
// The originals walked the book as FictionBook Editor showed it - the book's annotation and its
// history first, then every body - from the selection: past the element of the kind they looked
// for that the caret was in, or that started (forward) / ended (backward) right at it, up to the
// paragraph's border; then on to the next such element holding text, whose start (forward) or end
// (backward) got the caret. The paragraph variants started from the next (previous) paragraph
// instead, so they go to the next (previous) paragraph holding the formatting. At the end (start)
// of the book they asked whether to go on from the other end (confirm: OK / Cancel), then searched
// up to the selection and said "Ничего не найдено, поиск завершен." when they got there. In 2.7.9
// Run() returns "Found", or "NotFound" when nothing is found or the user declines to go on, so that
// other scripts can call them in loops; nothing for a selected picture.
//
// Here the formatting lives in marks: an element is a maximal run of a paragraph's content that
// carries the mark - a picture carrying it belongs to the run - and holds text. Adjacent elements
// are one run, as the originals passed them together.
// Notice of the original script (FictionBook Editor 2.7.9, GPL-3.0), kept as written:
//Скрипт набора «Поиск форматирования»
//Автор Sclex
//Топик про скрипты FBE: http://www.fictionbook.org/forum/viewtopic.php?t=4412
//Мой сайт про мои скрипты: http://scripts.fictionbook.org

import { loadBook, locate, refusePicture, setCaret, t } from './nav-lib.js';

/** The runs of `mark` in a paragraph: `[{ start, end }]` (offsets in its text, a picture is one). */
function runsOf(p, mark) {
  const runs = [];
  if (p.kind !== 'p' || p.isPlaceholder || p.type === 'empty-line') return runs;
  let offset = 0;
  let open = null;
  for (const child of p.node.content ?? []) {
    const length = child.type === 'text' ? child.text.length : 1;
    const marked = length > 0 && (child.marks ?? []).some((m) => m.type === mark);
    if (marked) {
      if (!open) open = { start: offset, end: offset + length, text: false };
      else open.end = offset + length;
      if (child.type === 'text') open.text = true;
    } else if (open) {
      // Unmarked text or a picture without the mark closes the run, as a closing tag did.
      if (open.text) runs.push(open);
      open = null;
    }
    offset += length;
  }
  if (open && open.text) runs.push(open);
  return runs;
}

/**
 * Runs one search. `mark` is the model's mark ('emphasis', 'strong', 'sup', 'sub',
 * 'strikethrough', 'code'); `forward` the direction; `paragraph` true for the variants that start
 * from the next (previous) paragraph. Resolves with what the original's Run() returned.
 */
export async function runFormatSearch(ctx, { mark, forward, paragraph }) {
  const book = await loadBook();
  const where = await locate(book, forward);
  if (!where) return undefined;
  if (where.picture) {
    await refusePicture(ctx);
    return undefined;
  }
  const all = [];
  for (const p of book.ps) {
    for (const run of runsOf(p, mark)) all.push({ p, index: p.index, ...run });
  }
  // Forward searches start at the end of the selection and stop at its start; backward ones the
  // other way round.
  const from = forward ? where.end : where.start;
  const stop = forward ? where.start : where.end;
  // Past the run at the caret (the paragraph variants: past the caret's paragraph), then the next
  // run on this side of the book's end.
  const ahead = forward
    ? all.find(
        (r) =>
          r.index > from.index || (!paragraph && r.index === from.index && r.start > from.offset),
      )
    : [...all]
        .reverse()
        .find(
          (r) =>
            r.index < from.index || (!paragraph && r.index === from.index && r.end < from.offset),
        );
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
    // From the other end up to the selection: a run the walk enters before it meets the
    // selection counts, the caret's own paragraph included.
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
  // Caret at the start of the run when moving forward, at its end when moving backward.
  await setCaret(found.p, forward ? found.start : found.end);
  return 'Found';
}
