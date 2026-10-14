// Converted from 02_Добавление примечания/05_Добавить последнюю сноску, оставшись на ее ссылке.js (FictionBook Editor 2.7), Tier 2.
// Inserts a footnote link at the caret (which must follow every other footnote) and appends the note section without renumbering.
// The nine scripts of this group share one engine (notes-engine.js) and differ only in these
// settings, exactly like the originals differed in their settings block.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// добавление сноски между уже имеющимися
// написал Sclex
// версия 2.7
import { FOOTNOTES, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...FOOTNOTES, ...{ addNote: true, inputText: false, moveFocus: false, lastMode: true, endWindow: true, removeUnused: false } });
}
