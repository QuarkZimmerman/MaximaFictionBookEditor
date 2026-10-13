// Converted from 03_Добавление комментария/07_Добавить последний комментарий, перейти к его разделу.js (FictionBook Editor 2.7), Tier 2.
// Inserts the last comment link at the caret, appends the comment section and moves the caret into it.
// Comments differ from footnotes only in their settings: ids c_N, link text {N} as superscript
// without type="note", body "comments" titled "Комментарии". The engine is shared with group 02.
import { COMMENTS, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...COMMENTS, ...{ addNote: true, inputText: false, moveFocus: true, lastMode: true, endWindow: false, removeUnused: false } });
}
