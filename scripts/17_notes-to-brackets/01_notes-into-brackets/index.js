// Converted from FictionBook Editor 2.7: Scripts/17_Перенос примечаний в скобки/01_Перенос
// примечаний в скобки.js, brought up to FictionBook Editor 2.7.9: Scripts/17_Перенос примечаний
// в скобки/01_Перенести примечания в скобки.js, Tier 2. Every footnote/comment reference becomes
// the note text in [] / {} brackets (move-all.js). 2.7.9 (v1.2) fixed the escaping of the note
// text it rebuilt as HTML (an ampersand was never escaped, so text such as "&lt;" turned into
// "<"); the inline nodes are copied here, so the text was never changed.
// Differences from the original: docs/scripting/conversion-notes-279-b.md (group 17).
// The original's notice, kept as written (FR-029):
// var versionStr="Перенос примечаний в скобки v1.2. Автор Sclex."
import { moveAllNotes } from './move-all.js';

export default async function run(ctx) {
  await moveAllNotes(ctx, { spaceBefore: false });
}
