// Converted from FictionBook Editor 2.7: Scripts/02_Добавление примечания/04_Унификация сносок.js,
// brought up to FictionBook Editor 2.7.9: Scripts/02_Примечания/07_Перенумеровать примечания.js
// (version 3.0), Tier 2.
// Renumbers the sections of the notes body (ids n_N, titles N) and the links that point to them
// ([N]); a link that is not marked as a footnote link (type="note") gets the mark.
// The scripts 01-08 of the group are one program by Sclex (notes-engine.js: this package's own
// copy, with its original's texts and lines) and differ in this settings block, as the
// originals did.
// Differences from 2.7.9: docs/scripting/conversion-notes-279-a.md (group 02).
// The original's notice, kept as written (FR-029):
// добавление сноски между уже имеющимися
// написал Sclex
// версия 3.0
import { runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  // The settings block of the original («НАСТРОЙКИ»): EndWindow, addSnoska, InputSnoskaText,
  // MoveFocusToNote, lastSnoskaMode.
  await runNotesScript(ctx, {
    endWindow: true,
    addNote: false,
    inputText: false,
    moveFocus: false,
    lastMode: false,
  });
}
