// Converted from 03_Добавление комментария/01_Добавить комментарий, оставшись на его ссылке.js (FictionBook Editor 2.7), Tier 2.
// Inserts a comment link {N} at the caret, renumbers the comments and creates the comment section; the caret stays in the text.
// Comments differ from footnotes only in their settings: ids c_N, link text {N} as superscript
// without type="note", body "comments" titled "Комментарии". The engine is shared with group 02.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// добавление сноски между уже имеющимися
// написал Sclex
// версия 2.6
import { COMMENTS, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...COMMENTS, ...{ addNote: true, inputText: false, moveFocus: false, lastMode: false, endWindow: true, removeUnused: false } });
}
