// Converted from 03_Добавление комментария/08_Унификация комментариев (с удалением неиспользуемых разделов комментариев).js (FictionBook Editor 2.7), Tier 2.
// Removes the comment sections no link points to, then renumbers the comment sections and links.
// Comments differ from footnotes only in their settings: ids c_N, link text {N} as superscript
// without type="note", body "comments" titled "Комментарии". The engine is shared with group 02.
import { COMMENTS, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...COMMENTS, ...{ addNote: false, inputText: false, moveFocus: false, lastMode: false, endWindow: true, removeUnused: true } });
}
