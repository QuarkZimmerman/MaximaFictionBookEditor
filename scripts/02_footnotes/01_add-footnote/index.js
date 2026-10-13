// Converted from 02_Добавление примечания/01_Добавить сноску, оставшись на ее ссылке.js (FictionBook Editor 2.7), Tier 2.
// Inserts a footnote link at the caret, renumbers the footnotes and creates the note section; the caret stays in the text.
// The nine scripts of this group share one engine (notes-engine.js) and differ only in these
// settings, exactly like the originals differed in their settings block.
import { FOOTNOTES, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...FOOTNOTES, ...{ addNote: true, inputText: false, moveFocus: false, lastMode: false, endWindow: true, removeUnused: false } });
}
