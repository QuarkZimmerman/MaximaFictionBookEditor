// Converted from FictionBook Editor 2.7.9: Scripts/37_Эпиграфы/05_Поиск неразмеченных эпиграфов.js
// Looks for an epigraph typed as plain paragraphs. Title after title from the end of the
// selection (every title: of a body, a section, a poem or a stanza; not the one the selection
// ends in), the script looks at the container of the first paragraph after the title: when it is
// the title's section, the paragraphs that follow the title up to the first picture, container
// or subtitle (at most 11) are tried as an epigraph with the original's expressions - they end
// with a line of at most 81 characters whose last character is a letter or a digit (optionally
// followed by ! or ? and a closing bracket or quote: an author's name), and are not too long for
// their number of lines - and the first such group of lines is selected. A title followed by
// another title is passed (the next one is tried), and so is a section whose first paragraph
// after the title is in an epigraph, an annotation, a citation or a poem, or that holds a ®
// anywhere. The search stops at the first section (or section holding one) whose id looks like a
// note's, a comment's or a bookmark's (n_1, c2, comment_3, FbAutId_4, bookmark_5): "Поиск
// завершён! Скрипт не ищет эпиграфы после разделов со сносками." in the status bar and a
// message. Nothing found up to the end: two messages. The original's Run() returned nothing,
// nor does run().
// The expressions are the original's, run verbatim on the section's outerHTML as Internet
// Explorer wrote it (lib/ie-page.js). Differences: the lines found are selected exactly, from the
// start of the first to the end of the last (the original moved IE's selection by a character
// count it worked out from that HTML: no inline picture counted, the line break before the first
// line did); the editor scrolls the selection into view (the original's scrollIfItNeeds is not
// reproduced); a selected block picture is refused with group 16's message (the original stopped
// with a script error); the message for a selection in an input field is gone. Fixed (FR-023):
// the temporary marks of a superscript (a footnote number) at the end of a line were looked for
// as "<sup>" in lower case, which the page's upper-case "<SUP>" never matched, so such a line
// was taken for an epigraph's last line; and the expression that cuts the lines after the last
// line read [\\}...] (a backslash) where the definition of that line it was copied from reads
// [\)\}...] (a closing bracket). Notes: docs/scripting/notes-279-drafts/37.md.
// The original's notice, kept as written (FR-029):
// Скрипт «Поиск неразмеченных эпиграфов»
// Версия 1.12. Декабрь 2024
// Автор — stokber.
// За основу кода взят скрипт «Перейти на предыдущий заголовок стиха» ув. Sclex-а.
// Добавлена функция выделения строк будущих эпиграфов и зацикливания их поиска.
// v.1.12 — добавлены в исключения строки с символами копирайта "©" в начале строки и ®. Исправлено неточное выделение эпиграфа при наличии в нем мягкого переноса. Добавлены имя и версия скрипта в завершающее сообщение скрипта. (декабрь, 2024)
// nonStop = 0 — пропускать, 1 — остановиться:

import {
  containerOf,
  isTextBlock,
  loadBook,
  locate,
  paragraphsIn,
  refusePicture,
  setCaret,
  setRange,
  t,
  textOf,
} from './nav-lib.js';
import { outerHtml } from './lib/ie-page.js';

const NAME = { ru: 'Поиск неразмеченных эпиграфов', en: 'Find unmarked epigraphs' };
const VERSION = '1.12';

/**
 * selEpi() of the original on the container `pe` of the first paragraph after a title:
 * `{ verdict }` - 'notes' (stop), 'title' (another title follows), 'skip' - or
 * `{ verdict: 'found', paragraphs }`, the <P>s of the lines found, in order.
 */
export function examine(pe) {
  const { html, ps } = outerHtml(pe);
  let p = html;
  const colStr = 12;
  const rxTitle = new RegExp('^(<DIV class=stanza>)?<DIV class=title>', 'im');
  const rxDiv = new RegExp('^<DIV class=(epigraph|annotation|cite|poem)>', 'im');
  const rxP = new RegExp('^<DIV class=section>', 'im');
  const rxCopyright = new RegExp('^©|®', '');
  // если добрались до разделов с примечаниями или комментариями — завершаем работу:
  const rxNote = new RegExp(
    '<DIV id=([nc]|comment|FbAutId|bookmark)_?\\d+ class=section><DIV class=title>',
    'im',
  );
  if (rxNote.test(p)) return { verdict: 'notes' };
  if (rxTitle.test(p) && !rxP.test(p)) return { verdict: 'title' }; // "Это просто заголовок!"
  if (rxDiv.test(p) && !rxP.test(p)) return { verdict: 'skip' }; // "Это просто DIV!"
  if (rxCopyright.test(p)) return { verdict: 'skip' }; // "Это символ копирайта и др."

  // "А это возможно и эпиграф!" The two edits of the start of p, done by hand so that the place
  // of each <P> is known: a section without a title gets "</DIV>\r\n" after its start tag, then
  // everything up to the first "</DIV>" goes (the title).
  let starts = ps.map((entry) => entry.at);
  const noTitle = new RegExp('^<DIV class=section>(?!<DIV class=title>)', 'im').exec(p);
  if (noTitle) {
    const at = noTitle.index + noTitle[0].length;
    p = `${p.slice(0, at)}</DIV>\r\n${p.slice(at)}`;
    starts = starts.map((s) => (s >= at ? s + 8 : s));
  }
  const head = new RegExp('^(.|[\\r\\n])+?</DIV>', 'im').exec(p); // срезаем заголовок.
  if (head) {
    const from = head.index;
    const to = head.index + head[0].length;
    p = p.slice(0, from) + p.slice(to);
    starts = starts.map((s) => (s >= to ? s - (to - from) : s >= from ? -1 : s));
  }
  // The line of p on which each <P> starts: every later step keeps whole lines from the start.
  const lineOf = starts.map((s) => (s < 0 ? -1 : p.slice(0, s).split('\r\n').length - 1));

  p = p.replace(new RegExp('^<DIV onresizestart=(.|[\\r\\n])+', 'im'), ''); // срезаем картинку и ниже.
  p = p.replace(new RegExp('^<DIV class=(.|[\\r\\n])+', 'im'), ''); // срезаем блочное и ниже.
  p = p.replace(new RegExp('^<P class=subtitle>(.|[\\r\\n])+', 'im'), ''); // срезаем подзаголовок и ниже.
  p = p.replace(new RegExp(`^((?:.*\\r\\n){${colStr}})(?:(?:.|[\\r\\n])+)`, 'gm'), '$1'); // минус явно лишние строки.
  p = p.replace(new RegExp('</DIV>', 'g'), '');
  // проставляем вр. метки sup: FIX - the page's tags are upper case (<SUP>), the original's
  // "<sup>" / "</sup>" without the i flag never matched them.
  p = p.replace(new RegExp('<sup>', 'gi'), '☺');
  p = p.replace(new RegExp('</sup>', 'gi'), '☻');
  p = p.replace(new RegExp('<P>&nbsp;</P>', 'mgi'), '<P>∇∇∇.</P>');
  p = p.replace(new RegExp('&nbsp;', 'g'), ' ');
  p = p.replace(new RegExp('<[^>]+>', 'g'), ''); // минус теги.
  p = p.replace(new RegExp('&lt;', 'g'), '<');
  p = p.replace(new RegExp('&gt;', 'g'), '>');
  p = p.replace(new RegExp('&amp;', 'g'), '&');
  p = p.replace(new RegExp('&shy;', 'g'), ' '); // мягкие переносы
  // перемещаем могущие мешать маркеры сносок из концов строк:
  p = p.replace(new RegExp('([.?…!])([ ]?(\\*+|\\[\\d+\\]|\\{\\d+\\}|☺\\d+☻)[ ]?)$', 'gm'), '$2$1');
  p = p.replace(new RegExp('[☺☻]', 'g'), ''); // удаляем вр. метки sup.
  // задаём регексп последней строки эпиграфа:
  const rxEndStr = new RegExp('^.{1,80}[\\da-zа-яё]([!?]?[\\)\\}\\]»”“*])?$', 'im');
  p = p.replace(new RegExp('^(.{1,80}\\r\\n).{81,}\\r\\n[\\s\\S]*', 'im'), '$1');
  // FIX: the original read [\\\\}\\]»”“*] here - a backslash where rxEndStr (and the commented-out
  // endStr this line was written from) has a closing bracket: [\\)\\}\\]»”“*].
  p = p.replace(
    new RegExp('^((.+\\r\\n)+.{1,80}[\\da-zа-яё]([!?]?[\\)\\}\\]»”“*])?\\r\\n)[\\s\\S]*', 'im'),
    '$1',
  );
  if (!rxEndStr.test(p)) return { verdict: 'skip' };
  p = p.replace(new RegExp('^∇∇∇\\.$', 'mgi'), '');
  const n = (p.match(/\r\n\r?\n?/g) || []).length; // всего целых строк.
  const lines = p.split('\r\n');
  if (p.endsWith('\r\n')) lines.pop();
  const colSumb = p.replace(new RegExp('\\r\\n', 'mgi'), ' ').length - 1;
  if (n > 3 && colSumb > n * 80) return { verdict: 'skip' };
  const paragraphs = ps
    .map((entry, i) => ({ item: entry.item, line: lineOf[i] }))
    .filter((entry) => entry.line >= 0 && entry.line < lines.length)
    .map((entry) => entry.item);
  return { verdict: 'found', paragraphs };
}

/** The paragraph a point of locate() is in, or the first one after it (getNextP's start). */
function startOf(book, point) {
  if (Number.isInteger(point.index)) {
    const item = book.ps[point.index];
    return { from: point.index + 1, title: containerOf(item, 'title') };
  }
  return { from: Math.ceil(point.index), title: point.item ? containerOf(point.item, 'title') : null };
}

export default async function run(ctx) {
  const tx = (ru, en) => t(ctx, ru, en);
  const book = await loadBook();
  const where = await locate(book, true);
  if (!where) return;
  if (where.picture) {
    await refusePicture(ctx);
    return;
  }
  let { from, title: blockAtStart } = startOf(book, where.end);
  let caret = null; // where the original left the caret after the last title it looked at
  for (let steps = 0; ; steps += 1) {
    if (ctx.cancelled) return;
    if (steps % 50 === 49) await mfbe.ui.progress(from, book.ps.length);
    await mfbe.ui.status(
      tx('Переходим на следующий неразмеченный эпиграф…', 'Going to the next unmarked epigraph…'),
    );
    // The next paragraph inside a title, not in the title the search started in.
    let found = null;
    for (let i = from; i < book.ps.length; i += 1) {
      const title = containerOf(book.ps[i], 'title');
      if (title && title !== blockAtStart) {
        found = title;
        break;
      }
    }
    if (!found) {
      if (caret) await caret();
      await mfbe.ui.message(
        tx(
          'До конца документа скрипт не видит неразмеченных эпиграфов.',
          'The script sees no unmarked epigraph up to the end of the document.',
        ),
      );
      await mfbe.ui.status(tx('Эпиграф?', 'An epigraph?'), { sticky: true });
      await mfbe.ui.message(
        tx(
          `Поиск завершён!\n\nСкрипт '${NAME.ru}' v. ${VERSION}.`,
          `Search finished!\n\nScript '${NAME.en}' v. ${VERSION}.`,
        ),
      );
      return;
    }
    await mfbe.ui.status(tx('Эпиграф?', 'An epigraph?'), { sticky: true });
    const titleLines = paragraphsIn(found);
    const lastLine = titleLines[titleLines.length - 1];
    const first = book.ps[lastLine.index + 1] ?? null; // the caret went right after the title
    // Nothing after the title: the caret stays in it, as after "Это просто заголовок!".
    const verdict = first ? examine(first.parent) : { verdict: 'title' };
    if (verdict.verdict === 'title') {
      // The caret went one character back, to the end of this title; the next search starts
      // after it.
      caret = () => setCaret(lastLine, textOf(lastLine).length);
      blockAtStart = found;
      from = lastLine.index + 1;
      continue;
    }
    if (verdict.verdict === 'skip') {
      // The caret stays at the start of the paragraph after the title.
      caret = () => setCaret(first, 0);
      blockAtStart = containerOf(first, 'title');
      from = first.index + 1;
      continue;
    }
    if (verdict.verdict === 'notes') {
      await setCaret(first, 0);
      await mfbe.selection.scrollIntoView();
      await mfbe.ui.status(
        tx(
          'Поиск завершён! Скрипт не ищет эпиграфы после разделов со сносками.',
          'Search finished! The script does not look for epigraphs after the sections of notes.',
        ),
        { sticky: true },
      );
      await mfbe.ui.message(
        tx(
          `Поиск завершён!\n\nСкрипт '${NAME.ru}' v. ${VERSION}.`,
          `Search finished!\n\nScript '${NAME.en}' v. ${VERSION}.`,
        ),
      );
      return;
    }
    // Found: the lines from the first paragraph after the title to the last one kept.
    const blocks = verdict.paragraphs.filter((item) => item.index >= first.index && isTextBlock(item));
    if (blocks.length === 0) {
      await setCaret(first, 0);
      return;
    }
    const last = blocks[blocks.length - 1];
    await setRange(blocks[0], 0, last, textOf(last).length);
    await mfbe.selection.scrollIntoView();
    return;
  }
}
