// Converted from 06_Чистка/07_10.000.000.000.js (FictionBook Editor): large numbers written
// with spaces or dots as group separators ("10 000 000", "1.500.000"), digit ranges with a
// hyphen or a spaced em dash ("1941-1945", "10 — 15"). Starting at the paragraph with the
// caret each finding is highlighted and proposed with non-breaking spaces (or an en dash);
// Yes takes the text of the input box, No keeps the place, Cancel stops the script.
import { legacyTimeString } from './lib/legacy-html.js';
import { piece, runInteractive } from './lib/interactive.js';
import { PATTERNS } from './patterns.js';

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
    prompt: (pieces) =>
      ru
        ? ` :: ${p.caption} ::\n > Предлагается замена:   ${pieces.display} —> ${pieces.suggestion}`
        : ` :: ${p.caption} ::\n > Proposed replacement:   ${pieces.display} —> ${pieces.suggestion}`,
  }));
  const state = await runInteractive(ctx, { caption: ctx.script.name, patterns });
  await mfbe.ui.message(
    ru
      ? `«10.000.000.000» v.2.12\n\nПроизведено замен: ${state.count}\n\nВремя: ${legacyTimeString(started)}\n`
      : `"10.000.000.000" v.2.12\n\nReplacements made: ${state.count}\n\nTime: ${legacyTimeString(started)}\n`,
    { caption: ctx.script.name, icon: 'info' },
  );
}
