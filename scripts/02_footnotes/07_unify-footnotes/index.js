// Converted from 02_Добавление примечания/04_Унификация сносок.js (FictionBook Editor 2.7), Tier 2.
// Renumbers the footnote sections (ids n_N, titles N) and the links that point to them ([N]).
// The nine scripts of this group share one engine (notes-engine.js) and differ only in these
// settings, exactly like the originals differed in their settings block.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// добавление сноски между уже имеющимися
// написал Sclex
// версия 2.7
import { FOOTNOTES, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...FOOTNOTES, ...{ addNote: false, inputText: false, moveFocus: false, lastMode: false, endWindow: true, removeUnused: false } });
}
