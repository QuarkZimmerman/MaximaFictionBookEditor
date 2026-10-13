// Converted from 06_Чистка/05_Слипшиеся слова.js (FictionBook Editor): interactive search for
// suspicious places - punctuation glued between letters, a capital right after a lower-case
// letter, digits glued to words, misplaced hyphens and dashes, apostrophes and slashes inside
// words, stray symbols, plain text inside italics... Starting at the paragraph with the caret
// every finding is highlighted and shown in an input box with a proposal: Yes replaces the
// place by the text of the box, No keeps it (and remembers the text so it is not asked
// again), Cancel stops the script.
import { legacyTimeString } from './lib/legacy-html.js';
import { piece, runInteractive } from './lib/interactive.js';
import { PATTERNS } from './patterns.js';

/** Words before a hyphen that are never questioned ("радио-", "теле-"...). */
const HYPHEN_EXCEPTIONS = new Set(['радио', 'теле', 'лево', 'право']);

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const started = Date.now();
  const apostrophe = (await MsgBox(ru ? '1–2\n\nОбращать внимание на а\'построфы?' : '1–2\n\nCheck a\'postrophes inside words?', ctx.script.name, 4 + 32)) === 6;
  const slash = (await MsgBox(ru ? '2–2\n\nОбращать внимание на /слэши/?' : '2–2\n\nCheck /slashes/ inside words?', ctx.script.name, 4 + 32)) === 6;

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
      ? `«Слипшиеся слова» v.2.92\n\nПроизведено замен:   ${state.count}\n\nВремя: ${legacyTimeString(started)}\n`
      : `"Stuck-together words" v.2.92\n\nReplacements made:   ${state.count}\n\nTime: ${legacyTimeString(started)}\n`,
    { caption: ctx.script.name, icon: 'info' },
  );
}
