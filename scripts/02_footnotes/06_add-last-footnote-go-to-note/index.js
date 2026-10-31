// Converted from FictionBook Editor 2.7: Scripts/02_Добавление примечания/07_Добавить последнюю сноску, перейти к ее разделу.js,
// brought up to FictionBook Editor 2.7.9: Scripts/02_Примечания/06_Добавить последнее примечание, перейти на его раздел.js
// (version 2.8), Tier 2.
// Inserts a link to the last footnote at the caret, appends its section to the notes body and
// moves the caret into it.
// The scripts 01-08 of the group are one program by Sclex (notes-engine.js: this package's own
// copy, with its original's texts and lines) and differ in this settings block, as the
// originals did.
// Differences from 2.7.9: docs/scripting/conversion-notes-279-a.md (group 02).
// The original's notice, kept as written (FR-029):
// добавление сноски между уже имеющимися
// написал Sclex
// версия 2.8
import { runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  // The settings block of the original («НАСТРОЙКИ»): EndWindow, addSnoska, InputSnoskaText,
  // MoveFocusToNote, lastSnoskaMode.
  await runNotesScript(ctx, {
    endWindow: false,
    addNote: true,
    inputText: false,
    moveFocus: true,
    lastMode: true,
  });
}
