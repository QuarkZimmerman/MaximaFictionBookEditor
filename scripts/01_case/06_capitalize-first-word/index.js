// Converted from 01_Регистр/06_Капитализация первого слова.js (FictionBook Editor 2.7), Tier 1.
// Only the first word of the selection is capitalised; every other letter of the selection is
// lower-cased. With a caret only the word under it is used.
import { LETTERS, NO_SELECTION, capitalize, selectedBlocks, t, transformSelection } from './case-lib.js';

const WORDS = new RegExp(`[${LETTERS}]+`, 'gi');

export default async function run(ctx) {
  const selection = await selectedBlocks(true);
  if (!selection) {
    await mfbe.ui.message(t(ctx, NO_SELECTION.ru, NO_SELECTION.en), { icon: 'warning' });
    return;
  }
  const state = { firstCapitalization: true };
  await transformSelection(selection, (chunk, s) =>
    chunk.replace(WORDS, (word) => {
      if (!s.firstCapitalization) return word.toLowerCase();
      s.firstCapitalization = false;
      return capitalize(word);
    }),
  state);
}
