// Converted from 01_Регистр/04_Предложение.js (FictionBook Editor 2.7), Tier 1.
// "Sentence" per text run: inside the selection every run of text with the same formatting gets
// its first letter upper-cased and the rest lower-cased ("Hello <b>WORLD</b>" -> "Hello <b>World</b>").
// Runs without a letter are left alone (the original stopped there, leaving its markers behind).
import { NO_SELECTION, selectedBlocks, t, transformSelection } from './case-lib.js';

// The original class `[A-zА-яЁё]` (Latin and basic Cyrillic letters).
const LETTER = /[A-Za-zА-яЁё]/;

export default async function run(ctx) {
  const selection = await selectedBlocks(false);
  if (!selection) {
    await mfbe.ui.message(t(ctx, NO_SELECTION.ru, NO_SELECTION.en), { icon: 'warning' });
    return;
  }
  await transformSelection(selection, (chunk) => {
    const first = chunk.search(LETTER);
    if (first < 0) return chunk;
    return chunk.slice(0, first + 1).toUpperCase() + chunk.slice(first + 1).toLowerCase();
  });
}
