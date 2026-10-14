// Converted from 06_Чистка/05_Слипшиеся слова.js (FictionBook Editor): interactive search for
// suspicious places - punctuation glued between letters, a capital right after a lower-case
// letter, digits glued to words, misplaced hyphens and dashes, apostrophes and slashes inside
// words, stray symbols, plain text inside italics... Starting at the paragraph with the caret
// every finding is highlighted and shown in an input box with a proposal: Yes replaces the
// place by the text of the box, No keeps it (and remembers the text so it is not asked
// again), Cancel stops the script.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//======================================
//     Интерактивный поиск знаков препинания и т. д. и т. п.
//                                                 8 мая 2008 г.
//                                                         Engine by ©Sclex
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.1 – Цифры после строчных                         2007.09.16
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.2 – "Русские" кавычки                                2007.09.22
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.3 – Дефис после точки                               2007.10.14
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.4 – Пробел до и после Дефиса                    2007.11.22
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.5 – Апостроф сре'ди строчных                     2007.11.29
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.6 – Скобка после строчных                         2008.01.30
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.7 – предлагается пробел перед Прописной   2008.02.13
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.8 – запрос на апострофы                            2008.02.29
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.9 – запрос на слэши                                  2008.04.05
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.2.0 – «ready» for FBE                                    2008.04.05
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.2.1 – «вкрапления» обычного в курсиве          2008.05.07
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.2.2 – «косметика» — курсивы убрал в var       2008.05.08
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.2.3 – подсветка                                           2008.05.16
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.2.4 – ошибка в союзах 150                            2008.12.16
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.2.5 – игнор «теле-», «радио-» 100                  2009.01.07
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.2.6 – кастомизированные неразрывные пробелы          2010.03.20
//======================================
// v.2.7 — прерывание процесса
//======================================
// v.2.8 — проверка от курсора — sclex, май 2010
//======================================
// v.2.9 — доработка движка под прерывание и выход — sclex, май 2010
//======================================
// v.2.92 — доработка подсветки для найденных рез-тов поиска — Alex2L, май, июнь 2012
//======================================
import { legacyTimeString } from './lib/legacy-html.js';
import { piece, runInteractive } from './lib/interactive.js';
import { PATTERNS } from './patterns.js';

/** Words before a hyphen that are never questioned ("радио-", "теле-"...). */
const HYPHEN_EXCEPTIONS = new Set(['радио', 'теле', 'лево', 'право']);

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const started = Date.now();
  const apostrophe = (await MsgBox(ru ? '–=Jürgen Script=–\n1–2\n\nОбращать внимание на а\'построфы?' : '–=Jürgen Script=–\n1–2\n\nCheck a\'postrophes inside words?', ctx.script.name, 4 + 32)) === 6;
  const slash = (await MsgBox(ru ? '–=Jürgen Script=–\n2–2\n\nОбращать внимание на /слэши/?' : '–=Jürgen Script=–\n2–2\n\nCheck /slashes/ inside words?', ctx.script.name, 4 + 32)) === 6;

  const patterns = PATTERNS.map((p) => ({
    re: p.re,
    noMemory: !!p.noMemory,
    enabled: () => (p.gate === 'apostrophe' ? apostrophe : p.gate === 'slash' ? slash : true),
    pieces: (s) => ({
      display: piece(s, p.re, p.display),
      suggestion: piece(s, p.re, p.suggestion ?? p.display),
      prefix: piece(s, p.re, p.prefix),
      suffix: piece(s, p.re, p.suffix),
      word: p.word ? piece(s, p.re, p.word) : null,
    }),
    autoDecide: (pieces) => (pieces.word !== null && HYPHEN_EXCEPTIONS.has(pieces.word) ? null : undefined),
    prompt: (pieces) => (ru ? ` :: ${p.caption} ::\nВведите свой вариант:        ${pieces.display}` : ` :: ${p.caption} ::\nEnter your variant:        ${pieces.display}`),
  }));

  const state = await runInteractive(ctx, { caption: ctx.script.name, patterns, rememberRejected: true });
  await mfbe.ui.message(
    ru
      ? `    –= Jürgen Script =–\n«Слипшиеся слова» v.2.92\n\nПроизведено замен:   ${state.count}\n\nВремя: ${legacyTimeString(started)}\n`
      : `    –= Jürgen Script =–\n"Stuck-together words" v.2.92\n\nReplacements made:   ${state.count}\n\nTime: ${legacyTimeString(started)}\n`,
    { caption: ctx.script.name, icon: 'info' },
  );
}
