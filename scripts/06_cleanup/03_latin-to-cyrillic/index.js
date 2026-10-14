// Converted from 06_Чистка/03_Латиница в Кириллице.js (FictionBook Editor): "Кириллизация латиницы".
// Latin letters that look like Cyrillic ones (A, B, C, E, H, K, M, O, P, T, X, a, c, e, g, m, n,
// o, p, r, x, y) and the digits 3/6 are replaced by the Cyrillic letters when they stand
// inside Cyrillic words; a Cyrillic Х inside a Roman numeral becomes a Latin X; the one-letter
// prepositions a/c/o/y between Cyrillic words become Cyrillic. The expressions are the
// original ones, run over every text block of the book by the editor's replace engine (inline
// formatting is kept); the count is the number of replacements.
//
// Deviation: the original `[^\d]` of the "6 -> б" rule had lost its backslash inside a JS
// string literal (it read `[^d]`); the intended "not a digit" form is used here.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//======================================
// Замена латинских букв в русских словах на кириллицу
// Корректировка римских дат
//                                                          Engine by ©Sclex
//                                                                    08.02.2008
// 20.03.2010 — скорректировал скрипт для работы с польз. символом nbsp — Sclex
//======================================

const RULES = [
  ["(A)([А-яЁё]{2,})", "А$2"], // re1a
  ["([А-яЁё]+)(A)([А-яЁё]+)", "$1А$3"], // re2a
  ["([А-яЁё]{2,})(A)", "$1А"], // re3a
  ["(a)([А-яЁё]{2,})", "а$2"], // re4a
  ["([А-яЁё]+)(a)([А-яЁё]+)", "$1а$3"], // re5a
  ["([А-яЁё]{2,})(a)", "$1а"], // re6a
  ["(B)([А-яЁё]{2,})", "В$2"], // re1b
  ["([А-яЁё]+)(B)([А-яЁё]+)", "$1В$3"], // re2b
  ["([А-яЁё]{2,})(B)", "$1В"], // re3b
  ["(C)([А-яЁё]{2,})", "С$2"], // re1c
  ["([А-яЁё]+)(C)([А-яЁё]+)", "$1С$3"], // re2c
  ["([А-яЁё]{2,})(C)", "$1С"], // re3c
  ["(c)([А-яЁё]{2,})", "с$2"], // re4c
  ["([А-яЁё]+)(c)([А-яЁё]+)", "$1с$3"], // re5c
  ["([А-яЁё]{2,})(c)", "$1с"], // re6c
  ["(E)([А-яЁё]{2,})", "Е$2"], // re1e
  ["([А-яЁё]+)(E)([А-яЁё]+)", "$1Е$3"], // re2e
  ["([А-яЁё]{2,})(E)", "$1Е"], // re3e
  ["(e)([А-яЁё]{2,})", "е$2"], // re4e
  ["([А-яЁё]+)(e)([А-яЁё]+)", "$1е$3"], // re5e
  ["([А-яЁё]{2,})(e)", "$1е"], // re6e
  ["(g)([А-яЁё]{2,})", "д$2"], // re1g
  ["([А-яЁё]+)(g)([А-яЁё]+)", "$1д$3"], // re2g
  ["([А-яЁё]{2,})(g)", "$1д"], // re3g
  ["(H)([А-яЁё]{2,})", "Н$2"], // re1h
  ["([А-яЁё]+)(H)([А-яЁё]+)", "$1Н$3"], // re2h
  ["([А-яЁё]{2,})(H)", "$1Н"], // re3h
  ["(K)([А-яЁё]{2,})", "К$2"], // re1k
  ["([А-яЁё]+)(K)([А-яЁё]+)", "$1К$3"], // re2k
  ["([А-яЁё]{2,})(K)", "$1К"], // re3k
  ["(M)([А-яЁё]{2,})", "М$2"], // re1m
  ["([А-яЁё]+)(M)([А-яЁё]+)", "$1М$3"], // re2m
  ["([А-яЁё]{2,})(M)", "$1М"], // re3m
  ["(m)([А-яЁё]{2,})", "т$2"], // re4m
  ["([А-яЁё]+)(m)([А-яЁё]+)", "$1т$3"], // re5m
  ["([А-яЁё]{2,})(m)", "$1т"], // re6m
  ["(n)([А-яЁё]{2,})", "п$2"], // re1n
  ["([А-яЁё]+)(n)([А-яЁё]+)", "$1п$3"], // re2n
  ["([А-яЁё]{2,})(n)", "$1п"], // re3n
  ["(O)([А-яЁё]{2,})", "О$2"], // re1o
  ["([А-яЁё]+)(O)([А-яЁё]+)", "$1О$3"], // re2o
  ["([А-яЁё]{2,})(O)", "$1О"], // re3o
  ["(o)([А-яЁё]{2,})", "о$2"], // re4o
  ["([А-яЁё]+)(o)([А-яЁё]+)", "$1о$3"], // re5o
  ["([А-яЁё]{2,})(o)", "$1о"], // re6o
  ["(P)([А-яЁё]{2,})", "Р$2"], // re1p
  ["([А-яЁё]+)(P)([А-яЁё]+)", "$1Р$3"], // re2p
  ["([А-яЁё]{2,})(P)", "$1Р"], // re3p
  ["(p)([А-яЁё]{2,})", "р$2"], // re4p
  ["([А-яЁё]+)(p)([А-яЁё]+)", "$1р$3"], // re5p
  ["([А-яЁё]{2,})(p)", "$1р"], // re6p
  ["(r)([А-яЁё]{2,})", "г$2"], // re1r
  ["([А-яЁё]+)(r)([А-яЁё]+)", "$1г$3"], // re2r
  ["([А-яЁё]{2,})(r)", "$1г"], // re3r
  ["(T)([А-яЁё]{2,})", "Т$2"], // re1t
  ["([А-яЁё]+)(T)([А-яЁё]+)", "$1Т$3"], // re2t
  ["([А-яЁё]{2,})(T)", "$1Т"], // re3t
  ["(X)([А-яЁё]{2,})", "Х$2"], // re1x
  ["([А-яЁё]+)(X)([А-яЁё]+)", "$1Х$3"], // re2x
  ["([А-яЁё]{2,})(X)", "$1Х"], // re3x
  ["(x)([А-яЁё]{2,})", "х$2"], // re4x
  ["([А-яЁё]+)(x)([А-яЁё]+)", "$1х$3"], // re5x
  ["([А-яЁё]{2,})(x)", "$1х"], // re6x
  ["Х([IVХXLC])", "X$1"], // re7x
  ["([IVХXLC])Х", "$1X"], // re8x
  ["(y)([А-яЁё]{2,})", "у$2"], // re1y
  ["([А-яЁё]+)(y)([А-яЁё]+)", "$1у$3"], // re2y
  ["([А-яЁё]{2,})(y)", "$1у"], // re3y
  ["(3)([а-яё]{2,})", "З$2"], // re1z
  ["([^\\d])(6)([а-яё]{2,})", "$1б$3"], // re1s
  ["([А-яЁё]+)(6)([а-яё]+)", "$1б$3"], // re2s
  ["([А-яЁё]{2,})(6)", "$1б"], // re3s
  ["([А-яЁё]{2,})([»\"“]{0,1})(\\s| )(a)(\\s| )([«\"„]{0,1})([А-яЁё]{2,})", "$1$2 а $6$7"], // re7a
  ["([А-яЁё]{2,})([»\"“]{0,1})(\\s| )(c)(\\s| )([«\"„]{0,1})([А-яЁё]{2,})", "$1$2 с $6$7"], // re7c
  ["([А-яЁё]{2,})([»\"“]{0,1})(\\s| )(o)(\\s| )([«\"„]{0,1})([А-яЁё]{2,})", "$1$2 о $6$7"], // re7o
  ["([А-яЁё]{2,})([»\"“]{0,1})(\\s| )(y)(\\s| )([«\"„]{0,1})([А-яЁё]{2,})", "$1$2 у $6$7"], // re7y
];

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const started = Date.now();
  let count = 0;
  for (let i = 0; i < RULES.length; i += 1) {
    const [pattern, replacement] = RULES[i];
    const { count: n } = await mfbe.doc.replaceAll({ text: pattern, regex: true, matchCase: true }, replacement);
    count += n;
    await mfbe.ui.progress(i + 1, RULES.length, ru ? 'Кириллизация латиницы' : 'Latin to Cyrillic');
    if (ctx.cancelled) return;
  }
  const seconds = Math.ceil((Date.now() - started) / 100) / 10;
  await mfbe.ui.message(
    ru
      ? `–= Jurgen Script =–\n«Кириллизация латиницы» v1.2\n\n      Произведено замен: ${count}\n\n   Время исполнения: ${seconds} сек.\n`
      : `–= Jurgen Script =–\n"Latin to Cyrillic" v1.2\n\n      Replacements made: ${count}\n\n   Time: ${seconds} s.\n`,
    { caption: ctx.script.name, icon: 'info' },
  );
}
