// Converted from 01_Регистр/05_Капитализация выделения.js (FictionBook Editor 2.7), Tier 1.
// Capitalises every word of the selection (first letter upper case, the rest lower case). A word
// split by formatting ("сло<b>во</b>") stays one word: a run that starts with a letter right after a
// run that ended with a letter continues in lower case. With a caret only the word under it is used.
import { LETTERS, NO_SELECTION, capitalize, selectedBlocks, t, transformSelection } from './case-lib.js';

const WORDS = new RegExp(`[${LETTERS}]+`, 'gi');
const LAST_IS_LETTER = new RegExp(`[${LETTERS}]$`, 'i');

export default async function run(ctx) {
  const selection = await selectedBlocks(true);
  if (!selection) {
    await mfbe.ui.message(t(ctx, NO_SELECTION.ru, NO_SELECTION.en), { icon: 'warning' });
    return;
  }
  await transformSelection(
    selection,
    (chunk, state) => {
      const result = chunk.replace(WORDS, (word, offset) => {
        if (state.lastSymbolLetter && offset === 0) {
          state.lastSymbolLetter = false;
          return word.toLowerCase();
        }
        state.lastSymbolLetter = false;
        return capitalize(word);
      });
      state.lastSymbolLetter = LAST_IS_LETTER.test(result);
      return result;
    },
    { lastSymbolLetter: false },
    (state) => {
      state.lastSymbolLetter = false; // a new paragraph always starts a new word
    },
  );
}
