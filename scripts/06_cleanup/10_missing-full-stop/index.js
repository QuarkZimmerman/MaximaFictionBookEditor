// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/10_Точка..js - «Точка.», version 2.6
// (2.7beta1's «Точка. Точка, запятая» 1.9 before feature 007). A capitalised word right after a
// lower-case word may hide a missing full stop. Starting at the paragraph with the caret every such
// place is highlighted and shown in an input box: Yes replaces it by the text of the box, No keeps
// it and remembers the capitalised word as a proper name (so "увидел Александра" is not asked
// again), Cancel stops the script. The original shipped a starting dictionary of proper names
// (names.js). 2.7.9 also finds the place when a non-breaking space separates the two words (the
// paragraph's &nbsp; are read as the character, and the proposal keeps the separator as typed).
// The expression compiles with JScript's meaning of \s and . (lib/jscript-regexp.js).
// The original's notice, kept as written (FR-029):
//======================================
//     Интерактивный поиск пропущенной точки перед Прописной
//                                      14 мая 2008 г.
//     Автор скрипта - jurgennt
//                                                         Engine by ©Sclex
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.1 — добавлены двойные угловые кавычки
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.2 — не предлагается по умолчанию добавление точки после строчной;
//             теперь при «Отмене» запоминается имя собственное, «ОК» — нет.
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.3 — в имена добавлены дефисы и апосторофы
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.4 — вложенные кавычки
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.5 — запрос на выход
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.6 — переход на следующий абзац — "ready for FBE"
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.7 — подсветка сомнительного места
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.8 — кастомизированные nbsp — Sclex (20.03.2010)
//======================================
import { legacyTimeString } from './lib/legacy-html.js';
import { piece, runInteractive } from './lib/interactive.js';
import { jscriptRegExp } from './lib/jscript-regexp.js';
import { NAMES } from './names.js';

const NB = '\u00A0';
// 2.7.9's re10. The legacy prefix `^(.*?){0,1}` could not match an empty string (an optional group
// may not match empty in one iteration, in JScript as in ECMAScript), so a match at the very start
// of a paragraph lost its first letter: `^(.*?)` here (from the conversion of 0.0.1).
const RE = jscriptRegExp(
  `^(.*?)([А-ЯЁ]*[а-яё]+“{0,1}»{0,1})(</EM>|</STRONG>|</EM></STRONG>|</STRONG></EM>){0,1}( |${NB})(<EM>|<STRONG>|<EM><STRONG>|<STRONG><EM>){0,1}(«{0,1}„{0,1}([А-ЯЁ]+[А-яё\\-']*))(.*?)$`,
  'g',
);

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const started = Date.now();
  const pattern = {
    re: RE,
    pieces: (s) => ({
      display: piece(s, RE, '$2$3$4$5$6'),
      suggestion: piece(s, RE, '$2$3$4$5$6'),
      prefix: piece(s, RE, '$1'),
      suffix: piece(s, RE, '$8'),
      memoryKey: piece(s, RE, '$7'), // the capitalised word
    }),
    prompt: (pieces, state) =>
      ru
        ? ` :: Пропущена точка ::                … ${state.count}\nВведите свой вариант:                ${pieces.display}`
        : ` :: Missing full stop ::                … ${state.count}\nEnter your variant:                ${pieces.display}`,
  };
  const state = await runInteractive(ctx, {
    caption: ctx.script.name,
    patterns: [pattern],
    rememberRejected: true,
    initialRejected: NAMES,
    // 2.7.9 reads the paragraph's &nbsp; as the character (so that it can separate the two words)
    // and writes it back; the notation turns it into &nbsp; again for an unchanged paragraph.
    onBeforePattern: (s) => s.replace(/&nbsp;/g, NB),
    onParagraphDone: (s) => s.replace(/\u00A0/g, '&nbsp;'),
    // The legacy counter grew only when the text was really changed.
    countAccepted: (pieces, answer) => answer !== pieces.display,
  });
  await mfbe.ui.message(
    ru
      ? `–= Jurgen Script =–\n«Точка.» v.2.6\n\n Произведено замен: ${state.count}\n\n Время: ${legacyTimeString(started)}.\n`
      : `–= Jurgen Script =–\n"Full stop." v.2.6\n\n Replacements made: ${state.count}\n\n Time: ${legacyTimeString(started)}.\n`,
    { caption: ctx.script.name, icon: 'info' },
  );
}
