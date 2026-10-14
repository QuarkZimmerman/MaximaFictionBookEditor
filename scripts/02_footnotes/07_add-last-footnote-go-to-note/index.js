// Converted from 02_Добавление примечания/07_Добавить последнюю сноску, перейти к ее разделу.js (FictionBook Editor 2.7), Tier 2.
// Inserts the last footnote link at the caret, appends the note section and moves the caret into it.
// The nine scripts of this group share one engine (notes-engine.js) and differ only in these
// settings, exactly like the originals differed in their settings block.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// добавление сноски между уже имеющимися
// написал Sclex
// версия 2.7
import { FOOTNOTES, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...FOOTNOTES, ...{ addNote: true, inputText: false, moveFocus: true, lastMode: true, endWindow: false, removeUnused: false } });
}
