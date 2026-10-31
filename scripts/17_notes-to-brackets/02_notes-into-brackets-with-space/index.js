// Converted from FictionBook Editor 2.7: Scripts/17_Перенос примечаний в скобки/02_Перенос
// примечаний в скобки (пробел перед открывающей скобкой).js, brought up to FictionBook Editor
// 2.7.9: Scripts/17_Перенос примечаний в скобки/02_Перенести примечания в скобки (пробел перед
// открывающей скобкой).js, Tier 2. Same as script 01 with a space in front of the opening
// bracket; 2.7.9 (v1.2) fixed the escaping of the note text as in script 01.
// Differences from the original: docs/scripting/conversion-notes-279-b.md (group 17).
// The original's notice, kept as written (FR-029):
// var versionStr="Перенос примечаний в скобки v1.2. Автор Sclex."
import { moveAllNotes } from './move-all.js';

export default async function run(ctx) {
  await moveAllNotes(ctx, { spaceBefore: true });
}
