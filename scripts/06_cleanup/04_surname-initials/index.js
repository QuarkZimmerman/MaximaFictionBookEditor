// Converted from 06_Чистка/04_Фамилия И. О..js (FictionBook Editor): initials before and after
// surnames. Starting at the paragraph with the caret, every "И.О.Фамилия", "Фамилия И. О." and
// "Пётр I" is shown to the user with a proposal that joins the parts with non-breaking spaces;
// Yes takes the text of the input box, No leaves the place alone (and remembers it), Cancel
// stops the script. Accepted replacements are remembered too and applied automatically later.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//======================================
//               Инициалы до и после фамилий
//                                    Engine by ©Sclex
//                                                                   02.05.2008
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.2 — включена обработка аннотации
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.3 — переход на следующий абзац — "ready for FBE"
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// v.1.4 — кастомизированные неразрывные пробелы — Sclex (20.03.2010)
//======================================
// v.1.5 — прерывание процесса
//======================================
// v.2.0 — самообучение — jurgennt, май 2010
//======================================
// v.2.1 — проверка от курсора — sclex, май 2010
//======================================
// v.2.2 — доработка движкапод прерывание и выход — sclex, май 2010
//======================================
import { legacyTimeString } from './lib/legacy-html.js';
import { piece, runInteractive } from './lib/interactive.js';

const NB = '\u00A0';
const NBSP = '&nbsp;'; // the legacy inline-HTML notation of the non-breaking space

// The seven legacy patterns with the replacement templates that extract their pieces.
const re10 = /^(.*?[^А-яЁёA-z;]){0,1}([А-ЯЁA-Z][а-яёa-z]{0,1})(\.\s{0,1})([А-ЯЁA-Z][а-яёa-z]{0,1})(\.\s{0,1})([А-ЯЁA-Z][а-яёa-z]{0,1})(\.\s{0,1})([А-ЯЁA-Z][А-яЁёA-z]+)(.*?)$/g;
const re20 = new RegExp(`^(.*?[^А-яЁёA-z;]){0,1}([А-ЯЁA-Z][а-яёa-z]{0,1})(\\.\\s{0,1})([А-ЯЁA-Z][а-яёa-z]{0,1})(\\.(\\s|${NBSP}){0,1})([А-ЯЁA-Z][А-яЁёA-z]+)(.*?)$`, 'g');
const re30 = /^(.*?[^А-яЁёA-z;]){0,1}([А-ЯЁA-Z][а-яёa-z]{0,1})(\.\s{0,1})([А-ЯЁA-Z][А-яЁёA-z]+)(.*?)$/g;
const re40 = /^(.*?[^А-яЁёA-z]){0,1}([А-ЯЁA-Z][а-яёa-z]+) ([А-ЯЁA-Z][а-яёa-z]{0,1})(\.\s{0,1})([А-ЯЁA-Z][а-яёa-z]{0,1})(\.\s{0,1})([А-ЯЁA-Z][а-яёa-z]{0,1})\.([^&].*?){0,1}$/g;
const re50 = /^(.*?[^А-яЁёA-z]){0,1}([А-ЯЁA-Z][а-яёa-z]+) ([А-ЯЁA-Z][а-яёa-z]{0,1})(\.\s{0,1})([А-ЯЁA-Z][а-яёa-z]{0,1})\.([^&].*?){0,1}$/g;
const re60 = /^(.*?[^А-яЁёA-z]){0,1}([А-ЯЁA-Z][а-яёa-z]+) ([А-ЯЁA-Z][а-яёa-z]{0,1})\.([^&].*?){0,1}$/g;
const re70 = /^(.*?[^А-яЁёA-z\d]){0,1}([А-ЯA-Z][а-яёa-z]+) ([IVX])(.+)$/g;

function before(re, prompt, suggestion, display, prefix, suffix, rejectPrefix, rejectValue) {
  return {
    re,
    prompt,
    pieces: (s) => ({
      suggestion: piece(s, re, suggestion),
      display: piece(s, re, display),
      prefix: piece(s, re, prefix),
      suffix: piece(s, re, suffix),
      rejectPrefix: piece(s, re, rejectPrefix),
      rejectValue: piece(s, re, rejectValue),
    }),
  };
}

function after(re, prompt, suggestion, display, prefix, suffix, rejectValue, rejectSuffix) {
  return {
    re,
    prompt,
    pieces: (s) => ({
      suggestion: piece(s, re, suggestion),
      display: piece(s, re, display),
      prefix: piece(s, re, prefix),
      suffix: piece(s, re, suffix),
      rejectValue: piece(s, re, rejectValue),
      rejectSuffix: piece(s, re, rejectSuffix),
    }),
  };
}

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const started = Date.now();
  const prompt = (pieces, state) =>
    ru
      ? ` Предлагается вариант из поля ввода («Да» — заменить, «Нет» — оставить, «Отмена» — выйти).        … ${state.count} …\n Найдено: ${pieces.display}`
      : ` The input box proposes a replacement (Yes - replace, No - keep, Cancel - stop).        … ${state.count} …\n Found: ${pieces.display}`;
  const patterns = [
    before(re10, prompt, `$2.${NB}$4.${NB}$6.${NB}$8`, '$2$3$4$5$6$7$8', '$1', '$9', '$1$2$3$4$5$6$7', '$8'),
    before(re20, prompt, `$2.${NB}$4.${NB}$7`, '$2$3$4$5$7', '$1', '$8', '$1$2$3$4$5', '$7'),
    before(re30, prompt, `$2.${NB}$4`, '$2$3$4', '$1', '$5', '$1$2$3', '$4'),
    after(re40, prompt, `$2${NB}$3.${NB}$5.${NB}$7.`, '$2 $3$4$5$6$7.', '$1', '$8', '$2', ' $3$4$5$6$7.$8'),
    after(re50, prompt, `$2${NB}$3.${NB}$5.`, '$2 $3$4$5.', '$1', '$6', '$2', ' $3$4$5.$6'),
    after(re60, prompt, `$2${NB}$3.`, '$2 $3.', '$1', '$4', '$2', ' $3.$4'),
    {
      re: re70,
      pieces: (s) => ({
        suggestion: piece(s, re70, `$2${NB}$3`),
        display: piece(s, re70, '$2 $3'),
        prefix: piece(s, re70, '$1'),
        suffix: piece(s, re70, '$4'),
      }),
      prompt,
    },
  ];
  const state = await runInteractive(ctx, {
    caption: ctx.script.name,
    patterns,
    rememberRejected: true,
    rememberAccepted: true,
  });
  await mfbe.ui.message(
    ru
      ? `  –= Jürgen Script =–\n «Фамилия И. О.» v2.2\n\n Произведено замен: ${state.count}\n\n Время: ${legacyTimeString(started)}.\n`
      : `  –= Jürgen Script =–\n "Surname I. O." v2.2\n\n Replacements made: ${state.count}\n\n Time: ${legacyTimeString(started)}.\n`,
    { caption: ctx.script.name, icon: 'info' },
  );
}
