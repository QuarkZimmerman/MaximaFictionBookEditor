// Converted from 06_Чистка/10_Точка..js (FictionBook Editor): "Точка. Точка, запятая" - a
// capitalised word right after a lower-case word and a space may hide a missing full stop.
// Starting at the paragraph with the caret every such place is highlighted and shown in an
// input box: Yes replaces it by the text of the box, No keeps it and remembers the capitalised
// word as a proper name (so "увидел Александра" is not asked again), Cancel stops the script.
// The original shipped a starting dictionary of proper names (names.js).
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//======================================
//     Интерактивный поиск пропущенной точки перед Прописной
//                                      14 мая 2008 г.
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
// changed by SeNS
import { legacyTimeString } from './lib/legacy-html.js';
import { piece, runInteractive } from './lib/interactive.js';
import { NAMES } from './names.js';

// The legacy prefix `^(.*?){0,1}` could not match an empty string (ECMAScript rejects empty iterations
// of an optional group), so a match at the very start of a paragraph lost its first letter: `^(.*?)` here.
const RE = new RegExp(
  '^(.*?)([А-ЯЁ]*[а-яё]+“{0,1}»{0,1})(</EM>|</STRONG>|</EM></STRONG>|</STRONG></EM>){0,1} (<EM>|<STRONG>|<EM><STRONG>|<STRONG><EM>){0,1}(«{0,1}„{0,1}([А-ЯЁ]+[А-яё\\-\']*))(.*?)$',
  'g',
);

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const started = Date.now();
  const pattern = {
    re: RE,
    pieces: (s) => ({
      display: piece(s, RE, '$2$3 $4$5'),
      suggestion: piece(s, RE, '$2$3 $4$5'),
      prefix: piece(s, RE, '$1'),
      suffix: piece(s, RE, '$7'),
      memoryKey: piece(s, RE, '$6'), // the capitalised word
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
    // The legacy counter grew only when the text was really changed.
    countAccepted: (pieces, answer) => answer !== pieces.display,
  });
  await mfbe.ui.message(
    ru
      ? `       –= Jurgen Script =–\n«Точка. Точка, запятая» v.1.9\n\n Произведено замен: ${state.count}\n\n Время: ${legacyTimeString(started)}.\n`
      : `       –= Jurgen Script =–\n"Full stop. Full stop, comma" v.1.9\n\n Replacements made: ${state.count}\n\n Time: ${legacyTimeString(started)}.\n`,
    { caption: ctx.script.name, icon: 'info' },
  );
}
