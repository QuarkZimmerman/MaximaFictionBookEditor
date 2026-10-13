// Converted from 02_Добавление примечания/03_Добавить сноску, перейти к ее разделу.js (FictionBook Editor 2.7), Tier 2.
// Inserts a footnote link at the caret, creates the note section and moves the caret into it.
// The nine scripts of this group share one engine (notes-engine.js) and differ only in these
// settings, exactly like the originals differed in their settings block.
import { FOOTNOTES, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...FOOTNOTES, ...{ addNote: true, inputText: false, moveFocus: true, lastMode: false, endWindow: false, removeUnused: false } });
}
