// Converted from 02_Добавление примечания/06_Добавить последнюю сноску, введя ее текст в окошке.js (FictionBook Editor 2.7), Tier 2.
// Inserts the last footnote link at the caret and appends the note section with the text entered in a prompt.
// The nine scripts of this group share one engine (notes-engine.js) and differ only in these
// settings, exactly like the originals differed in their settings block.
import { FOOTNOTES, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...FOOTNOTES, ...{ addNote: true, inputText: true, moveFocus: false, lastMode: true, endWindow: true, removeUnused: false } });
}
