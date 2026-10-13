// Converted from 17_Перенос примечаний в скобки/01_Перенос примечаний в скобки.js (FictionBook
// Editor 2.7), Tier 2. Every footnote/comment reference becomes the note text in [] / {} brackets.
import { moveAllNotes } from './move-all.js';

export default async function run(ctx) {
  await moveAllNotes(ctx, { spaceBefore: false });
}
