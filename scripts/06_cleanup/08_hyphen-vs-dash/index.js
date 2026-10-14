// Converted from 06_Чистка/08_Дефис - Тире.js (FictionBook Editor): hyphen vs. dash between
// Russian words. Starting at the paragraph with the caret, every "word[ ]-[ ]word" (hyphen, en
// or em dash, optional spaces) is looked up in the word lists of words.js: known hyphenated
// combinations (prefixes like "авиационно-", suffixes like "-нибудь", pairs like
// "пистолет-пулемёт") get a plain hyphen, known dash pairs get a spaced em dash, everything
// else is asked (Yes = text of the input box, No = keep and remember, Cancel = stop). Every
// ~200 kept places the script asks whether to go on.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//===============================================
//  Поиск и замена дефисов и тире в русских текстах между русскими буквами
//  Не отлавливаются мульти-комбинации типа: серо-буро-малиновый…
//                                                   Engine by © Sclex
//                                                                       14.09.2007–02.05.2008
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.2 — переход на движок от Sclex'а, самообучение…
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.3 — время от времени предлагается завершить процесс, изменения сохраняются
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.4 — переход на следующий абзац — "ready for FBE"
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.5 — кастомизированные nbsp — Sclex (20.03.2010)
//===============================================
// v.1.6 — ???
//======================================
// v.1.62 — сканирование начинается с "курсорного" абзаца, доработка подсветки для найденных рез-тов поиска — Alex2L, июнь 2012
//======================================
import { legacyTimeString } from './lib/legacy-html.js';
import { piece, runInteractive } from './lib/interactive.js';
import { DASHED, HYPHENATED, PRE, SUF } from './words.js';

// The legacy prefix `^(.*?){0,1}` could not match an empty string (ECMAScript rejects empty iterations
// of an optional group), so a word at the very start of a paragraph lost its first letter: `^(.*?)` here.
const RE = new RegExp('^(.*?)([А-яЁё]+)(\\s|&nbsp;){0,1}([\\-–—])(\\s|&nbsp;){0,1}([А-яЁё\\-]+)(.*?)$', 'gi');

function knows(set, word) {
  return set.has(word) || set.has(word.toLowerCase());
}

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const started = Date.now();
  const counters = { manual: 0, hyphen: 0, dash: 0, kept: 0 };
  const pattern = {
    re: RE,
    pieces: (s) => ({
      display: piece(s, RE, '$2$3$4$5$6'),
      suggestion: piece(s, RE, '$2$3$4$5$6'),
      prefix: piece(s, RE, '$1'),
      suffix: piece(s, RE, '$7'),
      pre: piece(s, RE, '$2'),
      suf: piece(s, RE, '$6'),
      hyphenated: piece(s, RE, '$2-$6'),
      dashed: piece(s, RE, '$2 — $6'),
    }),
    autoDecide: (pieces) => {
      // A known dash pair wins over a known hyphen part, like in the original.
      if (knows(DASHED, pieces.dashed)) {
        counters.dash += 1;
        return pieces.dashed;
      }
      if (knows(PRE, pieces.pre) || knows(SUF, pieces.suf) || knows(HYPHENATED, pieces.hyphenated)) {
        counters.hyphen += 1;
        return pieces.hyphenated;
      }
      return undefined;
    },
    prompt: (pieces) =>
      ru
        ? `:: Тире - vs - Дефис ::        дефис ${counters.hyphen} … тире ${counters.dash} … вручную ${counters.manual}\nВведите свой вариант:        ${pieces.display}`
        : `:: Dash vs. hyphen ::        hyphen ${counters.hyphen} … dash ${counters.dash} … manual ${counters.manual}\nEnter your variant:        ${pieces.display}`,
  };
  const state = await runInteractive(ctx, {
    caption: ctx.script.name,
    patterns: [pattern],
    rememberRejected: true,
    countAccepted: () => {
      counters.manual += 1;
      return true;
    },
    onReject: () => {
      counters.kept += 1;
    },
    confirmContinue: {
      every: 200,
      text: ru ? '–= Jurgen Script =–\n\nЧто-то процесс затянулся...\n\nПродолжить обработку?' : '–= Jurgen Script =–\n\nThis is taking a while...\n\nContinue?',
    },
  });
  await mfbe.ui.message(
    ru
      ? `–= Jurgen Script =–\n«Тире - vs - Дефис» v1.62\n\nПроизведено замен:\n          вручную – ${state.count}\n   автоматически – ${counters.hyphen + counters.dash}\n          дефис – ${counters.hyphen}\n          тире – ${counters.dash}\nоставлено как было – ${counters.kept}\n\nПроверка произведена за ${legacyTimeString(started)}.`
      : `–= Jurgen Script =–\n"Dash vs. hyphen" v1.62\n\nReplacements:\n          manual – ${state.count}\n   automatic – ${counters.hyphen + counters.dash}\n          hyphen – ${counters.hyphen}\n          dash – ${counters.dash}\nleft as they were – ${counters.kept}\n\nChecked in ${legacyTimeString(started)}.`,
    { caption: ctx.script.name, icon: 'info' },
  );
}
