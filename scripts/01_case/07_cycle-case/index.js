// Converted from 01_Регистр/07_Циклическое изменение регистра.js (FictionBook Editor 2.7), Tier 1.
// Cycles the case of the selection (or of the word under the caret) through three states, chosen
// from the letters it contains: mixed case -> lower case; lower case only -> UPPER CASE; upper case
// only -> Sentence case (first word capitalised, the rest lower case). A selection made of single
// upper-case letters only ("A B C") goes to lower case, as in the original.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//скрипт смены регистра by Sclex
//v1.4
import { NO_SELECTION, selectedBlocks, selectedText, t, transformSelection } from './case-lib.js';

// Letter classes of the original: Latin and basic Cyrillic only.
const BIG = /[А-ЯЁA-Z]/;
const SMALL = /[а-яёa-z]/;
const WORDS = /[а-яёa-z]+/gi;

export default async function run(ctx) {
  const selection = await selectedBlocks(true);
  if (!selection) {
    await mfbe.ui.message(t(ctx, NO_SELECTION.ru, NO_SELECTION.en), { icon: 'warning' });
    return;
  }
  // The analysis covers the whole selection (the original stopped at the first text run holding
  // an upper-case letter, a bug noted in docs/scripting/conversion-notes-a.md).
  const text = selectedText(selection);
  const hasBig = BIG.test(text);
  const hasSmall = SMALL.test(text);
  const oneLetterWords = !(text.match(WORDS) ?? []).some((word) => word.length > 1);

  let mode;
  if (hasBig && hasSmall) mode = 'lower';
  else if (hasSmall) mode = 'upper';
  else if (!oneLetterWords) mode = 'sentence';
  else mode = 'lower';

  const state = { firstCapitalization: true };
  await transformSelection(selection, (chunk, s) => {
    if (mode === 'upper') return chunk.toUpperCase();
    if (mode === 'lower') return chunk.toLowerCase();
    return chunk.replace(WORDS, (word) => {
      if (!s.firstCapitalization) return word.toLowerCase();
      s.firstCapitalization = false;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
  }, state);
}
