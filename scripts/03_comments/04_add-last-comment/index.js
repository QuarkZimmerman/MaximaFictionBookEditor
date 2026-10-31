// Converted from 03_Добавление комментария/05_Добавить последний комментарий, оставшись на его ссылке.js (FictionBook Editor 2.7), Tier 2.
// Inserts a comment link at the caret (which must follow every other comment) and appends the comment section without renumbering.
// Comments differ from footnotes only in their settings: ids c_N, link text {N} as superscript
// without type="note", body "comments" titled "Комментарии". The engine is shared with group 02.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// добавление сноски между уже имеющимися
// написал Sclex
// версия 2.6
import { COMMENTS, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...COMMENTS, ...{ addNote: true, inputText: false, moveFocus: false, lastMode: true, endWindow: true, removeUnused: false } });
}
