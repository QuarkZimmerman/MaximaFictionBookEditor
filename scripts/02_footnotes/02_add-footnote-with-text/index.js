// Converted from 02_Добавление примечания/02_Добавить сноску, введя ее текст в окошке.js (FictionBook Editor 2.7), Tier 2.
// Inserts a footnote link at the caret and creates the note section with the text entered in a prompt.
// The nine scripts of this group share one engine (notes-engine.js) and differ only in these
// settings, exactly like the originals differed in their settings block.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// добавление сноски между уже имеющимися
// написал Sclex
// версия 2.7
import { FOOTNOTES, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...FOOTNOTES, ...{ addNote: true, inputText: true, moveFocus: false, lastMode: false, endWindow: true, removeUnused: false } });
}
