// Converted from FictionBook Editor 2.7.9: Scripts/02_Примечания/09_Перенумеровать примечания (расширенная версия).js
// Renumbers the footnotes, then tidies the text around the footnote links. The original ran two
// scripts in one undo step:
//   Run1, "Унификация сносок (объединенная)" - the renumbering of 07 in its older form: the notes
//     body gets the title «Примечания» when it has none, its sections the ids n_1, n_2... and the
//     titles 1, 2..., and every link of the book pointing to one of them (the annotation and the
//     history included, whatever the link's type) the new address and the text [N]; unlike 07 of
//     2.7.9 it adds no type="note" and shows no message of its own;
//   Run2, "Уборка сносок" by GE - seven regular expressions over the HTML of every paragraph of
//     the bodies (not the annotation, not the history) around the footnote links (type note):
//     a closing </EM> or </STRONG> after the link goes before it, an opening one before it goes
//     after it, the spaces before the link go, punctuation after it (.,;!?:…) goes before it, a
//     space follows it before a letter, a dash or a bracket.
// Then the message "Скрипт «Перенумеровать примечания (расширенная версия)» v.1.0 GE".
// The expressions run on the paragraph as Internet Explorer's innerHTML (lib/ie-html.js, the
// marks nested as the book has them) and the result is read back with lib/legacy-html.js
// (copied unchanged from General clean-up); \s means what it meant in JScript, [ \f\n\r\t\v].
// Differences from 2.7.9: docs/scripting/conversion-notes-279-a.md (group 02).
// The original's notice, kept as written (FR-029):
  // Унификация сносок (объединенная)
  // var Ts=new Date().getTime();
   //НАСТРОЙКИ - начало
   //здесь шаблоны, которые используются при работе скрипта
   //используйте макрос %N для указания номера примечания
   //функция, которая определяет, является ли элемент el, который
   //заведомо является ссылкой, ссылкой на тот тип примечаний,
   //который обрабатывается данным скриптом
   // выводить ли окно, извещающее о конце работы скрипта?
   // true - выводить. false - не выводить
   //добавлять ли новую сноску или только провести работы по упорядочению существующих
   //true - добавлять. false - не добавлять
   //показывать ли форму для ввода текста примечания
   //true - показывать. false - не показывать

import { bodyNamed, commit, footnoteLinkText, loadBook, pageBlocks, renumber, t, titleNode, touch } from './lib/notes-book.js';
import { ieHtml } from './lib/ie-html.js';
import { parseInline } from './lib/legacy-html.js';

const VERSION = '1.0';

/** JScript's \s (it knew neither U+00A0 nor the other Unicode spaces). */
const S = '[ \\f\\n\\r\\t\\v]';
const S_CHARS = ' \\f\\n\\r\\t\\v';
const NBSP = '&nbsp;';
const sIB = '<EM>|<STRONG>|<EM><STRONG>|<STRONG><EM>';
const fIB = '</EM>|</STRONG>|</EM></STRONG>|</STRONG></EM>';
const aIB = `${sIB}|${fIB}`;
const LINK = '<A class=note [^<]+?</A>';

/** Run2's expressions re01-re07 with their replacements, applied in this order. */
const RULES = [
  // снятие курсива со [сноски]
  [new RegExp(`(${LINK})(${fIB})`, 'gi'), '$2$1'],
  // снятие курсива со [сноски]
  [new RegExp(`(${sIB})([\\.${S_CHARS}]{0,2}${LINK})`, 'gi'), '$2$1'],
  // удаление пробела после [сноски] , если за пробелом следует препинание
  [new RegExp(`(${S}|${NBSP}){0,1}(${LINK})(${S}|${NBSP}){0,1}(([\\.,;])|([!\\?:…])){0,1}(${S}|${NBSP}){0,1}(${fIB}){0,1}`, 'gi'), '$8$4$2$7'],
  // удаление пробела перед [сноской]
  [new RegExp(`(${S}|${NBSP}){0,1}(${aIB}){0,1}(${S}|${NBSP}){0,1}(${LINK})`, 'gi'), '$2$4'],
  // препинания после [сноски] {в конце строки} везде
  [new RegExp(`(${LINK})([\\.!\\?,:;]+(${fIB}){0,1})`, 'gi'), '$2$1'],
  // препинания после [сноски] в конце строки
  [new RegExp(`(<A class=note href="[^>]+\\d{1,4}">[^><]+?</A>)([…](${fIB}){0,1})$`, 'gi'), '$2$1'],
  // вставка пробела после [сноски] —
  [new RegExp(`(${LINK})(${sIB}){0,1}([А-яЁёA-z\\-–—\\(\\[])`, 'gi'), '$1 $2$3'],
];

const CLEANED = new Set(['p', 'subtitle', 'v', 'text-author', 'td', 'th']);

export default async function run(ctx) {
  const book = await loadBook();

  // Run1: the renumbering. Without a notes body there is nothing to renumber.
  const body = bodyNamed(book, 'notes');
  if (body) {
    if (body.content.some((s) => s.type === 'section' && (s.content ?? []).some((c) => c.type === 'section'))) {
      await mfbe.ui.message(
        t(
          ctx,
          'В body примечаний есть секции второго уровня вложения. Такие файлы не обрабатываются данным скриптом. Работа скрипта завершена.',
          'The notes body holds sections nested in sections. Such books are not handled by this script. The script stops.',
        ),
        { icon: 'warning' },
      );
      return;
    }
    const first = body.content.find((node) => node.type === 'section' || node.type === 'epigraph' || node.type === 'title');
    if (first && first.type !== 'title') {
      body.content.splice(body.content.indexOf(first), 0, titleNode('Примечания'));
      book.changed.add(body);
    } else if (!first && body.content[body.content.length - 1]?.type !== 'title') {
      body.content.push(titleNode('Примечания'));
      book.changed.add(body);
    }
    renumber(book, body, 'n_', footnoteLinkText);
  }

  // Run2: the clean-up around the footnote links, paragraph by paragraph.
  const blocks = pageBlocks(book).filter((entry) => entry.root.kind === 'body' && CLEANED.has(entry.node.type));
  for (let i = 0; i < blocks.length; i += 1) {
    if (ctx.cancelled) return;
    if (i % 500 === 499) await mfbe.ui.progress(i, blocks.length);
    const entry = blocks[i];
    const extras = [];
    const { html } = ieHtml(entry.node.content ?? [], { langs: true, extras });
    if (!/<A class=note /i.test(html)) continue;
    let s = html;
    for (const [re, to] of RULES) {
      re.lastIndex = 0;
      s = s.replace(re, to);
    }
    if (s === html) continue;
    entry.node.content = parseInline(s, extras);
    touch(book, entry.root);
  }

  await commit(book);
  await mfbe.ui.message(
    t(
      ctx,
      `Скрипт «Перенумеровать примечания (расширенная версия)» v.${VERSION} GE`,
      `Script «Renumber footnotes (extended version)» v.${VERSION} GE`,
    ),
  );
}
