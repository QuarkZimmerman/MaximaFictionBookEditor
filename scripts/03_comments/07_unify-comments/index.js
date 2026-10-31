// Converted from FictionBook Editor 2.7: Scripts/03_Добавление комментария/04_Унификация комментариев.js,
// brought up to FictionBook Editor 2.7.9: Scripts/03_Комментарии/07_Перенумеровать комментарии.js
// (version 2.7), Tier 2.
// Renumbers the sections of the comments body (ids c_N, titles N) and the links that point to
// them ({N}).
// The scripts 01-08 of the group are one program by Sclex (notes-engine.js: this package's own
// copy, with its original's texts and lines) and differ in this settings block, as the
// originals did.
// Differences from 2.7.9: docs/scripting/conversion-notes-279-a.md (group 03).
// The original's notice, kept as written (FR-029):
// добавление сноски между уже имеющимися
// написал Sclex
// версия 2.7
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
