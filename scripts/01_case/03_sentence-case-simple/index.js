// Converted from 01_Регистр/03_Предложение (простое).js (FictionBook Editor 2.7), Tier 1; the folder
// drops the author tag of the original file name.
// "Sentence": the first letter of the selected fragment becomes upper case, everything else
// lower case. The original refused selections that did not start with a letter (it looked at the
// first character of the selection's HTML), so the same check is made on the selected text.
import { selectedBlocks, selectedText, t, transformSelection } from './case-lib.js';

// The original class `[A-zА-яЁё]` (Latin and basic Cyrillic letters).
const FIRST_LETTER = /^[A-Za-zА-яЁё]/;

export default async function run(ctx) {
  const selection = await selectedBlocks(false);
  if (!selection || selection.collapsed) {
    await mfbe.ui.message(t(ctx, 'Пожалуйста, выделите хоть что-нибудь. ', 'Please select something first. '));
    return;
  }
  if (!FIRST_LETTER.test(selectedText(selection))) {
    await mfbe.ui.message(
      t(ctx, 'Аккуратней выделяйте, пожалуйста!  \n', 'Please select more carefully: the selection must start with a letter.  \n'),
    );
    return;
  }
  const state = { first: true };
  await transformSelection(selection, (chunk, s) => {
    if (!s.first) return chunk.toLowerCase();
    s.first = false;
    return chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase();
  }, state);
}
