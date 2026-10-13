// Converted from 03_Добавление комментария/03_Добавить комментарий, перейти к его разделу.js (FictionBook Editor 2.7), Tier 2.
// Inserts a comment link at the caret, creates the comment section and moves the caret into it.
// Comments differ from footnotes only in their settings: ids c_N, link text {N} as superscript
// without type="note", body "comments" titled "Комментарии". The engine is shared with group 02.
import { COMMENTS, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...COMMENTS, ...{ addNote: true, inputText: false, moveFocus: true, lastMode: false, endWindow: false, removeUnused: false } });
}
