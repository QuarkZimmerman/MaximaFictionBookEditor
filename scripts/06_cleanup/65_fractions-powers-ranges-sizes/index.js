// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/65_Дроби, степени, интервалы, габариты.js
// Starting at the paragraph with the caret, finds in every text block of the bodies, one place at a
// time: square and cubic units (м2, км2, см3 -> м<sup>2</sup>), dimensions (120x30x40 -> 120×30×40,
// 21х29 -> 21×29), fractions written with a slash (1/4 -> ¼ and the other 14 fraction characters),
// number ranges with a hyphen, a dash or a spaced en dash (1941-1945 -> 1941–1945) and ranges of
// numbers with a power (10<sup>3</sup>-10<sup>5</sup>). Each place is selected and proposed in a
// Yes / No / Cancel input box: Yes takes the text of the box, No keeps the place, Cancel stops the
// script (the paragraph being worked on stays as it was). Reports the number of replacements.
// Converted on lib/interactive.js, the engine of the sibling 07 (10.000.000.000), whose original this
// script was built on; the 24 expressions are in patterns.js as written.
// Differences: the title-info annotation, which the original processed only when the caret stood in
// it, is not processed (as in 07); the place is shown by selecting it, the original's highlighting and
// scrolling are dropped.
// The original's notice, kept as written (FR-029):
//=========================================
//     «Дроби, степени, интервалы, габариты» v.2.2 (декабрь 2024)
//     Единицы площади и объема, габариты, дроби в виде чисел через слэш.
//     За основу взят скрипт «10.000.000.000.js»
//     Автор скрипта - jurgennt.
//                                                           Engine by ©Sclex
//                                                                           02.05.2008
//~~~~~~~~~~~~~~~~~~~
// v.1.1 — исправлена ошибка при наличии более десятка исправлений в одном параграфе
//~~~~~~~~~~~~~~~~~~~
// v.1.2 — удаление пробела в четырёхзначных числах
//~~~~~~~~~~~~~~~~~~~
// v.1.3 — только точки и пробелы, но не запятые
//~~~~~~~~~~~~~~~~~~~
// v.1.4 — дефис между цифрами
//~~~~~~~~~~~~~~~~~~~
// v.1.5 — уточнена обработка дефисных номеров: 123-234-345
//~~~~~~~~~~~~~~~~~~~
// v.1.6 — тире, пробел между цифрами
//~~~~~~~~~~~~~~~~~~~
// v.1.7 — переход на следующий абзац — "ready for FBE"
//~~~~~~~~~~~~~~~~~~~
// v.1.8 — кастомизированные неразрывные пробелы — Sclex (20.03.2010)
//=========================================
// v.1.9 — прерывание процесса 
//======================================
// v.2.0 — проверка от курсора — sclex, май 2010
//======================================
// v.2.1 — доработка движка под прерывание и выход — sclex, май 2010
//======================================
// v.2.12 — доработка подсветки для найденных рез-тов поиска — Alex2L, июнь 2012
//======================================

//------------------------------------------------------------------------------------
//     Часть регекспов - stokber.
//     Идеи регекспов - TaKir.
//     Советы по улучшению и исправлению функционала регекспов - Sclex
//------------------------------------------------------------------------------------------------------

import { piece, runInteractive } from './lib/interactive.js';
import { legacyTimeString } from './lib/legacy-html.js';
import { PATTERNS } from './patterns.js';

var VersionNumber = '2.2';

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const started = Date.now();
  const patterns = PATTERNS.map((p) => ({
    re: p.re,
    pieces: (s) => ({
      display: piece(s, p.re, p.display),
      suggestion: piece(s, p.re, p.suggestion),
      prefix: piece(s, p.re, p.prefix),
      suffix: piece(s, p.re, p.suffix),
    }),
    // InputBox(" :: <caption> ::\n > <label>" + v1 + " —> " + v2, v2, r)
    prompt: (pieces) => ` :: ${p.caption[ru ? 0 : 1]} ::\n > ${p.label[ru ? 0 : 1]}${pieces.display} —> ${pieces.suggestion}`,
  }));
  const state = await runInteractive(ctx, { caption: ctx.script.name, patterns });
  if (ctx.cancelled) return;
  await mfbe.ui.message(
    ru
      ? `    –= Jürgen Script =– \n  «Дроби, степени, интервалы, габариты» v.${VersionNumber}\t\n\nПроизведено замен: ${state.count}\n\nВремя: ${legacyTimeString(started)}.\n`
      : `    –= Jürgen Script =– \n  "Fractions, powers, ranges, dimensions" v.${VersionNumber}\t\n\nReplacements made: ${state.count}\n\nTime: ${legacyTimeString(started)}.\n`,
    { caption: ctx.script.name, icon: 'info' },
  );
}
