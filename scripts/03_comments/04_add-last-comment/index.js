// Converted from FictionBook Editor 2.7: Scripts/03_Добавление комментария/05_Добавить последний комментарий, оставшись на его ссылке.js,
// brought up to FictionBook Editor 2.7.9: Scripts/03_Комментарии/04_Добавить последний комментарий, остаться на его ссылке.js
// (version 2.8), Tier 2.
// Inserts a link to a new comment at the caret, which must follow every other comment link, and
// appends its section to the comments body without renumbering; the caret stays at the link.
// The scripts 01-08 of the group are one program by Sclex (notes-engine.js: this package's own
// copy, with its original's texts and lines) and differ in this settings block, as the
// originals did.
// Differences from 2.7.9: docs/scripting/conversion-notes-279-a.md (group 03).
// The original's notice, kept as written (FR-029):
// добавление сноски между уже имеющимися
// написал Sclex
// версия 2.8
import { runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  // The settings block of the original («НАСТРОЙКИ»): EndWindow, addSnoska, InputSnoskaText,
  // MoveFocusToNote, lastSnoskaMode.
  await runNotesScript(ctx, {
    endWindow: true,
    addNote: true,
    inputText: false,
    moveFocus: false,
    lastMode: true,
  });
}
