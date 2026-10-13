// Converted from 01_Регистр/01_Верхний регистр.js (FictionBook Editor 2.7), Tier 1.
// Upper-cases the selected text; inline formatting is kept. With a caret only (no selection) the
// word under the caret is processed, as the original did with TextRange.expand("word").
import { NO_SELECTION, selectedBlocks, t, transformSelection } from './case-lib.js';

export default async function run(ctx) {
  const selection = await selectedBlocks(true);
  if (!selection) {
    await mfbe.ui.message(t(ctx, NO_SELECTION.ru, NO_SELECTION.en), { icon: 'warning' });
    return;
  }
  await transformSelection(selection, (chunk) => chunk.toUpperCase());
}
