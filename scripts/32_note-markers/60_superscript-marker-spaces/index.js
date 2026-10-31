// Converted from FictionBook Editor 2.7.9: Scripts/32_Маркеры сносок/60_Убрать пробелы из маркеров сносок надстрочным текстом.js
// Moves the spaces (and non-breaking spaces) out of superscript footnote markers in every
// paragraph of the page - the book's annotation and history, then every body: spaces at the end of
// a superscript go after it, spaces at its start before it (in both cases a run of them becomes
// its last one, as the expressions' "$1" took it), and spaces at the start of a paragraph before a
// superscript are removed. Then it reports the time taken and how many paragraphs each rule
// changed. The original's expressions run unchanged on each paragraph's innerHTML in the notation
// of lib/legacy-html.js, compiled with JScript's \s (lib/jscript-regexp.js: no non-breaking or
// other Unicode spaces), and the paragraphs are written back (lib/page-paragraphs.js).
// Differences from 2.7.9: a superscript or an emphasis with a language (xml:lang, which 2.7.9 did
// not keep) is not matched by the expressions written for bare tags.
// The original's notice, kept as written (FR-029):
//======================================
//            «Нормализовать пробелы маркеров сносок»
//                                             Engine by ©Sclex
//                                                    01.05.2007 – 07.05.2008
//~~~~~~~~~~~~~~~~~~

import { jscriptRegExp } from './lib/jscript-regexp.js';
import { parseInline, serializeInline } from './lib/legacy-html.js';
import { PageEdits, hasContent, loadBook, t } from './lib/page-paragraphs.js';

const VersionNumber = '1.0';

//обрабатывать ли history
const ObrabotkaHistory = true;
//обрабатывать ли annotation
const ObrabotkaAnnotation = true;

const sIB = '<EM>|<STRONG>|<EM><STRONG>|<STRONG><EM>';
const fIB = '</EM>|</STRONG>|</EM></STRONG>|</STRONG></EM>';
const aIB = '<EM>|<STRONG>|<EM><STRONG>|<STRONG><EM>|</EM>|</STRONG>|</EM></STRONG>|</STRONG></EM>';

/** The page's part holding a paragraph: 'annotation', 'history' or 'body'. */
function regionOf(item) {
  let node = item;
  while (node.parent && node.parent.type !== 'root') node = node.parent;
  return node.type === 'annotation-block' ? 'annotation' : node.type === 'history-block' ? 'history' : 'body';
}

export default async function run(ctx) {
  // The editor keeps U+00A0 itself: the page's innerHTML showed it as &nbsp;.
  const nbspEntity = '&nbsp;';

  const Ts = new Date().getTime();
  let TimeStr = 0;

  //~~~~~~~~~~ Регулярные выражения ~~~~~~~~~~~~

  // удаление верхнего индекса из пробелов до маркеров сносок
  const re101 = jscriptRegExp('(\\s|' + nbspEntity + ')+((' + fIB + '){0,1}</sup>(' + fIB + '){0,1})', 'gi');
  const re101_ = '$2$1';
  let count_101 = 0;

  // удаление верхнего индекса из пробелов после маркеров сносок
  const re102 = jscriptRegExp('((?:' + sIB + '){0,1}<sup>(?:' + sIB + '){0,1})(\\s|' + nbspEntity + ')+', 'gi');
  const re102_ = '$2$1';
  let count_102 = 0;

  // удаление начальных пробелов строки перед верхним индексом
  const re103 = jscriptRegExp('^(' + sIB + '){0,1}(\\s|' + nbspEntity + ')+(' + aIB + '){0,1}(<sup>)', 'gi');
  const re103_ = '$1$3$4';
  let count_103 = 0;

  //~~~~~~~~~~~~~~ Конец шаблонов ~~~~~~~~~~~~~~~~~~

  const edits = new PageEdits();

  // функция, обрабатывающая абзац P
  const HandleP = async (item) => {
    const extras = [];
    const before = serializeInline(item.node.content ?? [], extras);
    let s = before;
    if (s.search(re101) != -1) {
      s = s.replace(re101, re101_);
      count_101++;
    }
    if (s.search(re102) != -1) {
      s = s.replace(re102, re102_);
      count_102++;
    }
    if (s.search(re103) != -1) {
      s = s.replace(re103, re103_);
      count_103++;
    }
    if (s !== before) await edits.put(item, { ...item.node, content: parseInline(s, extras) });
  };

  const book = await loadBook();
  for (let i = 0; i < book.ps.length; i += 1) {
    if (ctx.cancelled) return;
    if (i % 500 === 499) await mfbe.ui.progress(i, book.ps.length);
    const item = book.ps[i];
    const region = regionOf(item);
    if ((region === 'history' && !ObrabotkaHistory) || (region === 'annotation' && !ObrabotkaAnnotation)) continue;
    if (hasContent(item)) await HandleP(item);
  }
  await edits.commit();

  const Tf = new Date().getTime();
  const Thour = Math.floor((Tf - Ts) / 3600000);
  const Tmin = Math.floor((Tf - Ts) / 60000 - Thour * 60);
  const Tsec = Math.ceil((Tf - Ts) / 1000 - Tmin * 60 - Thour * 3600);
  const Tsec1 = Math.ceil(10 * ((Tf - Ts) / 1000 - Tmin * 60)) / 10;
  const Tsec2 = Math.ceil(100 * ((Tf - Ts) / 1000 - Tmin * 60)) / 100;
  const Tsec3 = Math.ceil(1000 * ((Tf - Ts) / 1000 - Tmin * 60)) / 1000;
  const sec = t(ctx, ' сек', ' s');
  const s_ = t(ctx, ' с', ' s');
  const min = t(ctx, ' мин ', ' min ');
  const hour = t(ctx, ' ч ', ' h ');

  if (Tsec3 < 1 && Tmin < 1) TimeStr = Tsec3 + sec;
  else if (Tsec2 < 10 && Tmin < 1) TimeStr = Tsec2 + sec;
  else if (Tsec1 < 30 && Tmin < 1) TimeStr = Tsec1 + sec;
  else if (Tmin < 1) TimeStr = Tsec + sec;
  else if (Tmin >= 1 && Thour < 1) TimeStr = Tmin + min + Tsec + s_;
  else if (Thour >= 1) TimeStr = Thour + hour + Tmin + min + Tsec + s_;

  // вывод статистики, если она, конечно, есть
  let st2 = '';

  if (count_101 != 0 || count_102 != 0 || count_103 != 0) st2 += t(ctx, '\n Статистика', '\n Statistics');

  if (count_101 != 0) st2 += t(ctx, '\n• пробел до маркера знака сноски:                             \t', '\n• space before a footnote sign marker:                        \t') + count_101;
  if (count_102 != 0) st2 += t(ctx, '\n• пробел после маркера знака сноски:                       \t', '\n• space after a footnote sign marker:                         \t') + count_102;
  if (count_103 != 0) st2 += t(ctx, '\n• начальный пробел перед маркером текста сноски:\t', '\n• leading space before a footnote text marker:\t') + count_103;

  if (st2 != '') st2 = '\n' + st2;

  await mfbe.ui.message(
    '                  –= Jurgen Script =– \n' +
      t(ctx, ' «Нормализовать пробелы маркеров сносок» v.', ' “Normalise the spaces of footnote markers” v.') +
      VersionNumber +
      ' stokber Edition       \n\n' +
      t(ctx, ' Время: ', ' Time: ') +
      TimeStr +
      '.' +
      st2,
  );
}
