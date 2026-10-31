// Converted from 03_Добавление комментария/04_Унификация комментариев.js (FictionBook Editor 2.7), Tier 2.
// Renumbers the comment sections (ids c_N, titles N) and the links that point to them ({N}).
// Comments differ from footnotes only in their settings: ids c_N, link text {N} as superscript
// without type="note", body "comments" titled "Комментарии". The engine is shared with group 02.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// добавление сноски между уже имеющимися
// написал Sclex
// версия 2.6
import { COMMENTS, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...COMMENTS, ...{ addNote: false, inputText: false, moveFocus: false, lastMode: false, endWindow: true, removeUnused: false } });
}
