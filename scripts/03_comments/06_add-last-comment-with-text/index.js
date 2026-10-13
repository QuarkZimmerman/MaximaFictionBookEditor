// Converted from 03_Добавление комментария/06_Добавить последний комментарий, введя его текст в окошке.js (FictionBook Editor 2.7), Tier 2.
// Inserts the last comment link at the caret and appends the comment section with the text entered in a prompt.
// Comments differ from footnotes only in their settings: ids c_N, link text {N} as superscript
// without type="note", body "comments" titled "Комментарии". The engine is shared with group 02.
import { COMMENTS, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...COMMENTS, ...{ addNote: true, inputText: true, moveFocus: false, lastMode: true, endWindow: true, removeUnused: false } });
}
